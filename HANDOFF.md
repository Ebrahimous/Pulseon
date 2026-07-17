# Pulse — Project Handoff
_Last updated: 2026-07-16_

> **How to use this file:** Open a new session, upload this file, and say:
> *"Read this handoff file and tell me what we're doing next."*

---

## 1. Current Status & Goals

**Project:** Pulse — a minimalist BPM rhythm-survival mobile game in React Native + Expo SDK 52, deployed as a web app via Cloudflare Pages (GitHub → auto-deploy).

**Current status: Core game + online leaderboard fully implemented and deployed.**

**Full feature status:**

| # | Feature | Status |
|---|---------|--------|
| 1 | Replace ♥ text lives with Heart.png images | ⬜ Not done (still `Animated.Text` with `♥` glyph) |
| 2 | Near-miss visual flash (cyan overlay) | ✅ Done |
| 3 | Animate death screen heart on arrival | ✅ Done |
| 4 | Flatline tone on death | ✅ Done |
| 5 | Hit/damage sound on ring collision | ✅ Done |
| 6 | Near-miss "whoosh" sound | ✅ Done |
| 7 | Personal best streak counter | ✅ Done |
| 8 | BPM range-narrow announcement | ✅ Done |
| 9 | PWA installability (home screen icon) | ⬜ Not done |
| 10 | Auto-pause on tab switch | ✅ Done |
| 11 | Replace SKIP with practice mode | ⬜ Not done |
| 12 | Online Firebase leaderboard | ✅ Done |

**Immediate priority options:**
1. 🔴 Set Firestore security rules (currently open — do before sharing publicly)
2. Feature #1 — Heart.png lives (small change, high visual impact)
3. Feature #9 — PWA installability

---

## 2. The "Mental Model" & Architecture

### Navigation stack (`App.js`)

```
Start → Game → Death → (back to Start via resetGame)
           ↓
        HowToPlay
           ↓
        Leaderboard
```

Web gets an extra `WebFrame` wrapper that constrains the layout to a 390×844px phone frame centered on desktop.

### File Map

```
Pulse on/
├── Assets/
│   ├── Heart.png              ← used in GameScreen HUD (top-right pulse) + DeathScreen header
│   └── HeartBeat.wav          ← plays on every tap (expo-av singleton)
├── src/
│   ├── screens/
│   │   ├── StartScreen.jsx        ← BPM gate; RANKINGS button (navigates to LeaderboardScreen)
│   │   ├── GameScreen.jsx         ← Entire game: rAF loop + bpmEngine + all animations
│   │   ├── DeathScreen.jsx        ← Post-run stats, ECG waveform, leaderboard submit, share
│   │   ├── LeaderboardScreen.jsx  ← Full top-10 (rank, name, grade, time, score)
│   │   └── HowToPlayScreen.jsx    ← Static rules
│   ├── store/
│   │   └── gameStore.js           ← Zustand; ALL game state + tickAll (single-set game tick)
│   ├── engine/
│   │   ├── bpmEngine.js           ← Ring spawner (setInterval, adapts to player BPM)
│   │   ├── collision.js           ← checkAllRings, checkRingCollision
│   │   └── zoneManager.js         ← ZONES array (5 zones) + getZoneForBpm()
│   └── utils/
│       ├── firebase.js            ← Firebase init + Firestore export (`db`)
│       ├── leaderboard.js         ← submitScore(), fetchTopScores(n)
│       ├── storage.js             ← loadPersisted / savePersisted (expo-file-system, native only)
│       ├── sound.js               ← loadHeartbeat, playHeartbeat, playFlatline, playHit, playWhoosh
│       ├── haptics.js             ← re-exports expo-haptics (native only; web shim assumed)
│       ├── capture.js             ← re-exports captureRef from react-native-view-shot
│       └── ecgRenderer.js         ← generateEcgSvg() — PQRST waveform SVG string
├── App.js
├── deploy.bat                 ← One-click deploy to Cloudflare (reliable)
└── HANDOFF.md
```

### State: `gameStore.js` (Zustand)

All game state in one store. Key fields:

