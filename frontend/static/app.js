/* ─── Main App Controller ────────────────────────────────────────────────────
   Orchestrates: lobby → game → report screens.
   Coordinates: camera, Claude analysis, game scoring, audio, graph, history.
────────────────────────────────────────────────────────────────────────────── */

/* ── Screen routing ─────────────────────────────────────────────────────── */
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => (s.style.display = "none"));
  document.getElementById(id).style.display = "flex";
}

/* ── Analysis state ─────────────────────────────────────────────────────── */
const state = {
  active: false,
  analyzing: false,
  lastExpression: null,
  streak: 0,
  history: [],
  intervalId: null,
  INTERVAL_MS: 2800,
  MAX_HISTORY: 10,
};

/* ── DOM refs (game screen) ─────────────────────────────────────────────── */
const video           = document.getElementById("video");
const canvasHidden    = document.getElementById("canvas-hidden");
const ctx2d           = canvasHidden.getContext("2d");
const startBtn        = document.getElementById("start-btn");
const stopBtn         = document.getElementById("stop-btn");
const shareBtn        = document.getElementById("share-btn");
const endGameBtn      = document.getElementById("end-game-btn");
const statusDot       = document.getElementById("status-dot");
const expressionEmoji = document.getElementById("expression-emoji");
const expressionLabel = document.getElementById("expression-label");
const intensityFill   = document.getElementById("intensity-fill");
const streakBadge     = document.getElementById("streak-badge");
const scoreDeltaFlash = document.getElementById("score-delta-flash");
const latencyTag      = document.getElementById("latency-tag");
const memeCard        = document.getElementById("meme-card");
const memePlaceholder = document.getElementById("meme-placeholder");
const memeImgWrap     = document.getElementById("meme-img-wrap");
const memeImg         = document.getElementById("meme-img");
const memeNameTag     = document.getElementById("meme-name-tag");
const roastText       = document.getElementById("roast-text");
const historyStrip    = document.getElementById("history-strip");
const analyzerSpinner = document.getElementById("analyzing-spinner");
const cameraPh        = document.getElementById("camera-placeholder");
const contextInput    = document.getElementById("context-input");
const memePanel       = document.getElementById("meme-panel");
const scorecard       = document.getElementById("scorecard");
const timerText       = document.getElementById("timer-text");
const timerArc        = document.getElementById("timer-arc");
const audioIcon       = document.getElementById("audio-icon");
const audioLabel      = document.getElementById("audio-intensity-label");
const volumeSlider    = document.getElementById("volume-slider");
const modeBadge       = document.getElementById("mode-badge");

/* ── DOM refs (new mod elements) ────────────────────────────────────────── */
const challengeOverlay = document.getElementById("challenge-overlay");
const chEmoji          = document.getElementById("ch-emoji");
const chExpression     = document.getElementById("ch-expression");
const chProgress       = document.getElementById("ch-progress");
const bonusFeedEl      = document.getElementById("bonus-feed");
const timeMultBadge    = document.getElementById("time-mult-badge");
const comebackBar      = document.getElementById("comeback-bar");

const INTENSITY_WIDTHS = { mild: "33%", moderate: "66%", strong: "100%" };
const INTENSITY_COLORS = {
  mild:     "linear-gradient(90deg,#7c3aed,#a855f7)",
  moderate: "linear-gradient(90deg,#f59e0b,#ef4444)",
  strong:   "linear-gradient(90deg,#ef4444,#ff00aa)",
};
const AUDIO_ICONS = ["🔇", "🔈", "🔉", "🔊", "🔊🔥"];

let gameDuration = 60;

/* ══════════════════════════════════════════════════════════════════════════
   LOBBY LOGIC
══════════════════════════════════════════════════════════════════════════ */

let selectedMode       = "solo";
let selectedDuration   = 60;
let selectedDifficulty = "easy";

document.querySelectorAll(".mode-card").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".mode-card").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    selectedMode = btn.dataset.mode;
    document.getElementById("solo-start").style.display = selectedMode === "solo" ? "flex" : "none";
    document.getElementById("battle-options").style.display = selectedMode === "battle" ? "flex" : "none";
    document.getElementById("room-lobby").style.display = "none";
  });
});

document.querySelectorAll(".dur-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".dur-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    selectedDuration = parseInt(btn.dataset.dur);
    game.duration = selectedDuration;
  });
});

