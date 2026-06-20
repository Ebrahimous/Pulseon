import { create } from 'zustand';
import { ZONES, getZoneForBpm } from '../engine/zoneManager';
import { loadPersisted } from '../utils/storage';

// Normal heartbeat range — start values, narrow over time
export const BPM_NORMAL_LOW  = 65;
export const BPM_NORMAL_HIGH = 85;
export const BPM_MIN = 30;
export const BPM_MAX = 200;

// BPM realism
const BPM_SMOOTH       = 0.5;
const BPM_DECAY_RATE   = 6;
const BPM_RESTING      = 75;
const BPM_DECAY_DELAY  = 600;

// Death thresholds
const FLATLINE_MS     = 3200;
const STROKE_MS       = 3000;
const GRACE_PERIOD_MS = 1500;

// Difficulty escalation
const DIFFICULTY_INTERVAL_MS = 30_000;
const RANGE_NARROW_AMOUNT    = 2;
const MIN_RANGE_LOW          = 72;
const MIN_RANGE_HIGH         = 78;
const SPEED_MULT_INCREASE    = 0.15;

// Ring density
const MAX_RINGS_BY_ZONE = {
  surface: 3, shallow: 4, deep: 5, abyss: 6, void: 7,
};

const TAP_WINDOW = 6;

export const PHASE = {
  START:   'start',
  PLAYING: 'playing',
  DYING:   'dying',
  DEAD:    'dead',
};

let ringIdCounter = 0;

