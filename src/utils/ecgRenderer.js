/**
 * ECG Renderer — proper heart-monitor waveform
 *
 * Renders PQRST complexes from tap timestamps (ecgHistory).
 * Each tap = one heartbeat → one PQRST cycle drawn on a flat baseline.
 * Cycle width is proportional to the RR interval (i.e. slower BPM = wider cycles).
 *
 * Anatomy of one PQRST cycle (as fractions of the RR interval):
 *   TP flat  →  P wave  →  PQ flat  →  Q dip  →  R spike  →  S dip  →  ST flat  →  T wave  →  next TP
 */

const SVG_W = 800;
const SVG_H = 220;
const PAD   = { t: 20, b: 20, l: 16, r: 16 };
const CW    = SVG_W - PAD.l - PAD.r;
const CH    = SVG_H - PAD.t - PAD.b;

// Show the last N ms of the run
const WINDOW_MS = 9000;

// ── PQRST template ────────────────────────────────────────────────────────────
// Each entry: [xFrac, yFrac]
//   xFrac: 0=beat start (= previous R), 1=next beat start
//   yFrac: 0=baseline, +1=full upward amplitude, -1=full downward amplitude
const TEMPLATE = [
  [0.00,  0.00],   // TP baseline
  [0.14,  0.00],   // before P
  [0.20,  0.13],   // P peak (atrial depolarisation)
  [0.26,  0.00],   // after P
  [0.31,  0.00],   // PQ flat
  [0.34, -0.08],   // Q dip
  [0.36,  1.00],   // R peak ← the main spike
  [0.38, -0.18],   // S dip
  [0.44,  0.00],   // return to baseline (ST)
  [0.56,  0.00],   // ST segment
  [0.62,  0.24],   // T peak (ventricular repolarisation)
  [0.72,  0.00],   // T end
  [1.00,  0.00],   // TP flat (next beat)
];

/**
 * Emit SVG points for one PQRST cycle.
 * @param {number} x0       SVG x at cycle start
 * @param {number} x1       SVG x at cycle end (next beat)
 * @param {number} baseY    SVG y of baseline
 * @param {number} amp      pixel height of R peak above baseline
 * @returns {string[]}      array of "x,y" strings
 */