document.querySelectorAll(".diff-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".diff-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    selectedDifficulty = btn.dataset.diff;
    game.difficulty = selectedDifficulty;
  });
});

document.getElementById("start-solo-btn").addEventListener("click", () => {
  const name = document.getElementById("player-name").value.trim() || "Player";
  game.playerName = name;
  game.duration = selectedDuration;
  game.difficulty = selectedDifficulty;
  game.mode = "solo";
  enterGameScreen();
  game.startSolo();
});

document.getElementById("create-room-btn").addEventListener("click", async () => {
  battleAudio.unlock();
  const name = document.getElementById("player-name").value.trim() || "Player";
  game.playerName = name;
  game.duration = selectedDuration;
  game.difficulty = selectedDifficulty;
  try {
    const code = await game.createRoom();
    document.getElementById("room-code-big").textContent = code;
    document.getElementById("room-lobby").style.display = "flex";
    const spectatorLink = document.getElementById("spectator-link");
    if (spectatorLink) {
      spectatorLink.href = `/watch/${code}`;
    }
    showToast(`Room ${code} created — share the code!`);
  } catch (e) {
    showToast("Could not create room. Is the server running?");
  }
});

document.getElementById("join-room-btn").addEventListener("click", async () => {
  battleAudio.unlock();
  const name = document.getElementById("player-name").value.trim() || "Player";
  const code = document.getElementById("join-code-input").value.trim().toUpperCase();
  if (code.length !== 4) { showToast("Enter a 4-letter room code."); return; }
  game.playerName = name;
  try {
    await game.joinRoom(code);
    document.getElementById("room-code-big").textContent = code;
    document.getElementById("room-lobby").style.display = "flex";
    const spectatorLink = document.getElementById("spectator-link");
    if (spectatorLink) {
      spectatorLink.href = `/watch/${code}`;
    }
    showToast(`Joined room ${code}!`);
  } catch (e) {
    showToast(`Room "${code}" not found.`);
  }
});

document.getElementById("start-battle-btn").addEventListener("click", () => {
  enterGameScreen();
  game.startBattle();
});

document.getElementById("copy-code-btn").addEventListener("click", () => {
  const code = document.getElementById("room-code-big").textContent;
  navigator.clipboard.writeText(code).then(() => showToast(`Copied ${code}`));
});

/* ── Game callbacks from game.js ────────────────────────────────────────── */
game.onPlayerJoined = (players, isHost) => {
  const list = document.getElementById("player-list-lobby");
  if (!list) return;
  list.innerHTML = players.map((p) => `<div class="player-chip">👤 ${p}</div>`).join("");
  const startBtn2 = document.getElementById("start-battle-btn");
  if (startBtn2) {
    startBtn2.disabled = !isHost;
    startBtn2.textContent = isHost ? "⚔️ Start Battle!" : "Waiting for host…";
  }
};

game.onGameStart = (duration) => {
  gameDuration = duration;
  modeBadge.textContent = game.mode === "solo" ? "SOLO" : "BATTLE ⚔️";
  if (game.mode === "battle") {
    scorecard.style.display = "flex";
    renderScorecard({});
  }
  if (duration > 0) {
    updateTimerRing(duration, duration);
    timerText.textContent = fmtTimer(duration);
  } else {
    timerText.textContent = "∞";
  }
};

game.onTimerTick = (remaining) => {
  timerText.textContent = fmtTimer(remaining);
  updateTimerRing(remaining, gameDuration);
};

game.onScoreUpdate = (newScore, delta) => {
  flashScoreDelta(`+${delta}`);
};

game.onOpponentUpdate = (players) => {
  renderScorecard(players);
};

game.onGameEnd = (report) => {
  stopCamera();
  battleAudio.setIntensity(0);
  hideChallenge();
  if (timeMultBadge) timeMultBadge.style.display = "none";
  if (comebackBar) comebackBar.style.display = "none";
  showReportScreen(report);
};

/* ── Mod callbacks ──────────────────────────────────────────────────────── */
let chProgressTimer = null;

game.onChallenge = (emoji, target, window_s) => {
  if (!challengeOverlay) return;
  chEmoji.textContent = emoji;
  chExpression.textContent = target.toUpperCase();
  challengeOverlay.classList.add("show");
  chProgress.style.transition = "none";
  chProgress.style.width = "100%";
  clearTimeout(chProgressTimer);
  requestAnimationFrame(() => {
    chProgress.style.transition = `width ${window_s}s linear`;
    chProgress.style.width = "0%";
  });
  chProgressTimer = setTimeout(() => hideChallenge(), window_s * 1000);
};

