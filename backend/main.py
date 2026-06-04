import asyncio
import json
import os
import random
import re
import time
from difflib import get_close_matches

import anthropic
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from game_manager import GameManager, calc_score
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
game_manager = GameManager()

imgflip_catalog: dict[str, dict] = {}
IMGFLIP_USERNAME = os.getenv("IMGFLIP_USERNAME", "")
IMGFLIP_PASSWORD = os.getenv("IMGFLIP_PASSWORD", "")

EXPRESSION_EMOJIS = {
    "happy": "😄", "surprised": "😮", "sad": "😢",
    "angry": "😠", "disgusted": "🤢", "fearful": "😨", "neutral": "😐",
}
STREAK_LABELS = {
    1: "", 2: " (x2 COMBO!)", 3: " (x3 TRIPLE!)",
    4: " (x4 ULTRA!!)", 5: " (x5 LEGENDARY!!!)",
}


# ─── Startup ─────────────────────────────────────────────────────────────────

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


# ─── Meme helpers ─────────────────────────────────────────────────────────────

def resolve_template(expression: str) -> dict | None:
    candidates = EXPRESSION_MEME_NAMES.get(expression, [])
    for name in candidates:
        key = name.lower()
        if key in imgflip_catalog:
            return imgflip_catalog[key]
        matches = get_close_matches(key, imgflip_catalog.keys(), n=1, cutoff=0.6)
        if matches:
            return imgflip_catalog[matches[0]]
    return random.choice(list(imgflip_catalog.values())) if imgflip_catalog else None


