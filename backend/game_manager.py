import json
import random
import string
import time
from dataclasses import dataclass, field
from typing import Any

# ─── Scoring tables ───────────────────────────────────────────────────────────

DIFFICULTY_SCORES = {
    "easy":   {"mild": 10, "moderate": 20, "strong": 35},
    "hard":   {"mild": 0,  "moderate": 20, "strong": 50},   # mild = 0, strong boosted
    "expert": {"mild": 0,  "moderate": 0,  "strong": 70},   # only strong counts
}

# ─── Modification 2: Transition combos ───────────────────────────────────────

COMBOS: dict[tuple, tuple] = {
    ("happy",    "surprised"):  ("WHIPLASH! 😲",          15),
    ("angry",    "sad"):        ("PLOT TWIST 😢",          20),
    ("surprised","angry"):      ("BETRAYED! 😠",           18),
    ("sad",      "happy"):      ("REDEMPTION ARC! 😄",     25),
    ("neutral",  "angry"):      ("TRIGGERED! 😤",          12),
    ("happy",    "angry"):      ("MOOD SWING! 😡",         15),
    ("fearful",  "angry"):      ("STAND YOUR GROUND! 💪",  20),
    ("disgusted","surprised"):  ("WHAT IS THAT?! 😱",      15),
    ("surprised","happy"):      ("PLEASANT SURPRISE! 🎉",  18),
    ("angry",    "happy"):      ("INSTANTLY COPED 😂",     22),
    ("fearful",  "happy"):      ("SURVIVED! 🎉",           20),
    ("sad",      "surprised"):  ("UNEXPECTED! 😮",         15),
    ("disgusted","angry"):      ("ABSOLUTELY NOT! 🚫",     16),
    ("happy",    "sad"):        ("BETRAYED 😭",            18),
    ("fearful",  "surprised"):  ("OH WAIT WHAT?! 😨",      14),
    ("angry",    "fearful"):    ("ACTUALLY RECONSIDERED 😬", 17),
}

# ─── Modification 3 + 9: Challenge system ────────────────────────────────────

CHALLENGE_EXPRESSIONS = ["happy", "surprised", "sad", "angry", "disgusted", "fearful"]
CHALLENGE_INTERVAL = 20    # seconds between challenges
CHALLENGE_WINDOW = 8       # seconds player has to complete it
CHALLENGE_BONUS = 50

# ─── Other tuning constants ───────────────────────────────────────────────────

VARIETY_BONUS = 10          # Mod 1: per new expression type (non-neutral)
NEUTRAL_PENALTY = 5         # Mod 6: deducted after 3 consecutive neutrals
COMEBACK_THRESHOLD = 150    # Mod 10: pts behind to trigger comeback
COMEBACK_MULT = 1.5         # Mod 10: score multiplier when behind

EXPRESSION_EMOJIS = {
    "happy": "😄", "surprised": "😮", "sad": "😢",
    "angry": "😠", "disgusted": "🤢", "fearful": "😨", "neutral": "😐",
}


# ─── Data classes ─────────────────────────────────────────────────────────────

@dataclass
class PlayerState:
    name: str
    ws: Any                                       # WebSocket
    score: int = 0
    streak: int = 0
    last_expression: str | None = None
    connected: bool = True
    unique_expressions: set = field(default_factory=set)   # Mod 1
    consecutive_neutral: int = 0                            # Mod 6
    current_meme_url: str = ""
    events: list = field(default_factory=list)


@dataclass
class GameRoom:
    code: str
    host: str
    duration: int
    difficulty: str = "easy"                      # Mod 5
    players: dict = field(default_factory=dict)   # name → PlayerState
    spectators: list = field(default_factory=list) # Mod 4: WebSocket list
    votes: dict = field(default_factory=dict)      # Mod 4: name → vote count
    current_challenge: str | None = None           # Mod 3/9
    challenge_deadline: float = 0.0                # Mod 3/9
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
                "meme_url": p.current_meme_url,         # Mod 4: spectators need this
                "comeback": _is_in_comeback(p, self),    # Mod 10
            }
            for name, p in self.players.items()
        }

    def build_report(self) -> dict:
        elapsed = (time.time() - self.started_at) if self.started_at else 0
        report = {"duration_played": round(elapsed, 1), "players": {}}
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
                "crowd_votes": self.votes.get(name, 0),  # Mod 4
                "events": p.events,
            }
        return report


# ─── Scoring engine ───────────────────────────────────────────────────────────

def _is_in_comeback(player: PlayerState, room: GameRoom) -> bool:
    """Mod 10: True if player is trailing the leader by ≥ threshold."""
    other = [p.score for n, p in room.players.items() if n != player.name and p.connected]
    return bool(other) and (max(other) - player.score) >= COMEBACK_THRESHOLD