game.onChallengeExpired = () => {
  hideChallenge();
};

game.onBonuses = (labels) => {
  if (!bonusFeedEl) return;
  labels.filter(Boolean).forEach((label) => {
    const pill = document.createElement("div");
    pill.className = "bonus-pill";
    pill.textContent = label;
    bonusFeedEl.appendChild(pill);
    setTimeout(() => pill.remove(), 3200);
  });
};

game.onTimeMultiplier = (mult, label) => {
  if (!timeMultBadge) return;
  if (mult > 1.0 && label) {
    timeMultBadge.textContent = `⏱ ${label} ×${Math.round(mult)}`;
    timeMultBadge.style.display = "block";
  } else {
    timeMultBadge.style.display = "none";
  }
};

game.onComeback = (active) => {
  if (!comebackBar) return;
  comebackBar.style.display = active ? "block" : "none";
};

function hideChallenge() {
  if (challengeOverlay) challengeOverlay.classList.remove("show");
  clearTimeout(chProgressTimer);
}

/* ══════════════════════════════════════════════════════════════════════════
   GAME SCREEN
══════════════════════════════════════════════════════════════════════════ */

function enterGameScreen() {
  showScreen("screen-game");
  expressionGraph.init("expression-chart");
  startCamera();
}

/* ── Camera ─────────────────────────────────────────────────────────────── */
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
    });
    video.srcObject = stream;
    await video.play();
    cameraPh.style.display = "none";
    video.style.display = "block";
    statusDot.classList.add("active");
    startBtn.disabled = true;
    stopBtn.disabled = false;
    shareBtn.disabled = false;
    state.active = true;
    battleAudio.unlock();
    scheduleAnalysis();
  } catch (err) {
    showToast("Camera access denied — allow it in browser settings.");
    console.error(err);
  }
}

function stopCamera() {
  state.active = false;
  clearTimeout(state.intervalId);
  if (video.srcObject) {
    video.srcObject.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
  video.style.display = "none";
  cameraPh.style.display = "flex";
  statusDot.classList.remove("active");
  startBtn.disabled = false;
  stopBtn.disabled = true;
  shareBtn.disabled = true;
  analyzerSpinner.classList.remove("show");
}

/* ── Frame capture ──────────────────────────────────────────────────────── */
function captureFrame() {
  canvasHidden.width = 320;
  canvasHidden.height = 240;
  ctx2d.save();
  ctx2d.translate(320, 0);
  ctx2d.scale(-1, 1);
  ctx2d.drawImage(video, 0, 0, 320, 240);
  ctx2d.restore();
  return canvasHidden.toDataURL("image/jpeg", 0.5).split(",")[1];
}

/* ── Analysis loop ──────────────────────────────────────────────────────── */
function scheduleAnalysis() {
  if (!state.active) return;
  state.intervalId = setTimeout(async () => {
    await runAnalysis();
    scheduleAnalysis();
  }, state.INTERVAL_MS);
}

async function runAnalysis() {
  if (state.analyzing || !state.active) return;
  state.analyzing = true;
  analyzerSpinner.classList.add("show");
  const t0 = Date.now();
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: captureFrame(),
        context: contextInput.value.trim(),
        streak: state.streak,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    latencyTag.textContent = `${Date.now() - t0}ms`;

    updateStreak(data.expression);
    renderResult(data);
    addToHistory(data);

    const { scoreDelta, audioLevel } = game.reportExpression(
      data.expression, data.intensity,
      data.meme.name, data.meme.image_url,
      state.streak
    );
    battleAudio.setIntensity(audioLevel);
    expressionGraph.push(data.expression, game.timeElapsed());

  } catch (err) {
    console.error("Analysis error:", err);
    latencyTag.textContent = "err";
  } finally {
    state.analyzing = false;
    analyzerSpinner.classList.remove("show");
  }
}

/* ── Streak tracking ────────────────────────────────────────────────────── */
function updateStreak(expression) {
  if (expression === state.lastExpression) {
    state.streak = Math.min(state.streak + 1, 15);
  } else {
    state.streak = 1;
    state.lastExpression = expression;
  }
  if (state.streak >= 2) {
    streakBadge.textContent = `🔥 ${state.streak}x`;
    streakBadge.classList.add("show");
  } else {
    streakBadge.classList.remove("show");
  }
}