| Field | Type | Notes |
|-------|------|-------|
| `phase` | string | `start \| playing \| dying \| dead` |
| `displayBpm` | number | Tap-derived, smoothed (0.5), decays to 75 when idle |
| `rings[]` | array | `{ id, originX, originY, radius, speed, maxRadius, dir, type, wasHit, spawnOpacity }` |
| `lives` | number | 3 hearts; `markRingHit()` decrements; 0 → arrest death |
| `flatlineAccumMs` | number | Accumulates when no tap; death at 3200ms |
| `strokeAccumMs` | number | Accumulates when BPM > `currentBpmHigh`; death at 5000ms |
| `currentBpmLow/High` | number | Safe window; starts 65–85, narrows every 30s |
| `ringSpeedMult` | number | Starts 1.0, increases by 0.15 per difficulty tick, caps at 2.5 |
| `score / combo / bestScore / bestCombo` | number | `bestScore` persists via storage; NOT reset on `resetGame()` |
| `ecgHistory[]` | array | `{ t, bpm }`, capped at 300 entries, sampled at ~5 Hz in `tickAll`, used by ECG renderer |
| `lastEcgMs` | number | Timestamp of last ECG sample (rate-limiter for ecgHistory) |
| `runStreak / bestStreak` | number | Persisted; qualified runs are ≥15s |

**`tickAll(deltaMs)`** — single `set()` call per frame batching: rings advance + expiry + combo award, survival time, flatline check, stroke check, difficulty escalation, BPM decay, ECG history sampling. One Zustand notification = one React re-render per frame.

**`resetGame()`** intentionally does NOT reset `bestScore`, `runStreak`, `bestStreak`.

### Ring types

| Type | `dir` | Speed multiplier | Color | Notes |
|------|-------|-----------------|-------|-------|
| `normal` | +1 (outward) | 1.0× | zone `accentColor` | Standard |
| `fast` | +1 (outward) | 2.2× | `#FF6B6B` (red) | Smaller max radius |
| `inward` | -1 (shrinking) | 0.75× | `#FFB347` (orange) | Starts at maxRadius, dashed stroke |

Weighted spawn: 60% normal / 25% fast / 15% inward.

Spawn origin is guaranteed to be ≥ `200 + ringSpeedMult * 60` px from the player (up to 12 retry attempts).

Rings fade in over 300ms via `spawnOpacity` (0→1).

### Zones (BPM → accent color)

| Zone | BPM | Color | Score multiplier |
|------|-----|-------|-----------------|
| Surface | 50–79 | `#00E5FF` cyan | ×1 |
| Shallow | 80–99 | `#69FF47` green | ×1.5 |
| Deep | 100–119 | `#FFD740` amber | ×2.5 |
| Abyss | 120–139 | `#FF6D00` orange | ×4 |
| Void | 140–160 | `#E040FB` magenta | ×7 |

### Two parallel systems in GameScreen

