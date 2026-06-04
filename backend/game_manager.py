import json
import random
import string
import time
from dataclasses import dataclass, field
from typing import Any

SCORE_TABLE = {"mild": 10, "moderate": 20, "strong": 35}


@dataclass
class PlayerState:
    name: str
    ws: Any  # WebSocket — excluded from serialization
    score: int = 0
    streak: int = 0
    last_expression: str | None = None
    connected: bool = True
    events: list = field(default_factory=list)


@dataclass
class GameRoom:
    code: str
    host: str
    duration: int  # seconds; 0 = unlimited
    players: dict = field(default_factory=dict)  # name → PlayerState
    started_at: float | None = None
    ended: bool = False
    created_at: float = field(default_factory=time.time)

    def is_active(self) -> bool:
        if not self.started_at or self.ended:
            return False
        if self.duration == 0:
            return True
        return (time.time() - self.started_at) < self.duration

    def time_remaining(self) -> float:
        if self.duration == 0:
            return float("inf")
        if not self.started_at:
            return float(self.duration)
        return max(0.0, self.duration - (time.time() - self.started_at))

    def scoreboard(self) -> dict:
        return {
            name: {
                "score": p.score,
                "streak": p.streak,
                "last_expression": p.last_expression,
                "connected": p.connected,
            }
            for name, p in self.players.items()
        }

    def build_report(self) -> dict:
        duration_played = (time.time() - self.started_at) if self.started_at else 0
        report = {"duration_played": round(duration_played, 1), "players": {}}
        for name, p in self.players.items():
            counts: dict[str, int] = {}
            for ev in p.events:
                counts[ev["expression"]] = counts.get(ev["expression"], 0) + 1
            top_exp = max(counts, key=counts.get) if counts else "neutral"
            max_streak = max((ev["streak"] for ev in p.events), default=0)
            report["players"][name] = {
                "score": p.score,
                "total_expressions": len(p.events),
                "expression_counts": counts,
                "top_expression": top_exp,
                "max_streak": max_streak,
                "events": p.events,
            }
        return report


def calc_score(intensity: str, streak: int) -> int:
    base = SCORE_TABLE.get(intensity, 10)
    streak_bonus = min(streak - 1, 9) * 5
    return base + streak_bonus


class GameManager:
    def __init__(self):
        self.rooms: dict[str, GameRoom] = {}

    def create_room(self, host: str, duration: int = 60) -> GameRoom:
        for _ in range(30):
            code = "".join(random.choices(string.ascii_uppercase, k=4))
            if code not in self.rooms:
                break
        room = GameRoom(code=code, host=host, duration=duration)
        self.rooms[code] = room
        return room

    def get_room(self, code: str) -> GameRoom | None:
        return self.rooms.get(code.upper())

    def cleanup_old_rooms(self):
        cutoff = time.time() - 7200  # 2 hours
        stale = [c for c, r in self.rooms.items() if r.created_at < cutoff]
        for c in stale:
            del self.rooms[c]

    async def broadcast(self, room: GameRoom, msg: dict, exclude: str | None = None):
        text = json.dumps(msg)
        for name, player in list(room.players.items()):
            if name == exclude or not player.connected:
                continue
            try:
                await player.ws.send_text(text)
            except Exception:
                player.connected = False
