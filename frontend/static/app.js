/* ─── State ─── */
const state = {
  active: false,
  analyzing: false,
  lastExpression: null,
  streak: 0,
  history: [],
  intervalId: null,
  latencyMs: 0,
  INTERVAL_MS: 2500,
  MAX_HISTORY: 10,
};

/* ─── DOM refs ─── */
const video = document.getElementById("video");
const canvasHidden = document.getElementById("canvas-hidden");
const ctx = canvasHidden.getContext("2d");
const startBtn = document.getElementById("start-btn");
const stopBtn = document.getElementById("stop-btn");
const shareBtn = document.getElementById("share-btn");
const statusDot = document.getElementById("status-dot");
const expressionEmoji = document.getElementById("expression-emoji");
const expressionLabel = document.getElementById("expression-label");
const intensityFill = document.getElementById("intensity-fill");
const streakBadge = document.getElementById("streak-badge");
const latencyTag = document.getElementById("latency-tag");
const memeCard = document.getElementById("meme-card");
const memeTopText = document.getElementById("meme-top");
const memeEmojiEl = document.getElementById("meme-emoji");
const memeNameTag = document.getElementById("meme-name");
const memeBottomText = document.getElementById("meme-bottom");
const roastBox = document.getElementById("roast-text");
const historyStrip = document.getElementById("history-strip");
const analyzerSpinner = document.getElementById("analyzing-spinner");
const cameraPh = document.getElementById("camera-placeholder");
const contextInput = document.getElementById("context-input");
const memePanel = document.querySelector(".meme-panel");

const INTENSITY_WIDTHS = { mild: "33%", moderate: "66%", strong: "100%" };
const INTENSITY_COLORS = {
  mild: "linear-gradient(90deg, #7c3aed, #a855f7)",
  moderate: "linear-gradient(90deg, #f59e0b, #ef4444)",
  strong: "linear-gradient(90deg, #ef4444, #ff00aa)",
};