1. **`bpmEngine`** (setInterval at player's BPM) — spawns rings; reschedules when BPM shifts ≥2. Ref: `engineRef.current`. Progressive frequency: `freqMult = min(3.0, 1 + score/500)`.
2. **rAF tick** (requestAnimationFrame loop) — calls `tickAll`, cleans ripples/floats (only re-renders when a ripple actually expires — same ref returned otherwise), runs collision, checks phase. Paused via `isPausedRef` (no-ops rAF) + `engineRef.current.stop()` on tab-hide/app-background.

### Collision (`collision.js`)

- `HIT_THRESHOLD = 14px` — edge distance for a hit
- `NEAR_MISS_RANGE = 24px` — edge distance for near-miss adrenaline spike
- Hit → `markRingHit(id)` → lose life; if lives=0 → arrest death
- Near miss → `applyNearMissScare()` (+5–7 BPM spike) + `playWhoosh()` + cyan flash overlay

Hit invincibility: `HIT_INVINCIBILITY_MS = 1000ms` (prevents multi-hit cascades).

### Firebase / Leaderboard

- **Project:** `pulseon-d9fee` (Firestore)
- **Collection:** `leaderboard`
- **Fields:** `name, score, survivalMs, grade, zoneName, bestCombo, timestamp`
- `submitScore()` — called from DeathScreen; player name persisted to `localStorage` (web) for pre-fill
- `fetchTopScores(n)` — called on StartScreen mount (top 5) and LeaderboardScreen mount (top 10)
- Both functions wrapped in try/catch; silently degrade on network failure

**🔴 Security rules NOT yet set.** Database is in test mode. Rules to apply:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /leaderboard/{entry} {
      allow read: true;
      allow create: if request.resource.data.score is number
                    && request.resource.data.score > 0
                    && request.resource.data.name is string
                    && request.resource.data.name.size() > 0
                    && request.resource.data.name.size() <= 20;
    }
  }
}
```

Apply at: console.firebase.google.com → pulseon-d9fee → Firestore → Rules

### ECG waveform (`ecgRenderer.js`)

`generateEcgSvg({ ecgHistory, score, deathCause, zoneName, peakBpm, lowestBpm, survivalMs })` — outputs an SVG string of proper PQRST complexes built from tap timestamps. Used by DeathScreen via `<SvgXml>`. For `arrest` death, replaces the tail with a V-fib pattern.

---

## 3. Exact Next Steps

**1. 🔴 Set Firestore security rules**
- Log in to Firebase Console, paste the rules from §2 above → Publish
- Do this before sharing the game URL with anyone

**2. Feature #1 — Replace ♥ text lives with Heart.png**
- In `GameScreen.jsx`, find the `livesRow` View (search for `livesRow` or `♥`)
- Replace `Animated.Text` with `Animated.Image` for each heart slot:
  ```jsx
  <Animated.Image
    key={i}
    source={require('../../Assets/Heart.png')}
    style={{
      width: 18, height: 18,
      tintColor: i < lives ? '#FF1744' : '#1e1e1e',
      transform: [{ scale: heartScales[i] }],
    }}
    resizeMode="contain"
  />
  ```
- The `heartScales` animations already work — no logic changes needed

**3. Feature #9 — PWA installability**
- In `app.json`, under `"expo"`, add: `"web": { "name": "Pulse", "shortName": "Pulse", "themeColor": "#050810", "backgroundColor": "#050810" }`
- Expo auto-generates the manifest on `expo export --platform web`
- Test in Chrome: deployed URL → address bar install icon

**4. Feature #11 — Practice mode (replace SKIP)**
- Add `practiceMode: false` to gameStore initial state; reset in `resetGame()`
- SKIP button sets `practiceMode: true` before navigating to Game
- In GameScreen: when `practiceMode === true`, disable death navigation + life loss, add "PRACTICE" watermark

---

## 3.5 Bug-Fix Spec — code review 2026-07-16

Nine issues from a full code review (store, engines, screens, utils). Fix order: **1–4 gameplay-critical, 5–8 polish, 9 batch of minors.** Each entry: location → fix → edge cases → acceptance checks. Remember the project editing rule: Python `content.replace(old, new, 1)` with `assert old in content` — no raw Edit/Write for these.

---

### FIX 1 — AudioContext leak kills all synth sounds mid-run 🔴

**Files:** `src/utils/sound.js` (`makeCtx`, `playFlatline`, `playWhoosh`, `playHit`), `src/screens/StartScreen.jsx` (`handleTap`), `src/screens/GameScreen.jsx` (`tapGesture.onBegin`)

**Problem:** `makeCtx()` creates a **new** `AudioContext` per sound call and never closes it. Chrome caps ~6 contexts per page → after a few near-misses every synth sound silently fails, including the death flatline. Also the root cause of the known iOS-Safari issue (§5): the flatline ctx is created outside a user gesture.

**Fix:**
1. Replace `makeCtx()` with a module-level singleton:
   ```js
   let _ctx = null;
   function getCtx() {
     if (typeof window === 'undefined') return null;
     if (!_ctx) {
       try {
         const Ctx = window.AudioContext || window.webkitAudioContext;
         _ctx = Ctx ? new Ctx() : null;
       } catch { _ctx = null; }
     }
     if (_ctx && _ctx.state !== 'running') _ctx.resume().catch(() => {});
     return _ctx;
   }
   export function unlockAudio() { getCtx(); }
   ```
2. `playFlatline` / `playWhoosh` / `playHit`: `const ctx = getCtx();` — never call `ctx.close()`.
3. Call `unlockAudio()` at the top of StartScreen `handleTap` and GameScreen `tapGesture.onBegin` (both are user gestures → unlocks iOS).

**Edge cases:**
- `window` undefined (native) → `getCtx()` returns null, synths no-op (current behavior preserved).
- iOS `state === 'interrupted'` (call/Siri) → the `resume()` in `getCtx` covers it. `resume()` returns a promise — swallow rejection, do **not** await it before playing; scheduling nodes on a resuming ctx is fine.
- Multiple simultaneous sounds share the ctx — safe, oscillator/gain nodes are per-call.

**Acceptance:**
1. Chrome: trigger 10+ near-misses in one run → whoosh audible on every one (pre-fix it dies after ~6).
2. Die after a sound-heavy run → flatline tone audible.
3. Temp `console.count('ctx-created')` next to `new Ctx()` → exactly 1 per page load.
4. iOS Safari: tap StartScreen once, then near-miss + death → both sounds audible.

---

### FIX 2 — Inward ring can hit invisibly on its first frame 🔴

**File:** `src/store/gameStore.js` (`spawnRing`)

**Problem:** the retry loop only enforces `dist(origin, player) >= MIN_DIST`. Inward rings spawn at `radius = maxRadius` (~558 px on 390×844), so a player sitting ~558 px from the origin is standing **on the ring edge at spawn** — while `spawnOpacity` is still 0. Invisible, unavoidable hit.

**Fix:** compute `dist` inside the loop and extend the retry condition for inward rings:
```js
let dist = 0;
do {
  // ...existing edge-pick switch...
  dist = Math.hypot(originX - playerX, originY - playerY);
  attempts++;
} while (
  attempts < 12 &&
  (dist < MIN_DIST || (dir === -1 && Math.abs(dist - startRadius) < 60))
);
// After the loop: if dir === -1 and still unsafe, skip the spawn entirely:
if (dir === -1 && Math.abs(dist - startRadius) < 60) return;
```
A silently skipped spawn is invisible to the player; an unfair hit is not.

**Edge cases:**
- The unsafe annulus is a thin ~120 px band ~558 px from origin — retries almost always succeed; the skip path is rare.
- Do **not** apply the annulus check to outward rings (`startRadius` 0 — `MIN_DIST` already covers them).
- `playerX/playerY` can be a frame stale — the 60 px margin absorbs it (`HIT_THRESHOLD` is 14).

**Acceptance:**
1. Temp test: force `type = 'inward'`, player at center, call `spawnRing` 500× → every spawned ring satisfies `Math.abs(dist − startRadius) >= 60`.
2. Playtest 5 runs → never lose a life in the same instant an orange ring appears.

---

### FIX 3 — Resume after pause doesn't reset the flatline timer 🔴

**File:** `src/screens/GameScreen.jsx` (`doResume` inside the pause effect)

**Problem:** the comment says resetting `lastTapMs` protects against flatline — but `lastTapMs` only gates BPM decay. Flatline runs on `flatlineAccumMs`, which survives the pause. Pause with 3000 ms accumulated → ~200 ms to live on return.

**Fix:**
```js
useGameStore.setState({ lastTapMs: Date.now(), flatlineAccumMs: 0, strokeAccumMs: 0 });
```
Update the comment to match. Do **NOT** reset `gameStartMs` (grace period must not re-arm).

**Edge cases:**
- On web, react-native-web's `AppState` can fire alongside `visibilitychange` → `doResume` may run twice; guarded by `isPausedRef` and the double `setState` is idempotent — no change needed.
- Resetting `strokeAccumMs` too is deliberate: BPM decay was frozen during pause, so the player resumes still above range with zero time to react otherwise.

**Acceptance:**
1. Stop tapping ~2.5 s → switch tab → return → keep not tapping → death arrives ~3.2 s after return (not instantly); KEEP TAPPING warning absent for the first ~1.8 s.
2. Hold BPM above range ~4 s → tab away → return → STROKE RISK restarts from 0 (full 5 s to death).

---

### FIX 4 — Ring-spawn starvation from interval rescheduling 🔴

**Files:** `src/engine/bpmEngine.js` (scheduling core), `src/screens/GameScreen.jsx` (`updateBpm` effect — unchanged, but now safe)

**Problem:** `reschedule()` = `clearInterval` + fresh `setInterval` → next beat postponed by a **full** period. It fires from the `updateBpm` effect on nearly every tap (BPM jitter ≥2) **and** again inside `onBeat`. Sustained tapping = interval restarts constantly = rings starve.

**Fix — phase-preserving setTimeout chain:**
```js
let timeoutId = null, lastBeatAt = 0, currentBpm = null, beatCount = 0;

