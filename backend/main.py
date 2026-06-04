import json
import os
import random
import re
from difflib import get_close_matches

import anthropic
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from meme_data import EXPRESSION_COLORS, EXPRESSION_MEME_NAMES

load_dotenv()

app = FastAPI(title="Realtime Meme Expression Generator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

anthropic_client = anthropic.Anthropic()

# Filled at startup from Imgflip's public catalog
imgflip_catalog: dict[str, dict] = {}  # name.lower() -> {id, name, url, box_count}

IMGFLIP_USERNAME = os.getenv("IMGFLIP_USERNAME", "")
IMGFLIP_PASSWORD = os.getenv("IMGFLIP_PASSWORD", "")

EXPRESSION_EMOJIS = {
    "happy": "😄", "surprised": "😮", "sad": "😢",
    "angry": "😠", "disgusted": "🤢", "fearful": "😨", "neutral": "😐",
}


# ─── Startup: fetch Imgflip template catalog ─────────────────────────────────

@app.on_event("startup")
async def load_imgflip_catalog():
    global imgflip_catalog
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get("https://api.imgflip.com/get_memes")
            r.raise_for_status()
            memes = r.json()["data"]["memes"]
            imgflip_catalog = {m["name"].lower(): m for m in memes}
            print(f"[imgflip] loaded {len(imgflip_catalog)} templates")
    except Exception as e:
        print(f"[imgflip] catalog load failed: {e}")


# ─── Imgflip helpers ─────────────────────────────────────────────────────────

def resolve_template(expression: str) -> dict | None:
    """Return the best Imgflip template for the given expression."""
    candidates = EXPRESSION_MEME_NAMES.get(expression, [])
    for name in candidates:
        # Exact match first
        key = name.lower()
        if key in imgflip_catalog:
            return imgflip_catalog[key]
        # Fuzzy match
        matches = get_close_matches(key, imgflip_catalog.keys(), n=1, cutoff=0.6)
        if matches:
            return imgflip_catalog[matches[0]]
    # Last resort: random from catalog
    return random.choice(list(imgflip_catalog.values())) if imgflip_catalog else None


async def generate_imgflip_meme(template: dict, top: str, bottom: str) -> str | None:
    """Call Imgflip caption_image and return the meme image URL."""
    if not IMGFLIP_USERNAME or not IMGFLIP_PASSWORD:
        return None  # Credentials not set — return template preview image instead

    box_count = template.get("box_count", 2)

    if box_count <= 2:
        data = {
            "template_id": template["id"],
            "username": IMGFLIP_USERNAME,
            "password": IMGFLIP_PASSWORD,
            "text0": top.upper(),
            "text1": bottom.upper(),
        }
    else:
        # For multi-box templates, distribute text across first two boxes
        data = {
            "template_id": template["id"],
            "username": IMGFLIP_USERNAME,
            "password": IMGFLIP_PASSWORD,
            "boxes[0][text]": top.upper(),
            "boxes[1][text]": bottom.upper(),
        }

    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.post("https://api.imgflip.com/caption_image", data=data)
            result = r.json()
            if result.get("success"):
                return result["data"]["url"]
    except Exception as e:
        print(f"[imgflip] caption failed: {e}")

    return None


# ─── JSON extraction ──────────────────────────────────────────────────────────

def extract_json(text: str) -> dict:
    text = text.strip()
    match = re.search(r"```(?:json)?\s*([\s\S]+?)```", text)
    if match:
        text = match.group(1).strip()
    return json.loads(text)


# ─── Request / Response models ────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    image: str       # base64 JPEG
    context: str = ""
    streak: int = 0


class MemePayload(BaseModel):
    name: str
    image_url: str   # actual Imgflip-generated URL (or template preview)
    top: str
    bottom: str
    accent: str


class AnalyzeResponse(BaseModel):
    expression: str
    intensity: str
    emoji: str
    meme: MemePayload
    roast: str
    streak_label: str


STREAK_LABELS = {1: "", 2: " (x2 COMBO!)", 3: " (x3 TRIPLE!)",
                 4: " (x4 ULTRA!!)", 5: " (x5 LEGENDARY!!!)"}


# ─── Main endpoint ─────────────────────────────────────────────────────────────

@app.post("/api/analyze", response_model=AnalyzeResponse)
async def analyze_expression(req: AnalyzeRequest):
    context_block = f"\nUser situation: {req.context}" if req.context.strip() else ""
    streak_block = (
        f"\nThey've shown this SAME expression for {req.streak} cycles — go increasingly unhinged."
        if req.streak > 1 else ""
    )

    # 1. Ask Claude to classify expression + write captions
    try:
        message = anthropic_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=300,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": "image/jpeg", "data": req.image},
                    },
                    {
                        "type": "text",
                        "text": (
                            f"Analyze the facial expression. Be funny and internet-savvy."
                            f"{context_block}{streak_block}\n\n"
                            "Respond ONLY with raw JSON (no markdown):\n"
                            '{"expression":"<happy|surprised|sad|angry|disgusted|fearful|neutral>",'
                            '"intensity":"<mild|moderate|strong>",'
                            '"top":"<meme top text, ≤6 words>",'
                            '"bottom":"<meme punchline, ≤6 words>",'
                            '"roast":"<savage one-liner, ≤10 words>"}\n\n'
                            "If no face: expression=neutral, intensity=mild."
                        ),
                    },
                ],
            }],
        )
        result = extract_json(message.content[0].text)
    except Exception as e:
        result = {
            "expression": "neutral", "intensity": "mild",
            "top": "AI IS CONFUSED", "bottom": "BY YOUR FACE",
            "roast": f"Error: {str(e)[:40]}",
        }

    expression = result.get("expression", "neutral")
    if expression not in EXPRESSION_MEME_NAMES:
        expression = "neutral"

    top_text = result.get("top", "WHEN THE AI")
    bottom_text = result.get("bottom", "CANNOT READ YOU")

    # 2. Resolve Imgflip template
    template = resolve_template(expression)

    # 3. Generate captioned meme on Imgflip
    meme_url = None
    template_name = "Meme"

    if template:
        template_name = template["name"]
        meme_url = await generate_imgflip_meme(template, top_text, bottom_text)
        # If caption generation failed but we have credentials, fall back to template preview
        if not meme_url:
            meme_url = template.get("url", "")

    accent = EXPRESSION_COLORS.get(expression, {}).get("accent", "#7c3aed")
    streak_level = min(req.streak, 5)

    return AnalyzeResponse(
        expression=expression,
        intensity=result.get("intensity", "moderate"),
        emoji=EXPRESSION_EMOJIS[expression],
        meme=MemePayload(
            name=template_name,
            image_url=meme_url or "",
            top=top_text,
            bottom=bottom_text,
            accent=accent,
        ),
        roast=result.get("roast", "Interesting face."),
        streak_label=STREAK_LABELS.get(streak_level, STREAK_LABELS[5]),
    )


@app.get("/api/health")
async def health():
    creds_ok = bool(IMGFLIP_USERNAME and IMGFLIP_PASSWORD)
    return {
        "status": "ok",
        "model": "claude-haiku-4-5-20251001",
        "imgflip_templates": len(imgflip_catalog),
        "imgflip_credentials": creds_ok,
    }


# ─── Serve frontend ───────────────────────────────────────────────────────────

frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(frontend_dir):
    app.mount("/static", StaticFiles(directory=os.path.join(frontend_dir, "static")), name="static")

    @app.get("/")
    async def serve_frontend():
        return FileResponse(os.path.join(frontend_dir, "index.html"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
