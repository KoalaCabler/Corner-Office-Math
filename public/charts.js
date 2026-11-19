// Tiny SVG line charts with a hover crosshair and tooltip. No libraries.
//
// lineChart(container, {
//   series: [{ name, color, values: [{ x: year, y, estimated }] }],
//   yFormat: v => '$1.2M',
//   band: [{ x, lo, hi }],      // optional shaded range drawn behind the lines
//   baseline: 100,               // optional reference line (e.g. index = 100)
//   yMin: 0,                     // optional fixed bottom of the y axis
// })
//
// Points marked `estimated` are drawn with a dashed line and hollow markers,
// so modelled values (e.g. pre-2018 estimates) never look like reported ones.

(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (name, attrs = {}, parent) => {
    const n = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  };

  function niceTicks(min, max, count = 5) {
    if (min === max) { max = min + 1; }
    const span = max - min;
    const step0 = span / count;
    const mag = 10 ** Math.floor(Math.log10(step0));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= count) || 10 * mag;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
    return ticks;
  }

  const tooltip = () => document.getElementById('tooltip');

  function showTip(evt, html) {
    const t = tooltip();
    t.innerHTML = html;
    t.hidden = false;
    const pad = 14;
    const r = t.getBoundingClientRect();
    let x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - pad;
    t.style.left = Math.max(8, x) + 'px';
    t.style.top = Math.max(8, y) + 'px';
  }
  function hideTip() { tooltip().hidden = true; }

  function lineChart(container, opts) {
    container.innerHTML = '';
    const series = opts.series.filter(s => s.values.some(v => v.y != null));
    if (!series.length) {
      container.innerHTML = '<p class="empty">No data for this chart yet.</p>';
      return;
    }
    const fmt = opts.yFormat || (v => String(v));
    // Draw at the container's real width so text stays the same size everywhere.
    const W = Math.max(300, Math.round(container.clientWidth || 640));
    const narrow = W < 460;
    const H = opts.height || (narrow ? 240 : 280);
    const labels = opts.directLabels !== false && !narrow;
    const m = { top: 14, right: labels ? 112 : 16, bottom: 28, left: 64 };
    const xs = [...new Set(series.flatMap(s => s.values.filter(v => v.y != null).map(v => v.x)))].sort((a, b) => a - b);
    const ys = series.flatMap(s => s.values.map(v => v.y)).filter(v => v != null);
    if (opts.band) for (const b of opts.band) ys.push(b.lo, b.hi);
    if (opts.baseline != null) ys.push(opts.baseline);
    let yMin = opts.yMin != null ? Math.min(opts.yMin, ...ys) : Math.min(...ys);
    let yMax = Math.max(...ys);
    if (opts.yMin == null) yMin = Math.max(0, yMin - (yMax - yMin) * 0.08);
    const ticks = niceTicks(yMin, yMax);
    yMin = ticks[0]; yMax = ticks[ticks.length - 1];

    const xMin = xs[0], xMax = xs[xs.length - 1];
    const X = x => m.left + (xMax === xMin ? (W - m.left - m.right) / 2 : ((x - xMin) / (xMax - xMin)) * (W - m.left - m.right));
    const Y = y => m.top + (1 - (y - yMin) / (yMax - yMin)) * (H - m.top - m.bottom);

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.label || 'Line chart' });

    // grid + y axis
    const grid = el('g', { class: 'grid' }, svg);
    const yAxis = el('g', { class: 'axis' }, svg);
    for (const t of ticks) {
      el('line', { x1: m.left, x2: W - m.right, y1: Y(t), y2: Y(t) }, grid);
      el('text', { x: m.left - 8, y: Y(t) + 4, 'text-anchor': 'end' }, yAxis).textContent = fmt(t);
    }
    // x axis
    const xAxis = el('g', { class: 'axis' }, svg);
    const every = Math.max(1, Math.ceil(xs.length / Math.floor((W - m.left - m.right) / 44)));
    xs.forEach((x, i) => {
      if (i % every && i !== xs.length - 1) return;
      el('text', { x: X(x), y: H - 8, 'text-anchor': 'middle' }, xAxis).textContent = String(x);
    });
    el('line', { class: 'baseline', x1: m.left, x2: W - m.right, y1: Y(yMin), y2: Y(yMin) }, svg);

    if (opts.baseline != null) {
      el('line', { x1: m.left, x2: W - m.right, y1: Y(opts.baseline), y2: Y(opts.baseline), stroke: 'var(--muted)', 'stroke-dasharray': '4 4', 'stroke-width': 1 }, svg);
    }

    if (opts.band && opts.band.length > 1) {
      const pts = opts.band.map(b => `${X(b.x)},${Y(b.hi)}`).concat([...opts.band].reverse().map(b => `${X(b.x)},${Y(b.lo)}`));
      el('polygon', { points: pts.join(' '), fill: 'var(--band)' }, svg);
    }

    // lines: split into solid (reported) and dashed (estimated) segments
    for (const s of series) {
      const pts = s.values.filter(v => v.y != null).sort((a, b) => a.x - b.x);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        el('line', {
          x1: X(a.x), y1: Y(a.y), x2: X(b.x), y2: Y(b.y),
          stroke: s.color, 'stroke-width': 2, 'stroke-linecap': 'round',
          ...(a.estimated || b.estimated ? { 'stroke-dasharray': '5 4' } : {}),
        }, svg);
      }
      for (const p of pts) {
        el('circle', {
          cx: X(p.x), cy: Y(p.y), r: pts.length > 14 ? 2.5 : 4,
          fill: p.estimated ? 'var(--surface)' : s.color, stroke: p.estimated ? s.color : 'var(--surface)', 'stroke-width': 2,
        }, svg);
      }
    }

    // direct labels at the right end (nudged apart so they don't collide)
    if (labels) {
      const tags = series.map(s => {
        const last = s.values.filter(v => v.y != null).sort((a, b) => a.x - b.x).pop();
        return { s, y: Y(last.y), x: X(last.x) };
      }).sort((a, b) => a.y - b.y);
      for (let i = 1; i < tags.length; i++) if (tags[i].y - tags[i - 1].y < 15) tags[i].y = tags[i - 1].y + 15;
      for (const l of tags) {
        el('text', { class: 'label', x: l.x + 10, y: l.y + 4 }, svg).textContent = l.s.short || l.s.name;
      }
    }

    // hover layer
    const cross = el('line', { class: 'crosshair', y1: m.top, y2: H - m.bottom, visibility: 'hidden' }, svg);
    const hit = el('rect', { x: m.left - 10, y: 0, width: W - m.left - m.right + 20, height: H, fill: 'transparent' }, svg);
    const nearestX = evt => {
      const box = svg.getBoundingClientRect();
      const px = ((evt.clientX - box.left) / box.width) * W;
      return xs.reduce((best, x) => (Math.abs(X(x) - px) < Math.abs(X(best) - px) ? x : best), xs[0]);
    };
    const onMove = evt => {
      const x = nearestX(evt);
      cross.setAttribute('x1', X(x)); cross.setAttribute('x2', X(x)); cross.setAttribute('visibility', 'visible');
      const rows = series.map(s => {
        const v = s.values.find(p => p.x === x);
        if (!v || v.y == null) return '';
        return `<div class="t-row"><span><i class="swatch" style="background:${s.color}"></i>${s.name}${v.estimated ? ' (est.)' : ''}</span><b>${fmt(v.y)}</b></div>`;
      }).join('');
      const extra = opts.tooltipExtra ? opts.tooltipExtra(x) : '';
      showTip(evt, `<div class="t-head">${opts.xLabel ? opts.xLabel(x) : x}</div>${rows}${extra}`);
    };
    hit.addEventListener('pointermove', onMove);
    hit.addEventListener('pointerdown', onMove);
    hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); hideTip(); });

    container.appendChild(svg);
    container._chartOpts = opts;
  }

  // Redraw every chart when the page width changes.
  let resizeTimer, lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      document.querySelectorAll('.chart').forEach(c => c._chartOpts && lineChart(c, c._chartOpts));
    }, 150);
  });

  window.Charts = { lineChart, hideTip };
})();