const clampBpm = (b) => Math.min(200, Math.max(30, b));

function scheduleNext() {
  const delay = Math.max(0, lastBeatAt + msPerBeat(clampBpm(currentBpm)) - Date.now());
  timeoutId = setTimeout(onBeat, delay);
}

function onBeat() {
  lastBeatAt = Date.now();
  const store = getStore();
  if (store.phase === 'playing') {
    beatCount++;
    // ...existing freqMult + spawnRing logic, DELETE the reschedule block...
  }
  currentBpm = getStore().displayBpm;  // pick up new tempo for the next beat
  scheduleNext();                      // always — engine.stop() is what ends the chain
}

function updateBpm(newBpm) {
  if (currentBpm !== null && Math.abs(newBpm - currentBpm) < BPM_RESCHEDULE_THRESHOLD) return;
  currentBpm = newBpm;
  clearTimeout(timeoutId);
  scheduleNext();  // delay re-derived from lastBeatAt → beat phase preserved
}

function start() {
  beatCount = 0;
  currentBpm = getStore().displayBpm;
  lastBeatAt = Date.now();
  scheduleNext();
}

function stop() { clearTimeout(timeoutId); timeoutId = null; }
```
Delete `reschedule()` and the reschedule check at the end of the old `onBeat`. Keep bpmEngine and the rAF tick separate as before — this changes only the engine's internal clock.

**Edge cases:**
- `phase !== 'playing'`: still call `scheduleNext()` (chain must survive the 1-frame gap before `engineRef.current.stop()` runs on death/pause), just skip spawning.
- `delay = 0` (BPM jumped up mid-beat) → one immediate beat, correct.
- Resume after pause calls `start()` → `lastBeatAt = now` → no burst of catch-up beats.
- Clamp BPM 30–200 before `msPerBeat` (guards ÷ weirdness).

**Acceptance:**
1. Temp `console.log(Date.now())` in `onBeat`; tap with natural jitter at ~100 BPM for 30 s → intervals ≈600 ms, max gap < 1.5× period (pre-fix: multi-second gaps).
2. Rings keep spawning during a BPM ramp 75 → 130.
3. Pause → resume → no beat burst, next spawn within ~1 period.

---

### FIX 5 — Stroke vignette uses stale 3000 ms constant 🟡

**Files:** `src/store/gameStore.js` (add `export` to `STROKE_MS`, `FLATLINE_MS`), `src/screens/GameScreen.jsx` (vignette derivation)

**Problem:** `vignetteOpacity` divides by literal `3000`, but `STROKE_MS` is 5000 → the ramp maxes out at 3 s and computes >1.0 for the last 2 s. The flatline branch hardcodes `3200`.

**Fix:**
```js
const vignetteOpacity = strokeWarn
  ? Math.min(0.8, 0.25 + (strokeAccumMs / STROKE_MS) * 0.55)
  : flatlineWarn
    ? 0.2 + ((flatlineAccumMs - FLATLINE_WARN_MS) / (FLATLINE_MS - FLATLINE_WARN_MS)) * 0.5
    : 0.25;
