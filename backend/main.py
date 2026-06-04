import json
import random
import re
import os

import anthropic
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from meme_data import MEME_TEMPLATES

app = FastAPI(title="Realtime Meme Expression Generator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

client = anthropic.Anthropic()

EXPRESSION_EMOJIS = {
    "happy": "😄",
    "surprised": "😮",
    "sad": "😢",
    "angry": "😠",
    "disgusted": "🤢",
    "fearful": "😨",
    "neutral": "😐",
}

STREAK_MODIFIERS = {
    1: "",
    2: " (x2 COMBO!)",
    3: " (x3 TRIPLE!)",
    4: " (x4 ULTRA!!)",
    5: " (x5 LEGENDARY!!!)",
}


class AnalyzeRequest(BaseModel):
    image: str  # base64 JPEG
    context: str = ""
    streak: int = 0


class AnalyzeResponse(BaseModel):
    expression: str
    intensity: str
    emoji: str
    meme: dict
    roast: str
    streak_label: str


def extract_json(text: str) -> dict:
    text = text.strip()
    # Strip markdown fences if present
    match = re.search(r"```(?:json)?\s*([\s\S]+?)```", text)
    if match:
        text = match.group(1).strip()
    return json.loads(text)


@app.post("/api/analyze", response_model=AnalyzeResponse)
async def analyze_expression(req: AnalyzeRequest):
    context_block = f"\nUser's current situation: {req.context}" if req.context.strip() else ""
    streak_block = f"\nThe user has shown this SAME expression for {req.streak} analysis cycles in a row — make the meme increasingly dramatic/unhinged accordingly." if req.streak > 1 else ""

    try:
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=350,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/jpeg",
                                "data": req.image,
                            },
                        },
                        {
                            "type": "text",
                            "text": f"""Analyze the facial expression in this image. Be quick, funny, and internet-savvy.{context_block}{streak_block}

Respond ONLY with raw JSON — no markdown, no explanation:
{{
  "expression": "<happy|surprised|sad|angry|disgusted|fearful|neutral>",
  "intensity": "<mild|moderate|strong>",
  "top": "<meme top text, max 6 words, ALL CAPS style>",
  "bottom": "<meme punchline, max 6 words, ALL CAPS style>",
  "roast": "<savage one-liner about their expression, max 10 words>"
}}

If no face is visible: expression=neutral, intensity=mild, funny placeholder texts.
Lean into internet culture, Gen-Z humor, relatable observations.""",
                        },
                    ],
                }
            ],
        )

        raw = message.content[0].text
        result = extract_json(raw)

        expression = result.get("expression", "neutral")
        if expression not in MEME_TEMPLATES:
            expression = "neutral"

        template = random.choice(MEME_TEMPLATES[expression])
        streak_level = min(req.streak, 5)
        streak_label = STREAK_MODIFIERS.get(streak_level, STREAK_MODIFIERS[5])

        return AnalyzeResponse(
            expression=expression,
            intensity=result.get("intensity", "moderate"),
            emoji=EXPRESSION_EMOJIS[expression],
            meme={
                **template,
                "top": result.get("top", "WHEN THE AI"),
                "bottom": result.get("bottom", "CANNOT READ YOU"),
            },
            roast=result.get("roast", "Interesting face you've got there."),
            streak_label=streak_label,
        )

    except Exception as e:
        expression = "neutral"
        template = random.choice(MEME_TEMPLATES[expression])
        return AnalyzeResponse(
            expression=expression,
            intensity="mild",
            emoji=EXPRESSION_EMOJIS[expression],
            meme={
                **template,
                "top": "AI IS CONFUSED",
                "bottom": "BY YOUR FACE",
            },
            roast=f"Error: {str(e)[:50]}",
            streak_label="",
        )


@app.get("/api/health")
async def health():
    return {"status": "ok", "model": "claude-haiku-4-5-20251001"}


frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(frontend_dir):
    app.mount("/static", StaticFiles(directory=os.path.join(frontend_dir, "static")), name="static")

    @app.get("/")
    async def serve_frontend():
        return FileResponse(os.path.join(frontend_dir, "index.html"))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
