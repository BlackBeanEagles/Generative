/* ─── Game State Manager ─────────────────────────────────────────────────────
   Mods 1,2,3/9,5,6,7,10 are computed server-side in battle mode.
   This file handles: client-side solo scoring, solo challenges, difficulty,
   WebSocket management, callbacks.  Exposes: window.game
────────────────────────────────────────────────────────────────────────────── */

(function () {
  // ── Scoring tables (mirror backend) ────────────────────────────────────────
  const DIFFICULTY_SCORES = {
    easy:   { mild: 10, moderate: 20, strong: 35 },
    hard:   { mild: 0,  moderate: 20, strong: 50 },
    expert: { mild: 0,  moderate: 0,  strong: 70 },
  };

  const COMBOS = {
    "happy→surprised":   ["WHIPLASH! 😲", 15],
    "angry→sad":         ["PLOT TWIST 😢", 20],
    "surprised→angry":   ["BETRAYED! 😠", 18],
    "sad→happy":         ["REDEMPTION ARC! 😄", 25],
    "neutral→angry":     ["TRIGGERED! 😤", 12],
    "happy→angry":       ["MOOD SWING! 😡", 15],
    "fearful→angry":     ["STAND YOUR GROUND! 💪", 20],
    "disgusted→surprised":["WHAT IS THAT?! 😱", 15],
    "surprised→happy":   ["PLEASANT SURPRISE! 🎉", 18],
    "angry→happy":       ["INSTANTLY COPED 😂", 22],
    "fearful→happy":     ["SURVIVED! 🎉", 20],
    "sad→surprised":     ["UNEXPECTED! 😮", 15],
    "disgusted→angry":   ["ABSOLUTELY NOT! 🚫", 16],
    "happy→sad":         ["BETRAYED 😭", 18],
    "fearful→surprised": ["OH WAIT WHAT?! 😨", 14],
    "angry→fearful":     ["ACTUALLY RECONSIDERED 😬", 17],
  };

  const CHALLENGE_EXPRESSIONS = ["happy", "surprised", "sad", "angry", "disgusted", "fearful"];
  const CHALLENGE_INTERVAL_MS = 20000;
  const CHALLENGE_WINDOW_MS   = 8000;
  const CHALLENGE_BONUS       = 50;
  const VARIETY_BONUS         = 10;
  const NEUTRAL_PENALTY       = 5;
  const COMEBACK_THRESHOLD    = 150;
  const COMEBACK_MULT         = 1.5;

  // ── Graph / color mappings ─────────────────────────────────────────────────
  const EXP_VALUES = { happy:6, surprised:5, fearful:4, neutral:3, sad:2, disgusted:1, angry:0 };
  const EXP_COLORS = {
    happy:"#FFD700", surprised:"#FF69B4", fearful:"#9370DB",
    neutral:"#708090", sad:"#4169E1", disgusted:"#6B8E23", angry:"#DC143C",
  };

  class Game {
    constructor() {
      this.mode         = null;        // 'solo' | 'battle'
      this.playerName   = "Player";
      this.roomCode     = null;
      this.isHost       = false;
      this.duration     = 60;
      this.difficulty   = "easy";      // Mod 5
      this.ws           = null;
      this.score        = 0;
      this.opponents    = {};          // name → {score, streak, comeback, ...}
      this.events       = [];
      this.startedAt    = null;
      this.ended        = false;
      this.timerInterval = null;
      this.memeHistory  = [];

      // Solo-mode local state for mods
      this._uniqueExps       = new Set();   // Mod 1
      this._consecutiveNeutral = 0;          // Mod 6
      this._lastExpression   = null;
      this._activeChallengeTarget = null;    // Mod 3/9
      this._challengeDeadline    = 0;
      this._soloChallengerId     = null;

      // Callbacks set by app.js
      this.onScoreUpdate   = null;
      this.onOpponentUpdate = null;
      this.onGameStart     = null;
      this.onGameEnd       = null;
      this.onPlayerJoined  = null;
      this.onTimerTick     = null;
      this.onChallenge     = null;    // Mod 3/9
      this.onChallengeExpired = null;
      this.onBonuses       = null;    // Mod 2,1,3
      this.onTimeMultiplier = null;   // Mod 7
      this.onComeback      = null;    // Mod 10
    }

    /* ── Client-side solo scoring (mirrors backend calc_score_full) ─────── */

    _calcSoloScore(expression, intensity, streak) {
      const scores = DIFFICULTY_SCORES[this.difficulty] || DIFFICULTY_SCORES.easy;
      const base = scores[intensity] || 0;
      if (base === 0) return { delta: 0, bonuses: [`${this.difficulty}: ${intensity} = 0 pts`] };

      const streakBonus = Math.min(streak - 1, 9) * 5;
      let score = base + streakBonus;
      const bonuses = [];

      // Mod 1: variety
      if (expression !== "neutral" && !this._uniqueExps.has(expression)) {
        score += VARIETY_BONUS;
        bonuses.push(`NEW EXPRESSION! +${VARIETY_BONUS}`);
      }

      // Mod 2: combo
      if (this._lastExpression && this._lastExpression !== expression) {
        const key = `${this._lastExpression}→${expression}`;
        const combo = COMBOS[key];
        if (combo) {
          score += combo[1];
          bonuses.push(`${combo[0]} +${combo[1]}`);
        }
      }

      // Mod 3/9: challenge
      if (this._activeChallengeTarget &&
          Date.now() < this._challengeDeadline &&
          expression === this._activeChallengeTarget) {
        score += CHALLENGE_BONUS;
        bonuses.push(`CHALLENGE COMPLETE! +${CHALLENGE_BONUS}`);
        this._activeChallengeTarget = null;
        if (this.onChallengeExpired) this.onChallengeExpired();
      }

      // Mod 6: neutral penalty
      if (expression === "neutral" && this._consecutiveNeutral >= 3) {
        score = Math.max(0, score - NEUTRAL_PENALTY);
        bonuses.push(`Zoned out... -${NEUTRAL_PENALTY}`);
      }

      // Mod 7: time multiplier
      const { mult, label } = this._timeMult();
      if (mult > 1.0) {
        score = Math.round(score * mult);
        bonuses.push(`⏱ ${label} ×${mult}`);
      }

      return { delta: score, bonuses };
    }

    _timeMult() {
      if (this.duration === 0 || !this.startedAt) return { mult: 1.0, label: "" };
      const remaining = this.duration - (Date.now() - this.startedAt) / 1000;
      if (remaining > 15) return { mult: 1.0, label: "" };
      if (remaining > 10) return { mult: 1.5, label: "LAST 15s" };
      if (remaining > 5)  return { mult: 2.0, label: "LAST 10s" };
      return { mult: 3.0, label: "CLUTCH TIME" };
    }

    _isInComeback() {
      const other = Object.values(this.opponents).map(o => o.score || 0);
      return other.length > 0 && (Math.max(...other) - this.score) >= COMEBACK_THRESHOLD;
    }

    /* ── Audio level ────────────────────────────────────────────────── */

    calcAudioLevel(streak) {
      if (!this.startedAt) return 0;
      const total = this.score + Object.values(this.opponents).reduce((s, o) => s + (o.score || 0), 0);
      if (streak >= 8 || total >= 900) return 4;
      if (streak >= 5 || total >= 450) return 3;
      if (streak >= 3 || total >= 120) return 2;
      return 1;
    }

    expValue(e) { return EXP_VALUES[e] ?? 3; }
    expColor(e) { return EXP_COLORS[e] ?? "#888"; }
    timeElapsed() { return this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0; }

    /* ── Room management ────────────────────────────────────────────── */

    async createRoom() {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: this.playerName, duration: this.duration, difficulty: this.difficulty }),
      });
      const data = await res.json();
      this.roomCode = data.code;
      this.isHost = true;
      this._connectWS();
      return data.code;
    }

    async joinRoom(code) {
      const info = await (await fetch(`/api/rooms/${code}`)).json();
      if (info.error) throw new Error(info.error);
      this.roomCode = code.toUpperCase();
      this.isHost = false;
      this.duration = info.duration;
      this.difficulty = info.difficulty || "easy";
      this._connectWS();
    }

    _connectWS() {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      this.ws = new WebSocket(`${proto}://${location.host}/ws/${this.roomCode}/${encodeURIComponent(this.playerName)}`);
      this.ws.onmessage = (e) => { try { this._handleMsg(JSON.parse(e.data)); } catch (_) {} };
      this.ws.onerror = () => { if (window.showToast) showToast("WebSocket error."); };
    }

    _handleMsg(msg) {
      switch (msg.type) {
        case "welcome":
          this.duration   = msg.duration;
          this.difficulty = msg.difficulty || "easy";
          if (this.onPlayerJoined) this.onPlayerJoined(msg.players, msg.is_host);
          break;
        case "player_joined":
        case "player_left":
          if (this.onPlayerJoined) this.onPlayerJoined(msg.players, this.isHost);
          break;
        case "game_started":
          this.difficulty = msg.difficulty || "easy";
          this._onStart(msg.duration);
          break;
        case "score_update":
          for (const [n, d] of Object.entries(msg.players)) {
            if (n !== this.playerName) this.opponents[n] = d;
            else if (d.score !== undefined) this.score = d.score;  // sync server score
          }
          if (this.onOpponentUpdate) this.onOpponentUpdate(msg.players);
          if (msg.triggerer === this.playerName && msg.bonuses?.length) {
            if (this.onBonuses) this.onBonuses(msg.bonuses);
          }
          // Mod 10: check comeback
          if (this._isInComeback()) {
            if (this.onComeback) this.onComeback(true);
          } else {
            if (this.onComeback) this.onComeback(false);
          }
          break;
        case "challenge":
          this._activeChallengeTarget = msg.target;
          this._challengeDeadline = Date.now() + msg.window * 1000;
          if (this.onChallenge) this.onChallenge(msg.emoji, msg.target, msg.window);
          break;
        case "challenge_expired":
          this._activeChallengeTarget = null;
          if (this.onChallengeExpired) this.onChallengeExpired();
          break;
        case "tick":
          if (this.onTimerTick) this.onTimerTick(msg.time_remaining);
          // Mod 7: broadcast time multiplier state
          const rem = msg.time_remaining;
          let mult = 1.0, tlabel = "";
          if (rem <= 5)       { mult = 3.0; tlabel = "CLUTCH TIME"; }
          else if (rem <= 10) { mult = 2.0; tlabel = "LAST 10s"; }
          else if (rem <= 15) { mult = 1.5; tlabel = "LAST 15s"; }
          if (this.onTimeMultiplier) this.onTimeMultiplier(mult, tlabel);
          break;
        case "game_ended":
          this._onEnd(msg.report);
          break;
      }
    }

    /* ── Game lifecycle ─────────────────────────────────────────────── */

    startSolo() {
      this.mode = "solo";
      this._onStart(this.duration);
    }

    startBattle() {
      if (this.ws?.readyState === WebSocket.OPEN)
        this.ws.send(JSON.stringify({ type: "start" }));
    }

    _onStart(duration) {
      this.startedAt = Date.now();
      this.duration = duration;
      this.ended = false;

      if (this.mode === "solo") {
        if (duration > 0) {
          let remaining = duration;
          this.timerInterval = setInterval(() => {
            remaining -= 1;
            if (this.onTimerTick) this.onTimerTick(remaining);
            // Mod 7 for solo
            let mult = 1.0, tlabel = "";
            if (remaining <= 5)       { mult = 3.0; tlabel = "CLUTCH TIME"; }
            else if (remaining <= 10) { mult = 2.0; tlabel = "LAST 10s"; }
            else if (remaining <= 15) { mult = 1.5; tlabel = "LAST 15s"; }
            if (this.onTimeMultiplier) this.onTimeMultiplier(mult, tlabel);
            if (remaining <= 0) { clearInterval(this.timerInterval); this._onEnd(this._buildLocalReport()); }
          }, 1000);
        }
        // Mod 3/9: solo challenges
        this._soloChallengerId = setTimeout(() => this._soloChallenge(), CHALLENGE_INTERVAL_MS);
      }

      if (this.onGameStart) this.onGameStart(duration);
    }

    _soloChallenge() {
      if (this.ended || !this.startedAt) return;
      const remaining = this.duration === 0 ? Infinity : this.duration - (Date.now() - this.startedAt) / 1000;
      if (remaining > 12) {
        const target = CHALLENGE_EXPRESSIONS[Math.floor(Math.random() * CHALLENGE_EXPRESSIONS.length)];
        const emojis = { happy:"😄", surprised:"😮", sad:"😢", angry:"😠", disgusted:"🤢", fearful:"😨" };
        this._activeChallengeTarget = target;
        this._challengeDeadline = Date.now() + CHALLENGE_WINDOW_MS;
        if (this.onChallenge) this.onChallenge(emojis[target] || "😐", target, CHALLENGE_WINDOW_MS / 1000);
        setTimeout(() => {
          if (this._activeChallengeTarget === target) {
            this._activeChallengeTarget = null;
            if (this.onChallengeExpired) this.onChallengeExpired();
          }
        }, CHALLENGE_WINDOW_MS);
      }
      this._soloChallengerId = setTimeout(() => this._soloChallenge(), CHALLENGE_INTERVAL_MS + CHALLENGE_WINDOW_MS);
    }

    _onEnd(report) {
      this.ended = true;
      clearInterval(this.timerInterval);
      clearTimeout(this._soloChallengerId);
      if (this.onGameEnd) this.onGameEnd(report || this._buildLocalReport());
    }

    endManually() {
      if (this.ended) return;
      if (this.mode === "battle" && this.isHost && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "end_game" }));
      } else {
        this._onEnd(this._buildLocalReport());
      }
    }

    /* ── Scoring (solo mode — battle scoring is server-side) ──────── */

    reportExpression(expression, intensity, memeName, memeUrl, streak) {
      if (!this.startedAt || this.ended) return { scoreDelta: 0, audioLevel: 0 };

      let scoreDelta, bonuses;

      if (this.mode === "solo") {
        // Client computes score for solo
        const result = this._calcSoloScore(expression, intensity, streak);
        scoreDelta = result.delta;
        bonuses = result.bonuses;

        // Mod 10: comeback in solo (comparing to personal best doesn't apply — skip)
        // Update local state
        if (expression === "neutral") this._consecutiveNeutral++;
        else { this._consecutiveNeutral = 0; this._uniqueExps.add(expression); }
        this._lastExpression = expression;

        this.score += scoreDelta;
        if (bonuses.length && this.onBonuses) this.onBonuses(bonuses);
      } else {
        // Battle mode: server computes score, client just sends raw data
        // score_delta used here is optimistic estimate for instant feedback
        const result = this._calcSoloScore(expression, intensity, streak);
        scoreDelta = result.delta;
        bonuses = [];
      }

      this.events.push({
        t: Math.round(this.timeElapsed()), expression, intensity,
        score_delta: scoreDelta, meme_name: memeName, streak,
      });

      if (memeUrl) { this.memeHistory.unshift(memeUrl); if (this.memeHistory.length > 6) this.memeHistory.pop(); }

      if (this.mode === "battle" && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: "score", expression, intensity,
          meme_name: memeName, meme_url: memeUrl,
          streak, score_delta: scoreDelta,
        }));
      }

      const audioLevel = this.calcAudioLevel(streak);
      if (this.onScoreUpdate) this.onScoreUpdate(this.score, scoreDelta);
      return { scoreDelta, audioLevel };
    }

    _buildLocalReport() {
      const counts = {};
      for (const ev of this.events) counts[ev.expression] = (counts[ev.expression] || 0) + 1;
      const topExp = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || "neutral";
      return {
        duration_played: this.timeElapsed(),
        players: {
          [this.playerName]: {
            score: this.score, total_expressions: this.events.length,
            expression_counts: counts, top_expression: topExp,
            max_streak: Math.max(0, ...this.events.map(e => e.streak)),
            events: this.events,
          },
        },
      };
    }

    reset() {
      clearInterval(this.timerInterval);
      clearTimeout(this._soloChallengerId);
      if (this.ws) { try { this.ws.close(); } catch (_) {} }
      Object.assign(this, {
        score: 0, opponents: {}, events: [], memeHistory: [],
        startedAt: null, ended: false, ws: null, roomCode: null,
        _uniqueExps: new Set(), _consecutiveNeutral: 0,
        _lastExpression: null, _activeChallengeTarget: null, _challengeDeadline: 0,
      });
    }
  }

  window.game = new Game();
  window.EXP_COLORS = EXP_COLORS;
  window.EXP_VALUES = EXP_VALUES;
})();