```

**Acceptance:** vignette ramps continuously for the full 5 s to stroke death (no plateau at 3 s); `grep -n "3000\|3200" src/screens/GameScreen.jsx` → no timing literals remain.

---

### FIX 6 — BPM graph line vanishes above 120 BPM 🟡

**File:** `src/screens/GameScreen.jsx` (`GRAPH_BPM_MAX`, `bpmToY`)

**Problem:** graph scale is 40–120, zones go to 160. In Deep/Abyss/Void the polyline extrapolates above the strip and disappears — exactly when feedback matters most.

**Fix:** `GRAPH_BPM_MAX = 170`, and clamp: `const norm = Math.min(1, Math.max(0, (bpm - GRAPH_BPM_MIN) / (GRAPH_BPM_MAX - GRAPH_BPM_MIN)));`

**Edge cases:** the safe band (65–85) gets visually thinner on the wider scale — acceptable; the band Rect and both green Lines derive from `bpmToY` so they stay self-consistent.

**Acceptance:** push into Void (140+) → line visible inside the strip; BPM near 40 → clamped at bottom edge, not clipped away.

---

### FIX 7 — Best score not persisted when quitting via back arrow 🟡

**File:** `src/screens/GameScreen.jsx` (back-button `onPress`)

**Problem:** `savePersisted` only runs on the death path. Beat your best → quit with ← → close tab = new best lost.

**Fix:**
```js
onPress={() => {
  engineRef.current?.stop();
  const s = useGameStore.getState();
  savePersisted({ bestScore: s.bestScore, ...s.getStreakData() }).catch(() => {});
  s.resetGame();
  navigation.replace('Start');
}}
```
Deliberately do **NOT** call `recordRunResult` — an abandoned run neither extends nor breaks the streak.

**Edge cases:** fire-and-forget is safe — web `localStorage` is synchronous; a native file write completing after unmount is harmless.

**Acceptance:** beat best → quit via ← → hard-reload → BEST label shows the new value and `localStorage.pulse_save` contains it. Quit a 20 s run mid-streak → `runStreak` unchanged.

---

### FIX 8 — Mid-run resize/rotation resets run timers 🟡

**Files:** `src/screens/GameScreen.jsx` (engine effect), `src/engine/bpmEngine.js` (signature)

**Problem:** the engine effect deps are `[width, height]` — any container resize (rotation, mobile URL-bar collapse) recreates the engine **and re-runs `startGame()`**, resetting `gameStartMs`/grace/flatline mid-run.

**Fix:** dims via ref, engine created once:
```js
const dimsRef = useRef({ width, height });
useEffect(() => { dimsRef.current = { width, height }; }, [width, height]);

