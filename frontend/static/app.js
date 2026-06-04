/* ─── State ─── */
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

/* ─── DOM refs ─── */
const video           = document.getElementById("video");
const canvasHidden    = document.getElementById("canvas-hidden");
const ctx             = canvasHidden.getContext("2d");
const startBtn        = document.getElementById("start-btn");
const stopBtn         = document.getElementById("stop-btn");
const shareBtn        = document.getElementById("share-btn");
const statusDot       = document.getElementById("status-dot");
const expressionEmoji = document.getElementById("expression-emoji");
const expressionLabel = document.getElementById("expression-label");
const intensityFill   = document.getElementById("intensity-fill");
const streakBadge     = document.getElementById("streak-badge");
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

const INTENSITY_WIDTHS = { mild: "33%", moderate: "66%", strong: "100%" };
const INTENSITY_COLORS = {
  mild:     "linear-gradient(90deg, #7c3aed, #a855f7)",
  moderate: "linear-gradient(90deg, #f59e0b, #ef4444)",
  strong:   "linear-gradient(90deg, #ef4444, #ff00aa)",
};

/* ─── Camera ─── */
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
    scheduleAnalysis();
  } catch (err) {
    showToast("Camera access denied. Allow camera permission to continue.");
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

/* ─── Frame capture ─── */
function captureFrame() {
  canvasHidden.width = 320;
  canvasHidden.height = 240;
  // Mirror to match natural view
  ctx.save();
  ctx.translate(320, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, 320, 240);
  ctx.restore();
  return canvasHidden.toDataURL("image/jpeg", 0.5).split(",")[1];
}

/* ─── Analysis loop ─── */
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
    const imageData = captureFrame();
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: imageData,
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
  } catch (err) {
    console.error("Analysis error:", err);
    latencyTag.textContent = "err";
  } finally {
    state.analyzing = false;
    analyzerSpinner.classList.remove("show");
  }
}

/* ─── Streak tracking ─── */
function updateStreak(expression) {
  if (expression === state.lastExpression) {
    state.streak++;
  } else {
    state.streak = 1;
    state.lastExpression = expression;
  }

  if (state.streak >= 2) {
    streakBadge.textContent = `🔥 ${state.streak}x STREAK`;
    streakBadge.classList.add("show");
  } else {
    streakBadge.classList.remove("show");
  }
}

/* ─── Render result ─── */
function renderResult(data) {
  const { expression, intensity, emoji, meme, roast, streak_label } = data;

  // Expression bar
  expressionEmoji.textContent = emoji;
  expressionLabel.textContent = expression + (streak_label || "");
  intensityFill.style.width  = INTENSITY_WIDTHS[intensity] || "50%";
  intensityFill.style.background = INTENSITY_COLORS[intensity] || INTENSITY_COLORS.moderate;

  // Meme panel accent color
  if (meme.accent) {
    const r = parseInt(meme.accent.slice(1,3),16);
    const g = parseInt(meme.accent.slice(3,5),16);
    const b = parseInt(meme.accent.slice(5,7),16);
    memePanel.style.background = `radial-gradient(ellipse at center, rgba(${r},${g},${b},0.1) 0%, #0a0a0f 65%)`;
    memeCard.style.borderColor = meme.accent + "55";
  }

  // Show meme image
  if (meme.image_url) {
    memePlaceholder.style.display = "none";
    memeImgWrap.style.display = "flex";
    memeImg.src = meme.image_url;
    memeImg.alt = meme.name || "meme";
  }

  memeNameTag.textContent = meme.name ? `📌 ${meme.name}` : "";
  roastText.textContent = roast ? `"${roast}"` : "";

  // Pop-in animation
  memeCard.classList.remove("pop-in");
  void memeCard.offsetWidth;
  memeCard.classList.add("pop-in");
}

/* ─── History ─── */
function addToHistory(data) {
  state.history.unshift(data);
  if (state.history.length > state.MAX_HISTORY) state.history.pop();
  renderHistory();
}

function renderHistory() {
  historyStrip.innerHTML = "";
  if (state.history.length === 0) {
    historyStrip.innerHTML = `<span style="font-size:0.75rem;color:var(--text-dim);align-self:center">No memes yet…</span>`;
    return;
  }
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

/* ─── Share / Screenshot ─── */
async function shareCapture() {
  if (!state.history.length) {
    showToast("No meme yet — make a face first!");
    return;
  }

  const W = 900, H = 460;
  const sc = document.createElement("canvas");
  sc.width = W; sc.height = H;
  const c = sc.getContext("2d");

  // Background
  c.fillStyle = "#0a0a0f";
  c.fillRect(0, 0, W, H);

  // Camera frame (mirrored)
  if (video.readyState >= 2) {
    c.save();
    c.translate(W / 2, 0);
    c.scale(-1, 1);
    c.drawImage(video, 0, 0, W / 2, H);
    c.restore();
    // Dim overlay
    c.fillStyle = "rgba(0,0,0,0.15)";
    c.fillRect(0, 0, W / 2, H);
  }

  // Divider
  c.strokeStyle = "#2a2a3a";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(W / 2, 0);
  c.lineTo(W / 2, H);
  c.stroke();

  // Meme image on the right
  const lastMeme = state.history[0];
  if (lastMeme?.meme?.image_url) {
    await new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const mx = W / 2 + 10;
        const mw = W / 2 - 20;
        const mh = H - 20;
        const scale = Math.min(mw / img.width, mh / img.height);
        const dx = mx + (mw - img.width * scale) / 2;
        const dy = 10 + (mh - img.height * scale) / 2;
        c.drawImage(img, dx, dy, img.width * scale, img.height * scale);
        resolve();
      };
      img.onerror = resolve;
      img.src = lastMeme.meme.image_url;
    });
  }

  // Expression label (top-left)
  c.fillStyle = "rgba(0,0,0,0.55)";
  c.fillRect(8, 8, 180, 32);
  c.fillStyle = "#e8e8f0";
  c.font = "bold 15px Inter, sans-serif";
  c.textAlign = "left";
  c.fillText(`${lastMeme?.emoji || "🎭"} ${lastMeme?.expression || ""} — ${lastMeme?.intensity || ""}`, 16, 29);

  // Watermark
  c.fillStyle = "#ffffff44";
  c.font = "bold 12px Inter, sans-serif";
  c.textAlign = "right";
  c.fillText("🎭 MemeExpression", W - 12, H - 10);

  const link = document.createElement("a");
  link.download = `meme-expression-${Date.now()}.png`;
  link.href = sc.toDataURL("image/png");
  link.click();
  showToast("📸 Meme saved!");
}

/* ─── Toast ─── */
let toastTimer;
function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
}

/* ─── Event listeners ─── */
startBtn.addEventListener("click", startCamera);
stopBtn.addEventListener("click", stopCamera);
shareBtn.addEventListener("click", shareCapture);

// Space = instant re-analysis
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && state.active && !state.analyzing) {
    e.preventDefault();
    clearTimeout(state.intervalId);
    runAnalysis().then(scheduleAnalysis);
  }
});

// Health check on load
fetch("/api/health")
  .then((r) => r.json())
  .then((d) => {
    if (!d.imgflip_credentials) {
      showToast("⚠️ Set IMGFLIP_USERNAME + IMGFLIP_PASSWORD in .env for real meme images");
    }
    console.log("Backend health:", d);
  })
  .catch(() => showToast("⚠️ Backend not reachable. Run: ./run.sh"));
