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

  /* ══════════════════════════════════════════════════════════════════════════
     BATTLE CARD  —  1200 × 630 shareable social-media card
  ══════════════════════════════════════════════════════════════════════════ */

  async function buildBattleCard(report) {
    const CW = 1200, CH = 630;
    const canvas = document.createElement("canvas");
    canvas.width = CW; canvas.height = CH;
    const ctx = canvas.getContext("2d");

    const playerNames = Object.keys(report.players);
    const isMulti = playerNames.length > 1;
    const sorted = [...playerNames].sort((a, b) => report.players[b].score - report.players[a].score);

    // Background radial gradient
    const bg = ctx.createRadialGradient(CW / 2, CH / 2, 0, CW / 2, CH / 2, CW * 0.75);
    bg.addColorStop(0, "#1a0a2e"); bg.addColorStop(1, "#05050a");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, CW, CH);

    // Dot grid pattern
    ctx.fillStyle = "rgba(124,58,237,0.06)";
    for (let x = 30; x < CW; x += 48) {
      for (let y = 30; y < CH; y += 48) {
        ctx.beginPath(); ctx.arc(x, y, 1.2, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Top accent bar (gradient)
    const topBar = ctx.createLinearGradient(0, 0, CW, 0);
    topBar.addColorStop(0, "#7c3aed"); topBar.addColorStop(0.5, "#a855f7"); topBar.addColorStop(1, "#7c3aed");
    ctx.fillStyle = topBar; ctx.fillRect(0, 0, CW, 5);

    // Logo
    ctx.font = "bold 22px 'Inter', sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.textAlign = "left"; ctx.fillText("🎭 MemeExpression", 44, 46);

    // Mode badge
    const badge = isMulti ? "⚔️  BATTLE RESULT" : "🎭  SOLO SESSION";
    ctx.font = "bold 12px 'Inter', sans-serif";
    ctx.fillStyle = "#a855f7"; ctx.textAlign = "right";
    ctx.fillText(badge, CW - 44, 46);

    if (isMulti) {
      // ── VS card ─────────────────────────────────────────────────────────
      const winner = sorted[0];

      // Winner crown
      ctx.font = "42px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("🏆", CW / 4, 110);

      // VS divider
      ctx.strokeStyle = "rgba(124,58,237,0.3)";
      ctx.lineWidth = 2; ctx.setLineDash([8, 5]);
      ctx.beginPath(); ctx.moveTo(CW / 2, 70); ctx.lineTo(CW / 2, CH - 60); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "bold 52px 'Inter', sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillText("VS", CW / 2, CH / 2 + 18);

      sorted.forEach((name, idx) => {
        _drawPlayerSide(ctx, name, report.players[name], idx === 0, CW, CH);
      });
    } else {
      _drawSoloCard(ctx, sorted[0], report.players[sorted[0]], CW, CH);
    }

    // Footer
    ctx.font = "11px 'Inter', sans-serif";
    ctx.fillStyle = "#333344"; ctx.textAlign = "right";
    ctx.fillText(`Generated by MemeExpression · ${new Date().toLocaleDateString()}`, CW - 44, CH - 16);

    return canvas;
  }

  function _drawPlayerSide(ctx, name, p, isWinner, CW, CH) {
    const xc = isWinner ? CW / 4 : CW * 3 / 4;
    const accent = EXP_COLORS[p.top_expression] || "#7c3aed";

    // Score
    ctx.font = "bold 100px 'Inter', sans-serif";
    ctx.fillStyle = accent; ctx.textAlign = "center";
    ctx.fillText(p.score.toString(), xc, CH / 2 + 24);
    ctx.font = "bold 14px 'Inter', sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillText("PTS", xc, CH / 2 + 48);

    // Name
    ctx.font = "bold 30px 'Inter', sans-serif";
    ctx.fillStyle = "#e8e8f0";
    const displayName = name.length > 14 ? name.slice(0, 12) + "…" : name;
    ctx.fillText(displayName, xc, CH / 2 - 70);

    // Stats
    const emoji = EXP_EMOJIS[p.top_expression] || "😐";
    ctx.font = "18px 'Inter', sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillText(`${emoji} ${p.top_expression}  ·  🔥 ${p.max_streak}x`, xc, CH / 2 + 88);

    // Expression bar
    const bw = CW / 2 - 100, bx = xc - bw / 2;
    _drawCardExpBar(ctx, bx, CH / 2 + 112, bw, p.expression_counts, p.total_expressions);
  }

  function _drawSoloCard(ctx, name, p, CW, CH) {
    const accent = EXP_COLORS[p.top_expression] || "#7c3aed";

    ctx.font = "bold 120px 'Inter', sans-serif";
    ctx.fillStyle = accent; ctx.textAlign = "center";
    ctx.fillText(p.score.toString(), CW / 2, CH / 2 + 36);
    ctx.font = "bold 18px 'Inter', sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillText("PTS", CW / 2, CH / 2 + 62);

    ctx.font = "bold 38px 'Inter', sans-serif";
    ctx.fillStyle = "#e8e8f0";
    ctx.fillText(name, CW / 2, CH / 2 - 96);

    const emoji = EXP_EMOJIS[p.top_expression] || "😐";
    ctx.font = "22px 'Inter', sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillText(`${emoji} ${p.top_expression}  ·  🔥 ${p.max_streak}x  ·  ${p.total_expressions} expressions`, CW / 2, CH / 2 + 94);

    _drawCardExpBar(ctx, 200, CH / 2 + 122, CW - 400, p.expression_counts, p.total_expressions);
  }

  function _drawCardExpBar(ctx, x, y, w, counts, total) {
    const h = 16, r = 8, t = Math.max(1, total);
    ctx.save();
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip();
    let bx = x;
    for (const exp of ALL_EXPRESSIONS) {
      const cnt = counts[exp] || 0, segW = Math.round((cnt / t) * w);
      if (segW < 1) continue;
      ctx.fillStyle = EXP_COLORS[exp] + "cc";
      ctx.fillRect(bx, y, segW, h); bx += segW;
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.1)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.stroke();
  }

  async function downloadBattleCard(report) {
    const canvas = await buildBattleCard(report);
    const link = document.createElement("a");
    link.download = `battle-card-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    if (window.showToast) showToast("🃏 Battle card saved!");
  }

  window.downloadBattleCard = downloadBattleCard;
})();