useEffect(() => {
  const engine = createBpmEngine({
    getStore: useGameStore.getState,
    getDims:  () => dimsRef.current,
  });
  engineRef.current = engine;
  engine.start();
  startGame();
  return () => engine.stop();
}, []);  // mount-once
```
In `bpmEngine.onBeat`: `const { width, height } = getDims(); store.spawnRing(width, height);` (replace the `screenWidth/screenHeight` params).

**Edge cases:** first layout pass may briefly use `winW/winH` before `onLayout` resolves — same as today, harmless. The player-recenter effect on `[width, height]` may stay; optionally guard with `if (useGameStore.getState().survivalMs === 0)` to avoid teleporting mid-run.

**Acceptance:** start a run, resize the browser window repeatedly → temp-log shows `gameStartMs` unchanged; spawn cadence doesn't double (no second engine); stop tapping right after a resize → flatline fires on the original schedule (grace didn't re-arm).

---

### FIX 9 — Minor batch 🟢

1. **`src/screens/DeathScreen.jsx`** — `svgString` `useMemo` dep array is missing `lowestBpm`. Add it. *Acceptance:* exhaustive-deps lint quiet on that line.
2. **`src/engine/collision.js`** — `checkAllRings` should skip already-hit rings: `if (ring.wasHit) continue;`. Prevents a slow ring from hitting again after the 1 s invincibility lapses, and stops whoosh spam from a ring that already cost a life. *Acceptance:* stand still in an inward ring's path → exactly one life lost per ring.
3. **🔴 Firestore security rules (§2)** — unchanged, still the pre-share blocker. Console task, not code.

---

## 4. Recent Changes & Decisions

### June 28, 2026

**Tap lag fix** (`gameStore.js`, `GameScreen.jsx`)
- `ecgHistory` / `peakBpm` / `lowestBpm` moved out of `registerTap` (was spreading a 300-item array on every tap) → now sampled in `tickAll` at ~5 Hz via `lastEcgMs` rate-limiter
- `setRipples` / `setFloats` in rAF tick now return the same array reference when nothing expired → eliminates 1–2 extra re-renders per frame while ripples are active
- Added `lastEcgMs: 0` to initial state and `resetGame()`

**`lowestBpm: 0` bug fixed** (`DeathScreen.jsx`)
- `lowestBpm` now destructured from the store and passed to `generateEcgSvg()` instead of hardcoded `0`

**Scoring: zone multiplier applied** (`gameStore.js`)
- Each tap now awards `combo × zone.scoreMultiplier` — higher BPM zones score more per tap

**Web persistence fixed** (`storage.js`)
- `bestScore`, `runStreak`, `bestStreak` now persist on web via `localStorage` fallback (previously silently no-opped on web)

**Ring danger proximity visual** (`GameScreen.jsx`)
- Rings thicken stroke width and shift toward red as they close within 60px of the player dot

**Difficulty countdown bar** (`GameScreen.jsx`)
- Thin accent-color strip at screen bottom fills over 30s (one difficulty tick) then resets

**Death screen: new best glow** (`DeathScreen.jsx`)
- Pulsing gold border + "NEW BEST — ENTER YOUR NAME" prompt on the name input when player beats their high score

**Dead code removed** (`gameStore.js`)
- `tickRings` and `tickSurvival` functions deleted (superseded by `tickAll`)
- `DIFFICULTY_INTERVAL_MS` exported from `gameStore.js` for use in GameScreen countdown bar

### June 26, 2026 (session 1)

**Firebase leaderboard** (`firebase.js`, `leaderboard.js`)
- Firebase v12 modular SDK (`firebase/app`, `firebase/firestore`)
- `submitScore()` writes to `leaderboard` collection; `fetchTopScores(n)` queries score desc

**DeathScreen submit UI** (`DeathScreen.jsx`)
- TextInput for name (max 20 chars, auto-caps, localStorage pre-fill on web)
- SUBMIT → `submitScore()` → "POSTED TO LEADERBOARD ✓"
- State machine: `idle | submitting | done | error` (RETRY on error)

**LeaderboardScreen** (new screen, added to App.js as `"Leaderboard"`)
- Table: rank, name, grade (color-coded), time, score; REFRESH button; top-3 special styling

**StartScreen** — RANKINGS button navigates to LeaderboardScreen; inline top-5 removed (was cluttering the start screen)

**deploy.bat reliability fixes**
- `git config --global gc.auto 0` — suppresses GC (persists globally)
- `git status > nul` before `git add -A` — forces index refresh
- `--allow-empty` commit — Cloudflare always rebuilds
- `echo n | git push` — auto-dismisses Windows pack unlink prompt

### June 25, 2026

- 7 visual polish passes: dark navy `#050810`, vivid red heart `#E53935`, zone color tint, green in-range edge glow, gold combo milestone flash, renamed death causes, updated taglines
- Back buttons on StartScreen (while tapping) and GameScreen (quit to Start)
- Heart image repositioned: `top: 4, right: 20`, 100×100px, tintColor `#E53935`
- **`tickAll()` optimization** — 6 Zustand `set()` calls → 1 per frame (≈6× fewer re-renders)
- `STROKE_MS` increased 3000ms → 5000ms (more forgiving overshoot recovery)
- `ecgHistory` capped at 300 entries
- Inward ring type (`dir: -1`), safe-zone spawn guarantee, `spawnOpacity` fade-in

