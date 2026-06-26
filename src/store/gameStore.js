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
const STROKE_MS       = 5000;   // increased from 3 s — more time to correct an overshoot
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
  ecgHistory:  [],
  peakBpm:     75,
  lowestBpm:   75,
  lastEcgMs:   0,   // last time we appended to ecgHistory (rate-limited to ~5 Hz)

  // ── Run stats ─────────────────────────────────────────────────────────────
  ringsDodged: 0,

  // ── Death ─────────────────────────────────────────────────────────────────
  deathCause: null,

  // ── Streak (persisted) ────────────────────────────────────────────────────
  runStreak:  0,
  bestStreak: 0,

  // ── Actions ───────────────────────────────────────────────────────────────

  setPhase: (phase) => set({ phase }),
  setPlayerPosition: (x, y) => set({ playerX: x, playerY: y }),

  startGame: () => set({
    gameStartMs:     Date.now(),
    lastTapMs:       Date.now(),
    flatlineAccumMs: 0,
    strokeAccumMs:   0,
  }),

  /** Load persisted best score and streak from device storage. Call on app start. */
  loadBestScore: async () => {
    try {
      const data = await loadPersisted();
      if (data?.bestScore  > 0) set({ bestScore:  data.bestScore });
      if (data?.runStreak  > 0) set({ runStreak:  data.runStreak });
      if (data?.bestStreak > 0) set({ bestStreak: data.bestStreak });
    } catch {}
  },

  /** Called at end of each run. Qualifies if player survived ≥ 15 s. */
  recordRunResult: (survivalMs) => {
    const qualified = survivalMs >= 15_000;
    set((s) => {
      const newStreak = qualified ? s.runStreak + 1 : 0;
      const newBest   = Math.max(s.bestStreak, newStreak);
      return { runStreak: newStreak, bestStreak: newBest };
    });
  },

  /** Returns streak values for persistence. */
  getStreakData: () => {
    const { runStreak, bestStreak } = get();
    return { runStreak, bestStreak };
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
        score:           newScore,
        bestScore:       newBestScore,
        // ecgHistory, peakBpm, lowestBpm sampled in tickAll to avoid per-tap array spread
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

  // ── tickAll: single set() per frame — replaces 6 individual tick calls ────
  // Batching everything into one set() means one Zustand notification and one
  // React re-render per frame instead of up to six.
  tickAll: (deltaMs) => {
    const now = Date.now();
    set((s) => {
      if (s.phase !== PHASE.PLAYING) return {};
      const ch = {}; // only touched fields go back to Zustand

      // Rings — advance position + expire
      const dt      = deltaMs / 16.67;
      const updated = s.rings.map((r) => {
        const dir  = r.dir ?? 1;
        const newR = dir > 0
          ? r.radius + r.speed * dt
          : Math.max(0, r.radius - r.speed * dt);
        return { ...r, radius: newR, spawnOpacity: Math.min(1, (r.spawnOpacity ?? 1) + deltaMs / 300) };
      });
      const alive      = updated.filter((r) => (r.dir ?? 1) > 0 ? r.radius < r.maxRadius  : r.radius > 0);
      const cleanCount = updated.filter((r) => ((r.dir ?? 1) > 0 ? r.radius >= r.maxRadius : r.radius <= 0) && !r.wasHit).length;
      ch.rings = alive;
      if (cleanCount > 0) {
        ch.combo       = s.combo + cleanCount;
        ch.bestCombo   = Math.max(s.bestCombo, s.combo + cleanCount);
        ch.ringsDodged = s.ringsDodged + cleanCount;
      }

      // Survival time
      ch.survivalMs = s.survivalMs + deltaMs;

      // Flatline
      if (now - s.gameStartMs >= GRACE_PERIOD_MS) {
        const newAccum = s.flatlineAccumMs + deltaMs;
        if (newAccum >= FLATLINE_MS) {
          return { ...ch, deathCause: 'flatline', phase: PHASE.DYING };
        }
        ch.flatlineAccumMs = newAccum;
      }

      // Stroke (burned out)
      if (s.displayBpm > s.currentBpmHigh) {
        const newAccum = s.strokeAccumMs + deltaMs;
        if (newAccum >= STROKE_MS) {
          return { ...ch, deathCause: 'stroke', phase: PHASE.DYING };
        }
        ch.strokeAccumMs = newAccum;
      } else if (s.strokeAccumMs > 0) {
        ch.strokeAccumMs = 0;
      }

      // Difficulty escalation
      const newDiffAccum = s.difficultyAccumMs + deltaMs;
      if (newDiffAccum >= DIFFICULTY_INTERVAL_MS) {
        ch.currentBpmLow     = Math.min(MIN_RANGE_LOW,  s.currentBpmLow  + RANGE_NARROW_AMOUNT);
        ch.currentBpmHigh    = Math.max(MIN_RANGE_HIGH, s.currentBpmHigh - RANGE_NARROW_AMOUNT);
        ch.ringSpeedMult     = Math.min(2.5, s.ringSpeedMult + SPEED_MULT_INCREASE);
        ch.difficultyLevel   = s.difficultyLevel + 1;
        ch.difficultyAccumMs = newDiffAccum - DIFFICULTY_INTERVAL_MS;
      } else {
        ch.difficultyAccumMs = newDiffAccum;
      }

      // BPM decay toward resting
      if (now - s.lastTapMs >= BPM_DECAY_DELAY) {
        const decay  = (BPM_DECAY_RATE * deltaMs) / 1000;
        const newBpm = s.displayBpm > BPM_RESTING
          ? Math.max(BPM_RESTING, s.displayBpm - decay)
          : Math.min(BPM_RESTING, s.displayBpm + decay);
        const rounded = Math.round(newBpm);
        if (rounded !== s.displayBpm) {
          const zone  = getZoneForBpm(rounded);
          ch.displayBpm  = rounded;
          ch.zone        = zone;
          ch.accentColor = zone.color;
        }
      }

      // ECG history — sampled at ~5 Hz to avoid per-tap array spread in registerTap
      const curBpm = ch.displayBpm ?? s.displayBpm;
      const curMs  = ch.survivalMs ?? s.survivalMs;
      if (curMs - s.lastEcgMs >= 200) {
        const entry = { t: curMs, bpm: curBpm };
        ch.ecgHistory = s.ecgHistory.length < 300
          ? [...s.ecgHistory, entry]
          : [...s.ecgHistory.slice(1), entry];
        ch.lastEcgMs  = curMs;
        // Peak / lowest BPM
        if (curBpm > s.peakBpm)    ch.peakBpm   = curBpm;
        if (curBpm < s.lowestBpm)  ch.lowestBpm = curBpm;
      }

      return ch;
    });
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

    // Spawn origin off-screen with a safe-zone guarantee:
    // retry until the origin is far enough from the player that they have
    // meaningful reaction time. Safe distance scales up with ring speed.
    const EDGE_OFFSET  = 40;
    const MIN_DIST     = 200 + ringSpeedMult * 60; // ~260px at base, ~350px at max difficulty

    let originX = 0, originY = 0, attempts = 0;
    do {
      const edge = Math.floor(Math.random() * 4);
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
      attempts++;
    } while (attempts < 12 && Math.hypot(originX - playerX, originY - playerY) < MIN_DIST);

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
    lastEcgMs:         0,
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
