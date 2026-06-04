/* ─── Game State Manager ─────────────────────────────────────────────────────
   Handles: mode selection, WebSocket rooms, scoring, timer, audio intensity.
   Exposes: window.game
────────────────────────────────────────────────────────────────────────────── */

(function () {
  const SCORE_TABLE = { mild: 10, moderate: 20, strong: 35 };

  // Expression → numeric value for graph
  const EXP_VALUES = {
    happy: 6, surprised: 5, fearful: 4, neutral: 3,
    sad: 2, disgusted: 1, angry: 0,
  };
  const EXP_COLORS = {
    happy: "#FFD700", surprised: "#FF69B4", fearful: "#9370DB",
    neutral: "#708090", sad: "#4169E1", disgusted: "#6B8E23", angry: "#DC143C",
  };

  class Game {
    constructor() {
      this.mode = null;         // 'solo' | 'battle'
      this.playerName = "Player";
      this.roomCode = null;
      this.isHost = false;
      this.duration = 60;       // seconds; 0 = unlimited
      this.ws = null;
      this.score = 0;
      this.opponents = {};      // name → {score, streak, last_expression}
      this.events = [];         // {t, expression, intensity, score_delta, meme_name, streak}
      this.startedAt = null;    // Date.now() when game started
      this.ended = false;
      this.timerInterval = null;
      this.memeHistory = [];    // for report - last 6 meme image_urls

      // Callbacks — set by app.js
      this.onScoreUpdate = null;
      this.onOpponentUpdate = null;
      this.onGameStart = null;
      this.onGameEnd = null;
      this.onPlayerJoined = null;
      this.onTimerTick = null;
    }

    /* ── Utility ─────────────────────────────────────────────────── */

    calcScoreDelta(intensity, streak) {
      return (SCORE_TABLE[intensity] || 10) + Math.min(streak - 1, 9) * 5;
    }

    calcAudioLevel(streak) {
      if (!this.startedAt) return 0;
      const total = this.score + Object.values(this.opponents)
        .reduce((sum, o) => sum + (o.score || 0), 0);
      const scores = Object.values(this.opponents).map(o => o.score || 0);
      const gap = scores.length > 0
        ? Math.abs(this.score - Math.max(...scores)) / Math.max(1, Math.max(this.score, ...scores))
        : 1;

      if (streak >= 8 || total >= 900) return 4;
      if (streak >= 5 || total >= 450 || (scores.length > 0 && gap < 0.08)) return 3;
      if (streak >= 3 || total >= 120) return 2;
      return 1;
    }

    expValue(exp) { return EXP_VALUES[exp] ?? 3; }
    expColor(exp) { return EXP_COLORS[exp] ?? "#888"; }

    timeElapsed() {
      return this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0;
    }

    /* ── Room management ─────────────────────────────────────────── */

    async createRoom() {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: this.playerName, duration: this.duration }),
      });
      const data = await res.json();
      this.roomCode = data.code;
      this.isHost = true;
      this._connectWS();
      return data.code;
    }

    async joinRoom(code) {
      const check = await fetch(`/api/rooms/${code}`);
      const info = await check.json();
      if (info.error) throw new Error(info.error);
      this.roomCode = code.toUpperCase();
      this.isHost = false;
      this.duration = info.duration;
      this._connectWS();
    }

    _connectWS() {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const name = encodeURIComponent(this.playerName);
      this.ws = new WebSocket(`${proto}://${location.host}/ws/${this.roomCode}/${name}`);

      this.ws.onmessage = (e) => {
        try { this._handleMsg(JSON.parse(e.data)); } catch (_) {}
      };

      this.ws.onerror = () => {
        if (window.showToast) showToast("WebSocket error — check server is running.");
      };
    }

    _handleMsg(msg) {
      switch (msg.type) {
        case "welcome":
          this.duration = msg.duration;
          if (this.onPlayerJoined) this.onPlayerJoined(msg.players, msg.is_host);
          break;
        case "player_joined":
          if (this.onPlayerJoined) this.onPlayerJoined(msg.players, this.isHost);
          break;
        case "player_left":
          if (this.onPlayerJoined) this.onPlayerJoined(msg.players, this.isHost);
          break;
        case "game_started":
          this._onStart(msg.duration);
          break;
        case "score_update":
          for (const [name, data] of Object.entries(msg.players)) {
            if (name !== this.playerName) this.opponents[name] = data;
          }
          if (this.onOpponentUpdate) this.onOpponentUpdate(msg.players);
          break;
        case "tick":
          if (this.onTimerTick) this.onTimerTick(msg.time_remaining);
          break;
        case "game_ended":
          this._onEnd(msg.report);
          break;
      }
    }

    /* ── Game lifecycle ──────────────────────────────────────────── */

    startSolo() {
      this.mode = "solo";
      this._onStart(this.duration);
    }

    startBattle() {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "start" }));
      }
    }

    _onStart(duration) {
      this.startedAt = Date.now();
      this.duration = duration;
      this.ended = false;

      if (this.mode === "solo" && duration > 0) {
        let remaining = duration;
        this.timerInterval = setInterval(() => {
          remaining -= 1;
          if (this.onTimerTick) this.onTimerTick(remaining);
          if (remaining <= 0) {
            clearInterval(this.timerInterval);
            this._onEnd(this._buildLocalReport());
          }
        }, 1000);
      }

      if (this.onGameStart) this.onGameStart(duration);
    }

    _onEnd(report) {
      this.ended = true;
      clearInterval(this.timerInterval);
      if (this.onGameEnd) this.onGameEnd(report);
    }

    endManually() {
      if (this.ended) return;
      if (this.mode === "battle" && this.isHost && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "end_game" }));
      } else {
        this._onEnd(this._buildLocalReport());
      }
    }

    /* ── Scoring ─────────────────────────────────────────────────── */

    reportExpression(expression, intensity, memeName, memeUrl, streak) {
      if (!this.startedAt || this.ended) return { scoreDelta: 0, audioLevel: 0 };

      const scoreDelta = this.calcScoreDelta(intensity, streak);
      this.score += scoreDelta;

      const ev = {
        t: Math.round(this.timeElapsed()),
        expression,
        intensity,
        score_delta: scoreDelta,
        meme_name: memeName,
        streak,
      };
      this.events.push(ev);

      // Keep meme image history for report
      if (memeUrl) {
        this.memeHistory.unshift(memeUrl);
        if (this.memeHistory.length > 6) this.memeHistory.pop();
      }

      // Send to WebSocket room if in battle mode
      if (this.mode === "battle" && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: "score",
          expression, intensity,
          meme_name: memeName,
          streak,
          score_delta: scoreDelta,
        }));
      }

      const audioLevel = this.calcAudioLevel(streak);
      if (this.onScoreUpdate) this.onScoreUpdate(this.score, scoreDelta);

      return { scoreDelta, audioLevel };
    }

    /* ── Local report (solo mode or offline fallback) ─────────────── */

    _buildLocalReport() {
      const counts = {};
      for (const ev of this.events) {
        counts[ev.expression] = (counts[ev.expression] || 0) + 1;
      }
      const topExp = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || "neutral";
      const maxStreak = Math.max(0, ...this.events.map(e => e.streak));

      return {
        duration_played: this.timeElapsed(),
        players: {
          [this.playerName]: {
            score: this.score,
            total_expressions: this.events.length,
            expression_counts: counts,
            top_expression: topExp,
            max_streak: maxStreak,
            events: this.events,
          },
        },
      };
    }

    reset() {
      clearInterval(this.timerInterval);
      if (this.ws) { try { this.ws.close(); } catch (_) {} }
      this.score = 0;
      this.opponents = {};
      this.events = [];
      this.memeHistory = [];
      this.startedAt = null;
      this.ended = false;
      this.ws = null;
      this.roomCode = null;
    }
  }

  window.game = new Game();
  window.EXP_COLORS = EXP_COLORS;
  window.EXP_VALUES = { happy: 6, surprised: 5, fearful: 4, neutral: 3, sad: 2, disgusted: 1, angry: 0 };
})();