def _time_multiplier(room: GameRoom) -> tuple[float, str]:
    """Mod 7: Multiplier + label based on time remaining."""
    if room.duration == 0:
        return 1.0, ""
    rem = room.time_remaining()
    if rem > 15:  return 1.0, ""
    if rem > 10:  return 1.5, "LAST 15s"
    if rem > 5:   return 2.0, "LAST 10s"
    return 3.0, "CLUTCH TIME"


def calc_score_full(
    player: PlayerState,
    room: GameRoom,
    expression: str,
    intensity: str,
) -> tuple[int, list[str]]:
    """
    Returns (score_delta, [bonus_label, ...]).
    Applies mods 1, 2, 3/9, 5, 6, 7, 10 in order.
    """
    bonuses: list[str] = []

    # Mod 5: Difficulty base score (filters easy expressions on harder modes)
    base = DIFFICULTY_SCORES[room.difficulty].get(intensity, 0)
    if base == 0:
        label = {"hard": "Hard: mild = 0 pts", "expert": "Expert: only STRONG counts!"}
        return 0, [label.get(room.difficulty, "")]

    # Streak bonus (same across difficulties)
    streak_bonus = min(player.streak - 1, 9) * 5
    score = base + streak_bonus

    # Mod 1: Variety bonus — first time player uses this expression type
    if expression != "neutral" and expression not in player.unique_expressions:
        score += VARIETY_BONUS
        bonuses.append(f"NEW EXPRESSION! +{VARIETY_BONUS}")

    # Mod 2: Combo bonus — specific expression transitions
    if player.last_expression and player.last_expression != expression:
        combo = COMBOS.get((player.last_expression, expression))
        if combo:
            label_c, pts_c = combo
            score += pts_c
            bonuses.append(f"{label_c} +{pts_c}")

    # Mod 3/9: Challenge bonus — expression matches active challenge
    now = time.time()
    if (room.current_challenge and
            room.challenge_deadline > now and
            expression == room.current_challenge):
        score += CHALLENGE_BONUS
        bonuses.append(f"CHALLENGE COMPLETE! +{CHALLENGE_BONUS}")
        room.current_challenge = None  # each challenge claimable once

    # Mod 6: Neutral penalty — 3+ consecutive neutrals
    if expression == "neutral" and player.consecutive_neutral >= 3:
        score = max(0, score - NEUTRAL_PENALTY)
        bonuses.append(f"Zoned out... -{NEUTRAL_PENALTY}")

    # Mod 7: Time multiplier (applied after bonuses)
    tmult, tlabel = _time_multiplier(room)
    if tmult > 1.0:
        score = int(score * tmult)
        bonuses.append(f"⏱ {tlabel} ×{tmult:.0f}")

    # Mod 10: Comeback multiplier (applied last)
    if _is_in_comeback(player, room):
        score = int(score * COMEBACK_MULT)
        bonuses.append("🔥 COMEBACK ×1.5")

    return score, bonuses


# ─── Game manager ─────────────────────────────────────────────────────────────

class GameManager:
    def __init__(self):
        self.rooms: dict[str, GameRoom] = {}

    def create_room(self, host: str, duration: int = 60, difficulty: str = "easy") -> GameRoom:
        for _ in range(30):
            code = "".join(random.choices(string.ascii_uppercase, k=4))
            if code not in self.rooms:
                break
        room = GameRoom(code=code, host=host, duration=duration, difficulty=difficulty)
        self.rooms[code] = room
        return room

    def get_room(self, code: str) -> GameRoom | None:
        return self.rooms.get(code.upper())

    def cleanup_old_rooms(self):
        cutoff = time.time() - 7200
        stale = [c for c, r in self.rooms.items() if r.created_at < cutoff]
        for c in stale:
            del self.rooms[c]

    async def broadcast(self, room: GameRoom, msg: dict, exclude: str | None = None):
        """Send to all connected players (+ spectators via broadcast_all)."""
        text = json.dumps(msg)
        for name, player in list(room.players.items()):
            if name == exclude or not player.connected:
                continue
            try:
                await player.ws.send_text(text)
            except Exception:
                player.connected = False

    async def broadcast_all(self, room: GameRoom, msg: dict, exclude: str | None = None):
        """Send to players AND spectators."""
        await self.broadcast(room, msg, exclude=exclude)
        text = json.dumps(msg)
        dead = []
        for i, ws in enumerate(room.spectators):
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(i)
        for i in reversed(dead):
            room.spectators.pop(i)