/* ─── Camera ─── */
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
    });
    video.srcObject = stream;
    video.play();
    cameraPh.style.display = "none";
    video.style.display = "block";
    statusDot.classList.add("active");
    startBtn.disabled = true;
    stopBtn.disabled = false;
    shareBtn.disabled = false;
    state.active = true;
    scheduleAnalysis();
  } catch (err) {
    showToast("Camera access denied. Allow camera to continue.");
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
function captureFrame(quality = 0.55) {
  canvasHidden.width = 320;
  canvasHidden.height = 240;
  ctx.drawImage(video, 0, 0, 320, 240);
  const full = canvasHidden.toDataURL("image/jpeg", quality);
  // Strip data URI prefix
  return full.split(",")[1];
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
    state.latencyMs = Date.now() - t0;
    latencyTag.textContent = `${state.latencyMs}ms`;

    updateStreak(data.expression);
    renderMeme(data);
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

/* ─── Render meme ─── */
function renderMeme(data) {
  const { expression, intensity, emoji, meme, roast, streak_label } = data;

  // Expression bar
  expressionEmoji.textContent = emoji;
  expressionLabel.textContent = expression + (streak_label || "");
  intensityFill.style.width = INTENSITY_WIDTHS[intensity] || "50%";
  intensityFill.style.background = INTENSITY_COLORS[intensity] || INTENSITY_COLORS.moderate;

  // Meme card background
  memeCard.style.background = `linear-gradient(${meme.bg_gradient})`;
  memePanel.style.background = `radial-gradient(ellipse at center, rgba(${hexToRgb(meme.accent)}, 0.08) 0%, #0a0a0f 70%)`;

  // Text
  memeTopText.textContent = meme.top;
  memeTopText.style.color = meme.color;
  memeEmojiEl.textContent = meme.emoji;
  memeNameTag.textContent = meme.name;
  memeBottomText.textContent = meme.bottom;
  memeBottomText.style.color = meme.color;

  // Roast
  roastBox.textContent = `"${roast}"`;

  // Pop-in animation
  memeCard.classList.remove("pop-in");
  void memeCard.offsetWidth; // reflow
  memeCard.classList.add("pop-in");
}

/* ─── History ─── */
function addToHistory(data) {
  state.history.unshift(data);
  if (state.history.length > state.MAX_HISTORY) {
    state.history.pop();
  }
  renderHistory();
}

function renderHistory() {
  historyStrip.innerHTML = "";
  state.history.forEach((item, i) => {
    const el = document.createElement("div");
    el.className = "history-item";
    el.style.background = `linear-gradient(${item.meme.bg_gradient})`;
    el.style.borderColor = i === 0 ? item.meme.accent : "var(--border)";
    el.innerHTML = `<span>${item.meme.emoji.split("")[0]}</span>`;
    el.title = `${item.expression} — ${item.meme.top} / ${item.meme.bottom}`;
    el.addEventListener("click", () => renderMeme(item));
    historyStrip.appendChild(el);
  });
}

/* ─── Share / Screenshot ─── */
async function shareCapture() {
  // Draw camera + meme text to a canvas and download
  const W = 900, H = 450;
  const shareCanvas = document.createElement("canvas");
  shareCanvas.width = W;
  shareCanvas.height = H;
  const sc = shareCanvas.getContext("2d");

  // Background
  sc.fillStyle = "#0a0a0f";
  sc.fillRect(0, 0, W, H);

  // Camera frame (mirrored)
  if (video.readyState >= 2) {
    sc.save();
    sc.translate(W / 2, 0);
    sc.scale(-1, 1);
    sc.drawImage(video, 0, 0, W / 2, H);
    sc.restore();
  }

  // Divider
  sc.strokeStyle = "#2a2a3a";
  sc.lineWidth = 2;
  sc.beginPath();
  sc.moveTo(W / 2, 0);
  sc.lineTo(W / 2, H);
  sc.stroke();

  // Meme panel
  const lastData = state.history[0];
  if (lastData) {
    const mx = W / 2;
    sc.fillStyle = lastData.meme.accent + "22";
    sc.fillRect(mx, 0, W / 2, H);

    // Emoji
    sc.font = "bold 80px sans-serif";
    sc.textAlign = "center";
    sc.fillText(lastData.meme.emoji.split("")[0], mx + W / 4, H / 2 - 20);

    // Top text
    sc.fillStyle = lastData.meme.color;
    sc.font = "bold 22px Impact, sans-serif";
    sc.fillText(lastData.meme.top, mx + W / 4, 60);

    // Bottom text
    sc.fillText(lastData.meme.bottom, mx + W / 4, H - 40);

    // Roast
    sc.fillStyle = "#888899";
    sc.font = "italic 14px sans-serif";
    wrapText(sc, `"${lastData.roast}"`, mx + W / 4, H - 80, W / 2 - 40, 18);
  }

  // Watermark
  sc.fillStyle = "#ffffff33";
  sc.font = "bold 13px sans-serif";
  sc.textAlign = "right";
  sc.fillText("🎭 MemeExpression.ai", W - 14, H - 12);

  // Download
  const link = document.createElement("a");
  link.download = `meme-face-${Date.now()}.png`;
  link.href = shareCanvas.toDataURL("image/png");
  link.click();
  showToast("📸 Meme saved!");
}

function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = text.split(" ");
  let line = "";
  let yOff = y;
  for (const word of words) {
    const test = line + word + " ";
    if (ctx.measureText(test).width > maxW && line !== "") {
      ctx.fillText(line.trim(), x, yOff);
      line = word + " ";
      yOff += lineH;
    } else {
      line = test;
    }
  }
  ctx.fillText(line.trim(), x, yOff);
}

/* ─── Utils ─── */
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

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

// Keyboard shortcut: Space to trigger immediate analysis
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
  .then((d) => console.log("Backend ready:", d))
  .catch(() => showToast("⚠️ Backend not reachable. Start the server first."));