### June 23, 2026

- Features #2–#8, #10 implemented: near-miss flash, death screen heart animation, flatline sound, hit sound, whoosh sound, run streak, BPM range announcement, auto-pause

---

## 5. Open Blocks & Known Issues

**🔴 Firestore security rules not set** — database is open write. Apply rules from §2 before going public.

**🟡 Flatline/whoosh sounds may be blocked on iOS Safari** — Web Audio API requires a user-gesture-unlocked AudioContext. `playFlatline` fires on death inside rAF, not directly from a tap. Workaround: unlock a shared `AudioContext` singleton on the first tap event, then reuse it in all synth sound functions.

**🟢 `storage.js` web persistence** — ✅ Fixed. `localStorage` fallback added for web; `bestScore`, `runStreak`, `bestStreak` now persist on web.

**🟢 `tickRings` / `tickSurvival` dead code** — ✅ Removed.

**🟢 No score deduplication in Firestore** — Players can submit multiple times; each creates a new document. Low priority unless spam becomes a problem.

**🟢 No known functional regressions.** Game is live and playable.

---

## 7. Future Ideas (parked)

**Multiplayer shadow mode** — Two players tap simultaneously on the same device; two BPM lines (different colors) on the live ECG graph, shared ring field. No backend needed — second tap tracker is a `useRef` alongside the existing one.

---

## 6. Tech Stack Quick Reference

| Thing | Value |
|-------|-------|
| Framework | React Native + Expo SDK 52 |
| Primary target | Web (Cloudflare Pages) — native is secondary |
| State management | Zustand (`useGameStore`) |
| Audio | expo-av (heartbeat WAV) + Web Audio API (synth: flatline, hit, whoosh) |
| Animations | React Native `Animated` + `react-native-svg` |
| Gestures | `react-native-gesture-handler` (Gesture.Pan) |
| Persistence | `expo-file-system` (native) / `localStorage` (web — bestScore, runStreak, bestStreak, player name) |
| Database | Firebase Firestore (`pulseon-d9fee`) |
| Deployment | `deploy.bat` → GitHub push → Cloudflare Pages auto-build |
| GitHub repo | https://github.com/Ebrahimous/Pulseon |
| Firebase console | https://console.firebase.google.com → project `pulseon-d9fee` |