/* ── Render meme result ─────────────────────────────────────────────────── */
function renderResult(data) {
  const { expression, intensity, emoji, meme, roast } = data;

  expressionEmoji.textContent = emoji;
  expressionLabel.textContent = expression;
  intensityFill.style.width = INTENSITY_WIDTHS[intensity] || "50%";
  intensityFill.style.background = INTENSITY_COLORS[intensity] || INTENSITY_COLORS.moderate;

  if (meme.accent) {
    const r = parseInt(meme.accent.slice(1,3),16);
    const g = parseInt(meme.accent.slice(3,5),16);
    const b = parseInt(meme.accent.slice(5,7),16);
    memePanel.style.background = `radial-gradient(ellipse at center, rgba(${r},${g},${b},0.1) 0%, #0a0a0f 65%)`;
    memeCard.style.borderColor = meme.accent + "55";
  }

  if (meme.image_url) {
    memePlaceholder.style.display = "none";
    memeImgWrap.style.display = "flex";
    memeImg.src = meme.image_url;
  }

  memeNameTag.textContent = meme.name ? `📌 ${meme.name}` : "";
  roastText.textContent = roast ? `"${roast}"` : "";

  memeCard.classList.remove("pop-in");
  void memeCard.offsetWidth;
  memeCard.classList.add("pop-in");
}

/* ── Score flash ────────────────────────────────────────────────────────── */
let flashTimer;
function flashScoreDelta(text) {
  scoreDeltaFlash.textContent = text;
  scoreDeltaFlash.classList.add("show");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => scoreDeltaFlash.classList.remove("show"), 900);
}

/* ── Scorecard (multiplayer) ────────────────────────────────────────────── */
function renderScorecard(players) {
  const all = {
    [game.playerName]: {
      score: game.score, streak: state.streak,
      last_expression: state.lastExpression, connected: true, comeback: false,
    },
    ...players,
  };
  const sorted = Object.entries(all).sort((a, b) => b[1].score - a[1].score);
  scorecard.innerHTML = sorted.map(([name, p], i) => `
    <div class="sc-player ${name === game.playerName ? "sc-me" : ""} ${p.comeback ? "sc-comeback" : ""}">
      <span class="sc-rank">#${i + 1}</span>
      <span class="sc-name">${name}</span>
      <span class="sc-score">${p.score || 0}</span>
      ${p.streak >= 2 ? `<span class="sc-streak">🔥${p.streak}x</span>` : ""}
      ${p.comeback ? `<span class="sc-comeback-tag">⚡</span>` : ""}
    </div>
  `).join("");
}

/* ── Timer ──────────────────────────────────────────────────────────────── */
function fmtTimer(sec) {
  if (sec === Infinity || sec === 0 && gameDuration === 0) return "∞";
  const s = Math.ceil(sec);
  return s >= 60 ? `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}` : `${s}s`;
}

function updateTimerRing(remaining, total) {
  if (!timerArc || total <= 0) return;
  const pct = Math.max(0, remaining / total);
  const circumference = 2 * Math.PI * 24;
  timerArc.style.strokeDashoffset = circumference * (1 - pct);
  timerArc.style.stroke = pct > 0.5 ? "#10b981" : pct > 0.25 ? "#f59e0b" : "#ef4444";
}

/* ── History strip ──────────────────────────────────────────────────────── */
function addToHistory(data) {
  state.history.unshift(data);
  if (state.history.length > state.MAX_HISTORY) state.history.pop();
  renderHistory();
}

function renderHistory() {
  if (!state.history.length) {
    historyStrip.innerHTML = `<span style="font-size:0.75rem;color:var(--text-dim);align-self:center">No memes yet…</span>`;
    return;
  }
  historyStrip.innerHTML = "";
  state.history.forEach((item, i) => {
    const el = document.createElement("div");
    el.className = "history-item";
    el.style.borderColor = i === 0 ? (item.meme.accent || "var(--accent)") : "var(--border)";
    el.title = `${item.expression} — ${item.meme.name || ""}`;
    if (item.meme.image_url) {
      el.innerHTML = `<img src="${item.meme.image_url}" alt="${item.expression}" loading="lazy" />`;
    } else {
      el.innerHTML = `<span class="h-emoji">${item.emoji || "🎭"}</span>`;
    }
    el.addEventListener("click", () => renderResult(item));
    historyStrip.appendChild(el);
  });
}

