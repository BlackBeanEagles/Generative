/* ─── Expression Graph (Chart.js wrapper) ─────────────────────────────────── */

(function () {
  const EXP_LABELS = ["angry", "disgusted", "sad", "neutral", "fearful", "surprised", "happy"];
  const MAX_POINTS = 30;

  class ExpressionGraph {
    constructor() {
      this._chart = null;
      this._canvas = null;
      this._labels = [];   // x-axis: elapsed seconds
      this._values = [];   // y-axis: expression numeric value
      this._colors = [];   // point colors
    }

    init(canvasId) {
      this._canvas = document.getElementById(canvasId);
      if (!this._canvas || !window.Chart) return;

      this._chart = new Chart(this._canvas, {
        type: "line",
        data: {
          labels: this._labels,
          datasets: [{
            label: "Expression",
            data: this._values,
            borderColor: "#7c3aed",
            backgroundColor: "rgba(124, 58, 237, 0.08)",
            borderWidth: 2,
            pointRadius: 5,
            pointHoverRadius: 7,
            pointBackgroundColor: this._colors,
            pointBorderColor: "transparent",
            tension: 0.35,
            fill: true,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 300 },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const exp = EXP_LABELS[ctx.parsed.y] || "neutral";
                  return ` ${exp}`;
                },
              },
            },
          },
          scales: {
            x: {
              ticks: {
                color: "#888899",
                font: { size: 10 },
                maxTicksLimit: 8,
                callback: (v) => `${v}s`,
              },
              grid: { color: "#1a1a26" },
            },
            y: {
              min: -0.5,
              max: 6.5,
              ticks: {
                color: "#888899",
                font: { size: 10 },
                stepSize: 1,
                callback: (v) => EXP_LABELS[Math.round(v)] || "",
              },
              grid: { color: "#1a1a26" },
            },
          },
        },
      });
    }

    push(expression, elapsedSeconds) {
      if (!this._chart) return;

      const val = (window.EXP_VALUES || {})[expression] ?? 3;
      const col = (window.EXP_COLORS || {})[expression] ?? "#888";

      this._labels.push(Math.round(elapsedSeconds));
      this._values.push(val);
      this._colors.push(col);

      if (this._labels.length > MAX_POINTS) {
        this._labels.shift();
        this._values.shift();
        this._colors.shift();
      }

      this._chart.data.datasets[0].pointBackgroundColor = [...this._colors];
      this._chart.update("none"); // no animation for real-time feel
    }

    reset() {
      this._labels.length = 0;
      this._values.length = 0;
      this._colors.length = 0;
      if (this._chart) this._chart.update();
    }

    // Returns a data URL for embedding in the report image
    snapshot() {
      return this._canvas ? this._canvas.toDataURL("image/png") : null;
    }
  }

  window.expressionGraph = new ExpressionGraph();
})();
