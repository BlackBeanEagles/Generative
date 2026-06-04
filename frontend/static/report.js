/* ─── Report Generator ───────────────────────────────────────────────────────
   Renders a full battle report card as a canvas PNG and triggers download.
   Also supports native Web Share API for mobile sharing.
────────────────────────────────────────────────────────────────────────────── */

(function () {
  const EXP_EMOJIS = {
    happy: "😄", surprised: "😮", sad: "😢",
    angry: "😠", disgusted: "🤢", fearful: "😨", neutral: "😐",
  };
  const EXP_COLORS = {
    happy: "#FFD700", surprised: "#FF69B4", sad: "#4169E1",
    angry: "#DC143C", disgusted: "#6B8E23", fearful: "#9370DB", neutral: "#708090",
  };
  const ALL_EXPRESSIONS = ["happy", "surprised", "sad", "angry", "disgusted", "fearful", "neutral"];

  /* ── Layout constants ─── */
  const W = 1000, H = 640;
  const PAD = 32;

  function hex(color, alpha = 1) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return alpha < 1 ? `rgba(${r},${g},${b},${alpha})` : color;
  }

  function drawRoundRect(ctx, x, y, w, h, r, fill, stroke) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
  }

  function wrapText(ctx, text, x, y, maxW, lineH) {
    const words = text.split(" ");
    let line = "";
    for (const w of words) {
      const test = line + w + " ";
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line.trim(), x, y);
        line = w + " ";
        y += lineH;
      } else {
        line = test;
      }
    }
    ctx.fillText(line.trim(), x, y);
  }

  async function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function fmtTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  async function generateReportCanvas(report, graphSnapshot) {
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");

    const playerNames = Object.keys(report.players);
    const isMultiplayer = playerNames.length > 1;
    const winner = isMultiplayer
      ? playerNames.reduce((a, b) => report.players[a].score >= report.players[b].score ? a : b)
      : null;

    /* ── Background ── */
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#0a0a14");
    bg.addColorStop(1, "#12001a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Subtle grid
    ctx.strokeStyle = "rgba(124,58,237,0.07)";
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    /* ── Header ── */
    ctx.fillStyle = "#7c3aed";
    ctx.fillRect(0, 0, W, 3); // accent top bar

    ctx.font = "bold 28px 'Inter', sans-serif";
    ctx.fillStyle = "#e8e8f0";
    ctx.textAlign = "left";
    ctx.fillText("🎭 MemeExpression", PAD, 46);

    ctx.font = "14px 'Inter', sans-serif";
    ctx.fillStyle = "#888899";
    ctx.fillText(
      `${isMultiplayer ? "BATTLE REPORT" : "SESSION REPORT"} · ${fmtTime(report.duration_played)} · ${new Date().toLocaleDateString()}`,
      PAD, 66
    );

    /* ── Winner banner (multiplayer only) ── */
    let yStart = 90;
    if (isMultiplayer && winner) {
      const wp = report.players[winner];
      const bannerGrad = ctx.createLinearGradient(0, yStart, W, yStart);
      bannerGrad.addColorStop(0, "rgba(255,215,0,0.12)");
      bannerGrad.addColorStop(1, "rgba(255,215,0,0)");
      drawRoundRect(ctx, PAD, yStart, W - PAD * 2, 52, 10, bannerGrad, "#FFD70040");

      ctx.font = "bold 22px 'Inter', sans-serif";
      ctx.fillStyle = "#FFD700";
      ctx.textAlign = "center";
      ctx.fillText(`🏆 ${winner} WINS! · ${wp.score} pts`, W / 2, yStart + 32);
      ctx.textAlign = "left";
      yStart += 68;
    }

    /* ── Player cards ── */
    const numPlayers = playerNames.length;
    const colW = Math.floor((W - PAD * 2 - (numPlayers - 1) * 16) / numPlayers);
    const cardH = 190;

    for (let i = 0; i < numPlayers; i++) {
      const pname = playerNames[i];
      const p = report.players[pname];
      const cx = PAD + i * (colW + 16);
      const cy = yStart;
      const accent = EXP_COLORS[p.top_expression] || "#7c3aed";
      const isWin = pname === winner;

      drawRoundRect(ctx, cx, cy, colW, cardH, 12,
        "rgba(18,18,26,0.95)", isWin ? "#FFD70066" : "#2a2a3a44"
      );

      // Accent left bar
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.roundRect(cx, cy, 4, cardH, [12, 0, 0, 12]);
      ctx.fill();

      // Player name
      ctx.font = "bold 16px 'Inter', sans-serif";
      ctx.fillStyle = "#e8e8f0";
      ctx.textAlign = "left";
      ctx.fillText(pname.length > 18 ? pname.slice(0, 16) + "…" : pname, cx + 18, cy + 26);

      // Score
      ctx.font = "bold 38px 'Inter', sans-serif";
      ctx.fillStyle = accent;
      ctx.fillText(`${p.score}`, cx + 18, cy + 70);
      ctx.font = "11px 'Inter', sans-serif";
      ctx.fillStyle = "#888899";
      ctx.fillText("PTS", cx + 18 + ctx.measureText(`${p.score}`).width + 4, cy + 62);

      // Stats
      ctx.font = "12px 'Inter', sans-serif";
      ctx.fillStyle = "#888899";
      const stats = [
        `Expressions: ${p.total_expressions}`,
        `Top: ${EXP_EMOJIS[p.top_expression] || "😐"} ${p.top_expression}`,
        `Max streak: 🔥 ${p.max_streak}x`,
      ];
      stats.forEach((s, si) => ctx.fillText(s, cx + 18, cy + 95 + si * 18));

      // Mini expression bar chart
      const barTop = cy + 150;
      const barH = 20;
      const barW = colW - 36;
      const total = Math.max(1, p.total_expressions);
      let bx = cx + 18;
      for (const exp of ALL_EXPRESSIONS) {
        const cnt = p.expression_counts[exp] || 0;
        const w = Math.round((cnt / total) * barW);
        if (w < 2) continue;
        ctx.fillStyle = EXP_COLORS[exp] + "cc";
        ctx.beginPath();
        ctx.roundRect(bx, barTop, w, barH, 3);
        ctx.fill();
        bx += w + 2;
      }
    }

    /* ── Meme thumbnails ── */
    const thumbY = yStart + cardH + 20;
    const thumbW = 90, thumbH = 68;
    const memeUrls = (window.game && window.game.memeHistory) || [];
    ctx.font = "bold 11px 'Inter', sans-serif";
    ctx.fillStyle = "#888899";
    ctx.textAlign = "left";
    ctx.fillText("RECENT MEMES", PAD, thumbY - 6);

    for (let mi = 0; mi < Math.min(memeUrls.length, 6); mi++) {
      const tx = PAD + mi * (thumbW + 10);
      const img = await loadImage(memeUrls[mi]);
      drawRoundRect(ctx, tx, thumbY, thumbW, thumbH, 6, "#12121a", "#2a2a3a");
      if (img) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(tx, thumbY, thumbW, thumbH, 6);
        ctx.clip();
        ctx.drawImage(img, tx, thumbY, thumbW, thumbH);
        ctx.restore();
      }
    }

    /* ── Graph snapshot ── */
    if (graphSnapshot) {
      const gImg = await loadImage(graphSnapshot);
      if (gImg) {
        const gx = PAD * 2 + 6 * (thumbW + 10) + 8;
        const gw = W - gx - PAD;
        const gh = thumbH + 16;
        drawRoundRect(ctx, gx, thumbY - 10, gw, gh, 8, "rgba(18,18,26,0.8)", "#2a2a3a");
        ctx.drawImage(gImg, gx + 8, thumbY - 4, gw - 16, gh - 12);
      }
    }

    /* ── Footer ── */
    ctx.font = "11px 'Inter', sans-serif";
    ctx.fillStyle = "#444455";
    ctx.textAlign = "right";
    ctx.fillText("Generated by MemeExpression · Claude + Imgflip", W - PAD, H - 12);

    return canvas;
  }

  async function downloadReport(report) {
    const graphSnap = window.expressionGraph ? window.expressionGraph.snapshot() : null;
    const canvas = await generateReportCanvas(report, graphSnap);
    const link = document.createElement("a");
    link.download = `meme-battle-report-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  async function shareReport(report) {
    const graphSnap = window.expressionGraph ? window.expressionGraph.snapshot() : null;
    const canvas = await generateReportCanvas(report, graphSnap);

    if (navigator.share && navigator.canShare) {
      canvas.toBlob(async (blob) => {
        const file = new File([blob], "meme-report.png", { type: "image/png" });
        try {
          await navigator.share({ files: [file], title: "My MemeExpression Report!" });
        } catch (e) {
          if (e.name !== "AbortError") fallbackCopy(canvas);
        }
      });
    } else {
      fallbackCopy(canvas);
    }
  }

  function fallbackCopy(canvas) {
    // Just download if native share isn't available
    const link = document.createElement("a");
    link.download = `meme-report-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    if (window.showToast) showToast("📥 Report downloaded!");
  }

  window.downloadReport = downloadReport;
  window.shareReport = shareReport;
})();