async def generate_imgflip_meme(template: dict, top: str, bottom: str) -> str | None:
    if not IMGFLIP_USERNAME or not IMGFLIP_PASSWORD:
        return None
    box_count = template.get("box_count", 2)
    if box_count <= 2:
        data = {
            "template_id": template["id"], "username": IMGFLIP_USERNAME,
            "password": IMGFLIP_PASSWORD, "text0": top.upper(), "text1": bottom.upper(),
        }
    else:
        data = {
            "template_id": template["id"], "username": IMGFLIP_USERNAME,
            "password": IMGFLIP_PASSWORD,
            "boxes[0][text]": top.upper(), "boxes[1][text]": bottom.upper(),
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


def extract_json(text: str) -> dict:
    text = text.strip()
    match = re.search(r"```(?:json)?\s*([\s\S]+?)```", text)
    if match:
        text = match.group(1).strip()
    return json.loads(text)


# ─── Analyze endpoint ─────────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    image: str
    context: str = ""
    streak: int = 0


class MemePayload(BaseModel):
    name: str
    image_url: str
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


@app.post("/api/analyze", response_model=AnalyzeResponse)
async def analyze_expression(req: AnalyzeRequest):
    context_block = f"\nUser situation: {req.context}" if req.context.strip() else ""
    streak_block = (
        f"\nSame expression repeated {req.streak} times — go increasingly unhinged."
        if req.streak > 1 else ""
    )

    try:
        message = anthropic_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=300,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": req.image}},
                    {"type": "text", "text": (
                        f"Analyze the facial expression. Be funny and internet-savvy."
                        f"{context_block}{streak_block}\n\n"
                        'Respond ONLY with raw JSON (no markdown):\n'
                        '{"expression":"<happy|surprised|sad|angry|disgusted|fearful|neutral>",'
                        '"intensity":"<mild|moderate|strong>",'
                        '"top":"<meme top text, ≤6 words>",'
                        '"bottom":"<meme punchline, ≤6 words>",'
                        '"roast":"<savage one-liner, ≤10 words>"}\n\n'
                        "If no face: expression=neutral, intensity=mild."
                    )},
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

    template = resolve_template(expression)
    meme_url = ""
    template_name = "Meme"

    if template:
        template_name = template["name"]
        meme_url = await generate_imgflip_meme(template, top_text, bottom_text) or template.get("url", "")

    accent = EXPRESSION_COLORS.get(expression, {}).get("accent", "#7c3aed")
    streak_level = min(req.streak, 5)

    return AnalyzeResponse(
        expression=expression,
        intensity=result.get("intensity", "moderate"),
        emoji=EXPRESSION_EMOJIS[expression],
        meme=MemePayload(name=template_name, image_url=meme_url, top=top_text, bottom=bottom_text, accent=accent),
        roast=result.get("roast", "Interesting face."),
        streak_label=STREAK_LABELS.get(streak_level, STREAK_LABELS[5]),
    )


# ─── Room endpoints ───────────────────────────────────────────────────────────

class CreateRoomRequest(BaseModel):
    host: str
    duration: int = 60


@app.post("/api/rooms")
async def create_room(req: CreateRoomRequest):
    game_manager.cleanup_old_rooms()
    room = game_manager.create_room(host=req.host.strip() or "Player", duration=req.duration)
    return {"code": room.code, "host": room.host, "duration": room.duration}


@app.get("/api/rooms/{code}")
async def get_room(code: str):
    room = game_manager.get_room(code)
    if not room:
        return {"error": "Room not found"}
    return {
        "code": room.code,
        "host": room.host,
        "duration": room.duration,
        "players": list(room.players.keys()),
        "started": room.started_at is not None,
        "ended": room.ended,
    }


# ─── WebSocket game endpoint ──────────────────────────────────────────────────

@app.websocket("/ws/{code}/{player_name}")
async def game_ws(ws: WebSocket, code: str, player_name: str):
    room = game_manager.get_room(code)
    if not room:
        await ws.close(code=4004, reason="Room not found")
        return

    await ws.accept()
    name = player_name.strip() or f"Player{len(room.players) + 1}"
    room.players[name] = type("P", (), {
        "name": name, "ws": ws, "score": 0, "streak": 0,
        "last_expression": None, "connected": True, "events": [],
    })()

    # Import actual PlayerState
    from game_manager import PlayerState
    room.players[name] = PlayerState(name=name, ws=ws)

    # Welcome this player
    await ws.send_text(json.dumps({
        "type": "welcome",
        "room": room.code,
        "host": room.host,
        "is_host": name == room.host,
        "players": list(room.players.keys()),
        "duration": room.duration,
        "started": room.started_at is not None,
    }))

    # Notify others
    await game_manager.broadcast(room, {
        "type": "player_joined",
        "name": name,
        "players": list(room.players.keys()),
    }, exclude=name)

    async def game_timer():
        if room.duration == 0:
            return
        start = time.time()
        while True:
            await asyncio.sleep(1)
            remaining = room.duration - (time.time() - start)
            await game_manager.broadcast(room, {
                "type": "tick",
                "time_remaining": max(0, round(remaining, 1)),
            })
            if remaining <= 0:
                if not room.ended:
                    room.ended = True
                    await game_manager.broadcast(room, {
                        "type": "game_ended",
                        "report": room.build_report(),
                    })
                break

    timer_task = None

    try:
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            mtype = msg.get("type")

            if mtype == "start" and name == room.host and not room.started_at:
                room.started_at = time.time()
                await game_manager.broadcast(room, {
                    "type": "game_started",
                    "duration": room.duration,
                })
                if room.duration > 0:
                    timer_task = asyncio.create_task(game_timer())

            elif mtype == "score" and room.is_active():
                p = room.players[name]
                expression = msg.get("expression", "neutral")
                intensity = msg.get("intensity", "mild")
                meme_name = msg.get("meme_name", "")
                streak = msg.get("streak", 1)

                # Update streak tracking
                if expression == p.last_expression:
                    p.streak = min(p.streak + 1, 15)
                else:
                    p.streak = 1
                    p.last_expression = expression

                score_delta = calc_score(intensity, p.streak)
                p.score += score_delta

                p.events.append({
                    "t": round(time.time() - room.started_at, 1),
                    "expression": expression,
                    "intensity": intensity,
                    "score_delta": score_delta,
                    "meme_name": meme_name,
                    "streak": p.streak,
                })

                await game_manager.broadcast(room, {
                    "type": "score_update",
                    "players": room.scoreboard(),
                    "triggerer": name,
                    "delta": score_delta,
                })

            elif mtype == "end_game" and name == room.host and not room.ended:
                room.ended = True
                if timer_task:
                    timer_task.cancel()
                await game_manager.broadcast(room, {
                    "type": "game_ended",
                    "report": room.build_report(),
                })

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[ws] error for {name}: {e}")
    finally:
        if name in room.players:
            room.players[name].connected = False
        await game_manager.broadcast(room, {
            "type": "player_left",
            "name": name,
            "players": [n for n, p in room.players.items() if p.connected],
        }, exclude=name)


# ─── Health + static ──────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "model": "claude-haiku-4-5-20251001",
        "imgflip_templates": len(imgflip_catalog),
        "imgflip_credentials": bool(IMGFLIP_USERNAME and IMGFLIP_PASSWORD),
        "active_rooms": len(game_manager.rooms),
    }


frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(frontend_dir):
    app.mount("/static", StaticFiles(directory=os.path.join(frontend_dir, "static")), name="static")

    @app.get("/")
    async def serve_frontend():
        return FileResponse(os.path.join(frontend_dir, "index.html"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