function pqrstPoints(x0, x1, baseY, amp) {
  const w = x1 - x0;
  return TEMPLATE.map(([xf, yf]) => {
    const x = x0 + xf * w;
    const y = baseY - yf * amp;        // SVG y-axis is inverted
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
}

// ── V-fib pattern for cardiac arrest ─────────────────────────────────────────
function vfibPoints(xStart, xEnd, baseY, amp) {
  const pts = [];
  const span = xEnd - xStart;
  // Guard: no room for V-fib — return baseline point to avoid 0/0 NaN
  if (span < 1) return [`${xStart.toFixed(1)},${baseY.toFixed(1)}`];
  const step = 6;
  let phase = 0;
  for (let x = xStart; x <= xEnd; x += step) {
    // Irregular oscillation that decays to nothing
    const progress = (x - xStart) / span;
    const decay    = Math.max(0, 1 - progress * 1.4);
    const y = baseY - Math.sin(phase) * amp * 0.55 * decay
                    - Math.sin(phase * 2.3 + 1) * amp * 0.25 * decay;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    phase += 0.55 + (Math.sin(x * 0.07) * 0.3);
  }
  return pts;
}

// ── Main path builder ─────────────────────────────────────────────────────────
function buildWaveform(samples, deathCause) {
  if (!samples || samples.length === 0) {
    return { polyline: '', flatlineX: PAD.l, baseY: PAD.t + CH * 0.55 };
  }

  // Restrict to visible window
  const lastT   = samples[samples.length - 1].t;
  const firstT  = Math.max(0, lastT - WINDOW_MS);
  const visible = samples.filter(s => s.t >= firstT);

  const tToX  = (t) => PAD.l + ((t - firstT) / WINDOW_MS) * CW;
  const baseY = PAD.t + CH * 0.58;
  const amp   = CH * 0.52;            // R-peak height in pixels

  const allPts = [];

  // Opening flat segment
  const firstX = visible.length > 0 ? tToX(visible[0].t) : PAD.l;
  allPts.push(`${PAD.l},${baseY.toFixed(1)}`);
  if (firstX > PAD.l + 2) allPts.push(`${firstX.toFixed(1)},${baseY.toFixed(1)}`);

  for (let i = 0; i < visible.length; i++) {
    const beatT = visible[i].t;

    // RR interval — use inter-beat gap; fall back to BPM-derived value
    let rrMs;
    if (i + 1 < visible.length) {
      rrMs = visible[i + 1].t - beatT;
    } else if (i > 0) {
      rrMs = beatT - visible[i - 1].t;
    } else {
      rrMs = Math.round(60_000 / (visible[i].bpm || 75));
    }
    // Clamp to physiological range
    rrMs = Math.max(350, Math.min(1400, rrMs));

    // R peak is at beatT; cycle spans beatT - 0.36*RR → beatT + 0.64*RR
    const cycleStart = beatT - rrMs * 0.36;
    const cycleEnd   = beatT + rrMs * 0.64;

    const x0 = tToX(cycleStart);
    const x1 = tToX(cycleEnd);

    // Skip cycles fully outside the visible window
    if (x1 < PAD.l || x0 > PAD.l + CW) continue;

    const pts = pqrstPoints(
      Math.max(PAD.l, x0),
      Math.min(PAD.l + CW, x1),
      baseY,
      amp,
    );
    allPts.push(...pts);
  }

  // End of waveform x — where flatline or V-fib starts
  const lastBeatX = visible.length > 0 ? tToX(visible[visible.length - 1].t) : PAD.l;
  const tailStartX = Math.min(PAD.l + CW, lastBeatX + (CW * 0.08));

  if (deathCause === 'arrest') {
    // V-fib: chaotic oscillation collapsing to flat
    const vfibEndX = Math.min(PAD.l + CW, tailStartX + CW * 0.45);
    allPts.push(...vfibPoints(tailStartX, vfibEndX, baseY, amp));
    allPts.push(`${(PAD.l + CW).toFixed(1)},${baseY.toFixed(1)}`);
  } else {
    // Flatline: trail off to a clean horizontal
    allPts.push(`${tailStartX.toFixed(1)},${baseY.toFixed(1)}`);
    allPts.push(`${(PAD.l + CW).toFixed(1)},${baseY.toFixed(1)}`);
  }

  return {
    polyline:  allPts.join(' '),
    flatlineX: tailStartX,
    baseY,
  };
}

// ── Grid lines (ECG paper style) ──────────────────────────────────────────────
function buildGrid() {
  const lines = [];
  const cols = 10;
  const rows = 6;

  for (let i = 0; i <= cols; i++) {
    const x     = PAD.l + (i / cols) * CW;
    const isMaj = i % 5 === 0;
    lines.push(
      `<line x1="${x}" y1="${PAD.t}" x2="${x}" y2="${SVG_H - PAD.b}"` +
      ` stroke="${isMaj ? '#1e1e1e' : '#141414'}" stroke-width="${isMaj ? 1 : 0.5}"/>`,
    );
  }
  for (let j = 0; j <= rows; j++) {
    const y     = PAD.t + (j / rows) * CH;
    const isMaj = j % 3 === 0;
    lines.push(
      `<line x1="${PAD.l}" y1="${y}" x2="${SVG_W - PAD.r}" y2="${y}"` +
      ` stroke="${isMaj ? '#1e1e1e' : '#141414'}" stroke-width="${isMaj ? 1 : 0.5}"/>`,
    );
  }
  return lines.join('\n  ');
}

// ── Public API ────────────────────────────────────────────────────────────────
export function generateEcgSvg({
  ecgHistory,
  score,
  zoneName,
  peakBpm,
  lowestBpm,
  survivalMs,
  deathCause,
}) {
  const { polyline, flatlineX, baseY } = buildWaveform(ecgHistory, deathCause);

  const survivalSec  = Math.floor(survivalMs / 1000);
  const survivalLabel = `${Math.floor(survivalSec / 60)}:${String(survivalSec % 60).padStart(2, '0')}`;
  const scoreLabel   = Math.floor(score).toLocaleString();

  const flatlineColor = deathCause === 'flatline' ? '#4FC3F7'
                      : deathCause === 'arrest'   ? '#FF1744'
                      : '#FF1744';

  // Flatline end-marker (only for non-arrest deaths)
  const flatlineMark = deathCause !== 'arrest'
    ? `<line x1="${flatlineX.toFixed(1)}" y1="${baseY}" x2="${(SVG_W - PAD.r).toFixed(1)}" y2="${baseY}"
         stroke="${flatlineColor}" stroke-width="1.5" stroke-dasharray="6 4" opacity="0.7"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 ${SVG_W} ${SVG_H + 70}"
     width="${SVG_W}" height="${SVG_H + 70}">

  <rect width="100%" height="100%" fill="#000"/>

  <!-- ECG grid -->
  ${buildGrid()}

  <!-- PQRST waveform -->
  <polyline
    points="${polyline}"
    fill="none"
    stroke="#00E676"
    stroke-width="2.2"
    stroke-linecap="round"
    stroke-linejoin="round"/>

  <!-- Flatline marker -->
  ${flatlineMark}

  <!-- Stats -->
  <text x="${SVG_W / 2}" y="${SVG_H + 22}"
    text-anchor="middle" font-family="monospace"
    font-size="30" font-weight="bold" fill="#ffffff">${scoreLabel}</text>

  <text x="${SVG_W / 2}" y="${SVG_H + 50}"
    text-anchor="middle" font-family="monospace"
    font-size="13" fill="#555">
    ${survivalLabel}  ·  ${zoneName}  ·  ${peakBpm} BPM peak  ·  ${lowestBpm} BPM low
  </text>
</svg>`.trim();
}