/* ── Share / screenshot ─────────────────────────────────────────────────── */
async function shareCapture() {
  if (!state.history.length) { showToast("No meme yet — make a face first!"); return; }
  const W = 900, H = 460;
  const sc2 = document.createElement("canvas");
  sc2.width = W; sc2.height = H;
  const c = sc2.getContext("2d");
  c.fillStyle = "#0a0a0f";
  c.fillRect(0, 0, W, H);
  if (video.readyState >= 2) {
    c.save(); c.translate(W/2,0); c.scale(-1,1);
    c.drawImage(video, 0, 0, W/2, H); c.restore();
    c.fillStyle="rgba(0,0,0,0.15)"; c.fillRect(0,0,W/2,H);
  }
  c.strokeStyle="#2a2a3a"; c.lineWidth=2;
  c.beginPath(); c.moveTo(W/2,0); c.lineTo(W/2,H); c.stroke();
  const last = state.history[0];
  if (last?.meme?.image_url) {
    await new Promise((res) => {
      const img = new Image(); img.crossOrigin="anonymous";
      img.onload = () => {
        const mx=W/2+10, mw=W/2-20, mh=H-20;
        const scale=Math.min(mw/img.width,mh/img.height);
        const dx=mx+(mw-img.width*scale)/2, dy=10+(mh-img.height*scale)/2;
        c.drawImage(img,dx,dy,img.width*scale,img.height*scale); res();
      };
      img.onerror=res; img.src=last.meme.image_url;
    });
  }
  if (last) {
    c.fillStyle="rgba(0,0,0,0.55)"; c.fillRect(8,8,200,32);
    c.fillStyle="#e8e8f0"; c.font="bold 14px Inter,sans-serif"; c.textAlign="left";
    c.fillText(`${last.emoji||"🎭"} ${last.expression} · score: ${game.score}`, 16, 30);
  }
  c.fillStyle="#ffffff44"; c.font="bold 12px Inter,sans-serif"; c.textAlign="right";
  c.fillText("🎭 MemeExpression", W-12, H-10);
  const link=document.createElement("a"); link.download=`meme-${Date.now()}.png`;
  link.href=sc2.toDataURL("image/png"); link.click();
  showToast("📸 Saved!");
}

/* ══════════════════════════════════════════════════════════════════════════
   REPORT SCREEN
══════════════════════════════════════════════════════════════════════════ */

let lastReport = null;

