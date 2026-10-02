/* Hand-drawn canvas charts: bar chart with moving average + goal line, and a progress ring. */
"use strict";

const GOLD = "#D4AF37", GREEN = "#34C759";

function fitCanvas(canvas, w, h) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  const c = canvas.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return c;
}

function createBarChart(onSelect) {
  const wrap = document.createElement("div");
  wrap.style.width = "100%";
  const canvas = document.createElement("canvas");
  canvas.className = "chart";
  wrap.appendChild(canvas);
  const st = { bars: [], showAverage: false, goalSec: 0, selected: -1 };
  const H = 200, padL = 6, padR = 6, padT = 12, padB = 22;

  function draw() {
    const W = wrap.clientWidth || 300;
    if (!W) return;
    const c = fitCanvas(canvas, W, H);
    c.clearRect(0, 0, W, H);
    const bars = st.bars;
    if (!bars.length) return;
    const top = padT, bottom = H - padB;
    const maxV = Math.max(Math.max(...bars.map(b => b.sec)), st.goalSec, 60) * 1.15;
    const y = (v) => bottom - (bottom - top) * v / maxV;
    c.strokeStyle = "rgba(255,255,255,0.13)"; c.lineWidth = 1;
    for (let i = 0; i <= 3; i++) { const gy = bottom - (bottom - top) * i / 3; c.beginPath(); c.moveTo(padL, gy); c.lineTo(W - padR, gy); c.stroke(); }
    const slot = (W - padL - padR) / bars.length, bw = slot * 0.62;
    bars.forEach((b, i) => {
      const cx = padL + slot * (i + 0.5);
      const hit = st.goalSec > 0 && b.sec >= st.goalSec;
      c.globalAlpha = (st.selected === -1 || st.selected === i) ? 1 : 0.43;
      c.fillStyle = hit ? GREEN : GOLD;
      if (b.sec > 0) {
        const top2 = y(b.sec), r = 3;
        c.beginPath();
        c.moveTo(cx - bw / 2, bottom); c.lineTo(cx - bw / 2, top2 + r); c.quadraticCurveTo(cx - bw / 2, top2, cx - bw / 2 + r, top2);
        c.lineTo(cx + bw / 2 - r, top2); c.quadraticCurveTo(cx + bw / 2, top2, cx + bw / 2, top2 + r); c.lineTo(cx + bw / 2, bottom); c.closePath(); c.fill();
      } else { c.globalAlpha = 0.25; c.fillRect(cx - bw / 2, bottom - 2, bw, 2); }
    });
    c.globalAlpha = 1;
    if (st.goalSec > 0) {
      c.strokeStyle = GREEN; c.lineWidth = 1.5; c.setLineDash([8, 6]);
      c.beginPath(); c.moveTo(padL, y(st.goalSec)); c.lineTo(W - padR, y(st.goalSec)); c.stroke(); c.setLineDash([]);
    }
    if (st.showAverage && bars.length > 1) {
      c.strokeStyle = "#fff"; c.lineWidth = 2; c.lineJoin = "round"; c.beginPath();
      bars.forEach((b, i) => {
        const from = Math.max(0, i - 6);
        let s = 0; for (let k = from; k <= i; k++) s += bars[k].sec;
        const avg = s / (i - from + 1), cx = padL + slot * (i + 0.5);
        if (i === 0) c.moveTo(cx, y(avg)); else c.lineTo(cx, y(avg));
      });
      c.stroke();
    }
    c.fillStyle = "#8FA0C4"; c.font = "10px -apple-system, sans-serif";
    const every = Math.max(1, Math.ceil(bars.length / 6));
    bars.forEach((b, i) => {
      if ((bars.length - 1 - i) % every !== 0) return;
      const cx = padL + slot * (i + 0.5), tw = c.measureText(b.label).width;
      c.fillText(b.label, Math.min(Math.max(0, cx - tw / 2), W - tw), H - 6);
    });
  }

  function pick(ev) {
    if (!st.bars.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
    const slot = (rect.width - padL - padR) / st.bars.length;
    const i = Math.min(st.bars.length - 1, Math.max(0, Math.floor((x - padL) / slot)));
    if (i !== st.selected) { st.selected = i; draw(); onSelect && onSelect(i, st.bars[i]); }
  }
  canvas.addEventListener("pointerdown", pick);
  canvas.addEventListener("pointermove", (e) => { if (e.buttons || e.pointerType === "touch") pick(e); });
  canvas.style.touchAction = "pan-y";

  return {
    el: wrap,
    set(bars, opts) { st.bars = bars; st.selected = -1; st.showAverage = !!(opts && opts.showAverage); st.goalSec = (opts && opts.goalSec) || 0; draw(); },
    redraw: draw,
    get bars() { return st.bars; }
  };
}

function createRing() {
  const canvas = document.createElement("canvas");
  const S = 120;
  return {
    el: canvas,
    set(progress, center, sub) {
      const c = fitCanvas(canvas, S, S);
      c.clearRect(0, 0, S, S);
      const p = Math.min(1, Math.max(0, progress)), r = S / 2 - 12;
      c.lineWidth = 12; c.lineCap = "round";
      c.strokeStyle = "#1A2440"; c.beginPath(); c.arc(S / 2, S / 2, r, 0, Math.PI * 2); c.stroke();
      if (p > 0) { c.strokeStyle = p >= 1 ? GREEN : GOLD; c.beginPath(); c.arc(S / 2, S / 2, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p); c.stroke(); }
      c.textAlign = "center"; c.fillStyle = "#EAF0FF"; c.font = "bold 24px -apple-system, sans-serif"; c.fillText(center, S / 2, S / 2 + 6);
      c.fillStyle = "#8FA0C4"; c.font = "11px -apple-system, sans-serif"; c.fillText(sub, S / 2, S / 2 + 24);
    }
  };
}