export const useGameStore = create((set, get) => ({

  phase: PHASE.START,

  // ── Tap-derived BPM ───────────────────────────────────────────────────────
  tapTimestamps:   [],
  displayBpm:      75,
  lastTapMs:       0,
  flatlineAccumMs: 0,
  strokeAccumMs:   0,
  gameStartMs:     0,
  spawnCount:      0,

  // ── Dynamic BPM range ─────────────────────────────────────────────────────
  currentBpmLow:  BPM_NORMAL_LOW,
  currentBpmHigh: BPM_NORMAL_HIGH,
  difficultyLevel: 0,
  difficultyAccumMs: 0,
  ringSpeedMult: 1.0,

  // ── Player ────────────────────────────────────────────────────────────────
  playerX: 0,
  playerY: 0,

  // ── Rings ─────────────────────────────────────────────────────────────────
  rings: [],

  // ── Zone & visuals ────────────────────────────────────────────────────────
  zone:        ZONES[0],
  accentColor: ZONES[0].color,

  // ── Score & combo ─────────────────────────────────────────────────────────
  combo:     1,   // starts at ×1 — floor, never shown until >1
  bestCombo: 1,
  score:     0,
  bestScore: 0,   // persists across resets — loaded from storage on app start
  survivalMs: 0,

  // ── Lives ─────────────────────────────────────────────────────────────────
  lives:    3,
  maxLives: 3,

  // ── ECG ───────────────────────────────────────────────────────────────────
  ecgHistory: [],
  peakBpm:    75,
  lowestBpm:  75,

  // ── Run stats ─────────────────────────────────────────────────────────────
  ringsDodged: 0,

  // ── Death ─────────────────────────────────────────────────────────────────
  deathCause: null,

  // ── Actions ───────────────────────────────────────────────────────────────

  setPhase: (phase) => set({ phase }),
  setPlayerPosition: (x, y) => set({ playerX: x, playerY: y }),

  startGame: () => set({
    gameStartMs:     Date.now(),
    lastTapMs:       Date.now(),
    flatlineAccumMs: 0,
    strokeAccumMs:   0,
  }),

  /** Load persisted best score from device storage. Call on app start. */
  loadBestScore: async () => {
    try {
      const data = await loadPersisted();
      if (data?.bestScore > 0) set({ bestScore: data.bestScore });
    } catch {}
  },

  registerTap: (x, y) => {
    const now = Date.now();
    const { phase, tapTimestamps, survivalMs } = get();
    if (phase !== PHASE.PLAYING) return;

    const newTaps = [...tapTimestamps, now].slice(-TAP_WINDOW);

    let newBpm = get().displayBpm;
    if (newTaps.length >= 2) {
      const intervals = [];
      for (let i = 1; i < newTaps.length; i++) intervals.push(newTaps[i] - newTaps[i - 1]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const rawBpm = Math.min(BPM_MAX, Math.max(BPM_MIN, 60_000 / avg));
      newBpm = Math.round(get().displayBpm * (1 - BPM_SMOOTH) + rawBpm * BPM_SMOOTH);
    }

    const zone = getZoneForBpm(newBpm);

    set((s) => {
      const newScore     = s.score + s.combo;  // each tap = 1 × current combo
      const newBestScore = Math.max(s.bestScore, newScore);
      return {
        tapTimestamps:   newTaps,
        displayBpm:      newBpm,
        lastTapMs:       now,
        flatlineAccumMs: 0,
        zone,
        accentColor:     zone.color,
        playerX:         x,
        playerY:         y,
        peakBpm:         Math.max(s.peakBpm, newBpm),
        lowestBpm:       newTaps.length >= 2 ? Math.min(s.lowestBpm, newBpm) : s.lowestBpm,
        ecgHistory:      [...s.ecgHistory, { t: survivalMs, bpm: newBpm }],
        score:           newScore,
        bestScore:       newBestScore,
      };
    });
  },

  // Near-miss: ring passed close — spike BPM slightly (adrenaline)
  applyNearMissScare: () => {
    const { phase, displayBpm } = get();
    if (phase !== PHASE.PLAYING) return;
    const spike  = 5 + Math.floor(Math.random() * 3); // +5–7 BPM
    const newBpm = Math.min(BPM_MAX, displayBpm + spike);
    const zone   = getZoneForBpm(newBpm);
    set({ displayBpm: newBpm, zone, accentColor: zone.color });
  },

  // Flatline: no tap for too long
  tickFlatline: (deltaMs) => {
    const { phase, flatlineAccumMs, gameStartMs } = get();
    if (phase !== PHASE.PLAYING) return;
    if (Date.now() - gameStartMs < GRACE_PERIOD_MS) return;

    const newAccum = flatlineAccumMs + deltaMs;
    if (newAccum >= FLATLINE_MS) {
      set({ deathCause: 'flatline', phase: PHASE.DYING });
    } else {
      set({ flatlineAccumMs: newAccum });
    }
  },

  // Stroke: sustained tapping above range
  tickStroke: (deltaMs) => {
    const { phase, displayBpm, strokeAccumMs, currentBpmHigh } = get();
    if (phase !== PHASE.PLAYING) return;

    if (displayBpm > currentBpmHigh) {
      const newAccum = strokeAccumMs + deltaMs;
      if (newAccum >= STROKE_MS) {
        set({ deathCause: 'stroke', phase: PHASE.DYING });
      } else {
        set({ strokeAccumMs: newAccum });
      }
    } else if (strokeAccumMs > 0) {
      set({ strokeAccumMs: 0 });
    }
  },

  // Difficulty: narrow BPM range + speed up rings every 30s
  tickDifficulty: (deltaMs) => {
    const { phase, difficultyAccumMs, currentBpmLow, currentBpmHigh, ringSpeedMult, difficultyLevel } = get();
    if (phase !== PHASE.PLAYING) return;

    const newAccum = difficultyAccumMs + deltaMs;
    if (newAccum >= DIFFICULTY_INTERVAL_MS) {
      const newLow  = Math.min(MIN_RANGE_LOW,  currentBpmLow  + RANGE_NARROW_AMOUNT);
      const newHigh = Math.max(MIN_RANGE_HIGH, currentBpmHigh - RANGE_NARROW_AMOUNT);
      set({
        currentBpmLow:     newLow,
        currentBpmHigh:    newHigh,
        ringSpeedMult:     Math.min(2.5, ringSpeedMult + SPEED_MULT_INCREASE),
        difficultyLevel:   difficultyLevel + 1,
        difficultyAccumMs: newAccum - DIFFICULTY_INTERVAL_MS,
      });
    } else {
      set({ difficultyAccumMs: newAccum });
    }
  },

  // BPM decay — drifts displayBpm back toward resting when not tapping
  tickBpmDecay: (deltaMs) => {
    const { phase, displayBpm, lastTapMs } = get();
    if (phase !== PHASE.PLAYING) return;
    if (Date.now() - lastTapMs < BPM_DECAY_DELAY) return;

    const decayAmount = (BPM_DECAY_RATE * deltaMs) / 1000;
    const newBpm = displayBpm > BPM_RESTING
      ? Math.max(BPM_RESTING, displayBpm - decayAmount)
      : Math.min(BPM_RESTING, displayBpm + decayAmount);
    const rounded = Math.round(newBpm);
    if (rounded === displayBpm) return;

    const zone = getZoneForBpm(rounded);
    set({ displayBpm: rounded, zone, accentColor: zone.color });
  },

  // Ring hit — costs a life, breaks combo, triggers arrest if lives=0
  markRingHit: (id) => {
    set((s) => {
      const newLives     = s.lives - 1;
      const newBestCombo = Math.max(s.bestCombo, s.combo);
      const base = {
        rings:     s.rings.map((r) => r.id === id ? { ...r, wasHit: true } : r),
        bestCombo: newBestCombo,
        combo:     1,   // reset to floor, not zero
        lives:     newLives,
      };
      if (newLives <= 0) {
        return { ...base, lives: 0, deathCause: 'arrest', phase: PHASE.DYING };
      }
      return base;
    });
  },

  spawnRing: (screenWidth, screenHeight) => {
    const { displayBpm, zone, rings, playerX, playerY, ringSpeedMult } = get();
    const maxRings = MAX_RINGS_BY_ZONE[zone.id] ?? 4;
    if (rings.length >= maxRings) return;

    const diagonal = Math.hypot(screenWidth, screenHeight);

    // Ring type — weighted: 60% normal, 25% fast, 15% inward
    const rand = Math.random();
    const type = rand < 0.60 ? 'normal' : rand < 0.85 ? 'fast' : 'inward';

    let speed, maxRadius, startRadius, dir;
    if (type === 'fast') {
      speed       = 2.2 * (displayBpm / 80) * ringSpeedMult;
      maxRadius   = diagonal * 0.32;
      startRadius = 0;
      dir         = 1;
    } else if (type === 'inward') {
      speed       = 0.75 * (displayBpm / 80) * ringSpeedMult;
      maxRadius   = diagonal * 0.60;
      startRadius = maxRadius;
      dir         = -1;
    } else {
      speed       = 1.0 * (displayBpm / 80) * ringSpeedMult;
      maxRadius   = diagonal * 0.65;
      startRadius = 0;
      dir         = 1;
    }

    // Spawn origin off-screen so the ring sweeps in from an edge,
    // giving the player time to react before it reaches them.
    const EDGE_OFFSET = 40; // px beyond the screen boundary
    let originX, originY;
    const edge = Math.floor(Math.random() * 4); // 0=top 1=right 2=bottom 3=left
    switch (edge) {
      case 0:
        originX = Math.random() * screenWidth;
        originY = -EDGE_OFFSET;
        break;
      case 1:
        originX = screenWidth + EDGE_OFFSET;
        originY = Math.random() * screenHeight;
        break;
      case 2:
        originX = Math.random() * screenWidth;
        originY = screenHeight + EDGE_OFFSET;
        break;
      default:
        originX = -EDGE_OFFSET;
        originY = Math.random() * screenHeight;
        break;
    }

    set((s) => ({
      spawnCount: s.spawnCount + 1,
      rings: [...s.rings, {
        id: ringIdCounter++,
        originX, originY,
        radius: startRadius,
        speed, maxRadius, dir, type,
        danger: false, wasHit: false,
        spawnOpacity: 0,   // fades 0→1 over first 300ms
      }],
    }));
  },

  // Advance all rings; award +combo for clean expiries
  tickRings: (deltaMs) => {
    const { rings } = get();
    const dt = deltaMs / 16.67;

    const updated = rings.map((r) => {
      const dir  = r.dir ?? 1;
      const newR = dir > 0
        ? r.radius + r.speed * dt
        : Math.max(0, r.radius - r.speed * dt);
      const newOpacity = Math.min(1, (r.spawnOpacity ?? 1) + deltaMs / 300);
      return { ...r, radius: newR, spawnOpacity: newOpacity };
    });

    const alive      = updated.filter((r) => (r.dir ?? 1) > 0 ? r.radius < r.maxRadius  : r.radius > 0);
    const expired    = updated.filter((r) => (r.dir ?? 1) > 0 ? r.radius >= r.maxRadius : r.radius <= 0);
    const cleanCount = expired.filter((r) => !r.wasHit).length;

    if (cleanCount > 0) {
      set((s) => ({
        rings:       alive,
        combo:       s.combo + cleanCount,
        bestCombo:   Math.max(s.bestCombo, s.combo + cleanCount),
        ringsDodged: s.ringsDodged + cleanCount,
      }));
    } else {
      set({ rings: alive });
    }
  },

  tickSurvival: (deltaMs) => {
    set((s) => ({ survivalMs: s.survivalMs + deltaMs }));
  },

  resetGame: () => set({
    phase:             PHASE.START,
    tapTimestamps:     [],
    displayBpm:        75,
    lastTapMs:         0,
    flatlineAccumMs:   0,
    strokeAccumMs:     0,
    gameStartMs:       0,
    currentBpmLow:     BPM_NORMAL_LOW,
    currentBpmHigh:    BPM_NORMAL_HIGH,
    difficultyLevel:   0,
    difficultyAccumMs: 0,
    ringSpeedMult:     1.0,
    rings:             [],
    zone:              ZONES[0],
    accentColor:       ZONES[0].color,
    combo:             1,
    bestCombo:         1,
    score:             0,
    // bestScore NOT reset — persists as all-time best
    survivalMs:        0,
    ecgHistory:        [],
    peakBpm:           75,
    lowestBpm:         75,
    ringsDodged:       0,
    deathCause:        null,
    playerX:           0,
    playerY:           0,
    spawnCount:        0,
    lives:             3,
  }),
}));