function showReportScreen(report) {
  lastReport = report;
  showScreen("screen-report");

  const players = Object.entries(report.players);
  const isMulti = players.length > 1;
  const winner = isMulti
    ? players.sort((a, b) => b[1].score - a[1].score)[0][0]
    : null;

  document.getElementById("report-title").textContent =
    winner ? `🏆 ${winner} Wins!` : "Session Complete!";
  document.getElementById("report-subtitle").textContent =
    `${Math.round(report.duration_played)}s · ${players.reduce((s,[,p]) => s + p.total_expressions, 0)} expressions detected`;

  const cardsEl = document.getElementById("report-scorecards");
  cardsEl.innerHTML = players
    .sort((a,b) => b[1].score - a[1].score)
    .map(([name, p], i) => `
      <div class="report-player-card ${name===winner?"winner":""}">
        ${i===0&&isMulti?'<div class="trophy">🏆</div>':''}
        <div class="rpc-name">${name}</div>
        <div class="rpc-score">${p.score} pts</div>
        <div class="rpc-stats">
          <span>${p.total_expressions} expressions</span>
          <span>Top: ${p.top_expression} ${getExpEmoji(p.top_expression)}</span>
          <span>🔥 Max streak: ${p.max_streak}x</span>
          ${p.crowd_votes ? `<span>👍 ${p.crowd_votes} crowd votes</span>` : ""}
        </div>
        <div class="rpc-bar">
          ${buildExpBar(p.expression_counts, p.total_expressions)}
        </div>
      </div>
    `).join("");

  const reportChart = document.getElementById("report-chart");
  if (reportChart && window.Chart) {
    const allEvents = players.flatMap(([,p]) => p.events).sort((a,b) => a.t - b.t);
    new Chart(reportChart, {
      type: "line",
      data: {
        labels: allEvents.map(e => `${e.t}s`),
        datasets: [{
          label: "Expression",
          data: allEvents.map(e => (window.EXP_VALUES||{})[e.expression] ?? 3),
          borderColor: "#7c3aed",
          backgroundColor: "rgba(124,58,237,0.1)",
          pointBackgroundColor: allEvents.map(e => (window.EXP_COLORS||{})[e.expression] ?? "#888"),
          borderWidth: 2, pointRadius: 4, tension: 0.35, fill: true,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#888899", font:{size:10}, maxTicksLimit:10 }, grid:{color:"#1a1a26"} },
          y: { min: -0.5, max: 6.5,
            ticks: { color:"#888899", font:{size:10}, stepSize:1,
              callback: (v) => ["angry","disgusted","sad","neutral","fearful","surprised","happy"][Math.round(v)] || "" },
            grid:{color:"#1a1a26"} },
        },
      },
    });
  }
}

function getExpEmoji(exp) {
  return {happy:"😄",surprised:"😮",sad:"😢",angry:"😠",disgusted:"🤢",fearful:"😨",neutral:"😐"}[exp]||"😐";
}

function buildExpBar(counts, total) {
  const all = ["happy","surprised","sad","angry","disgusted","fearful","neutral"];
  const colors = {happy:"#FFD700",surprised:"#FF69B4",sad:"#4169E1",angry:"#DC143C",disgusted:"#6B8E23",fearful:"#9370DB",neutral:"#708090"};
  const t = Math.max(1, total);
  return all.map((e) => {
    const pct = Math.round(((counts[e]||0)/t)*100);
    return pct > 0
      ? `<div class="exp-seg" style="width:${pct}%;background:${colors[e]}" title="${e}: ${pct}%"></div>`
      : "";
  }).join("");
}

document.getElementById("download-report-btn").addEventListener("click", () => {
  if (lastReport) downloadReport(lastReport);
});
document.getElementById("share-report-btn").addEventListener("click", () => {
  if (lastReport) shareReport(lastReport);
});
document.getElementById("play-again-btn").addEventListener("click", () => {
  game.reset();
  expressionGraph.reset();
  state.streak = 0;
  state.lastExpression = null;
  state.history = [];
  historyStrip.innerHTML = `<span style="font-size:0.75rem;color:var(--text-dim);align-self:center">No memes yet…</span>`;
  scorecard.style.display = "none";
  if (comebackBar) comebackBar.style.display = "none";
  if (timeMultBadge) timeMultBadge.style.display = "none";
  lastReport = null;
  showScreen("screen-lobby");
});

/* ══════════════════════════════════════════════════════════════════════════
   CONTROLS & AUDIO
══════════════════════════════════════════════════════════════════════════ */

startBtn.addEventListener("click", startCamera);
stopBtn.addEventListener("click", stopCamera);
shareBtn.addEventListener("click", shareCapture);
endGameBtn.addEventListener("click", () => {
  if (!game.startedAt) { showToast("Game hasn't started yet."); return; }
  game.endManually();
});

volumeSlider.addEventListener("input", () => {
  const v = parseInt(volumeSlider.value) / 100;
  battleAudio.setVolume(v);
});

window.addEventListener("audio-intensity", (e) => {
  const { level, label } = e.detail;
  audioIcon.textContent = AUDIO_ICONS[level] || "🔇";
  audioLabel.textContent = label;
});

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && state.active && !state.analyzing &&
      document.getElementById("screen-game").style.display !== "none") {
    e.preventDefault();
    clearTimeout(state.intervalId);
    runAnalysis().then(scheduleAnalysis);
  }
});

/* ── Toast ──────────────────────────────────────────────────────────────── */
let toastTimer;
function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}
window.showToast = showToast;

/* ── Init ───────────────────────────────────────────────────────────────── */
fetch("/api/health")
  .then((r) => r.json())
  .then((d) => {
    if (!d.imgflip_credentials) {
      showToast("⚠️ Set IMGFLIP_USERNAME + IMGFLIP_PASSWORD in .env for captioned memes");
    }
  })
  .catch(() => showToast("⚠️ Backend offline. Run: ./run.sh"));

if (timerArc) {
  const circumference = 2 * Math.PI * 24;
  timerArc.style.strokeDasharray = circumference;
  timerArc.style.strokeDashoffset = 0;
}
