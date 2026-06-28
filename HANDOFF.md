# Pulse — Project Handoff
_Last updated: 2026-06-28_

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

**Recently completed (June 28):**
- Zone `scoreMultiplier` now applied in scoring — higher BPM zones award more per tap
- `bestScore` now persists on web via `localStorage` fallback in `storage.js`
- Ring danger proximity visual — rings thicken and turn red as they close within 60px of player dot
- Difficulty countdown bar — thin accent-color strip at screen bottom fills over 30s then resets
- Death screen: new best glow — pulsing gold border + "NEW BEST — ENTER YOUR NAME" label on name input when player beats their high score
- Dead code removed: `tickRings` and `tickSurvival` from `gameStore.js`
- `DIFFICULTY_INTERVAL_MS` now exported from `gameStore.js`

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
│   │   ├── StartScreen.jsx        ← BPM gate; shows inline top-5 + RANKINGS button
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

## 4. Recent Changes & Decisions

### June 26, 2026 (session 2)

**Tap lag fix** (`gameStore.js`, `GameScreen.jsx`)
- `ecgHistory` / `peakBpm` / `lowestBpm` moved out of `registerTap` (was spreading a 300-item array on every tap) → now sampled in `tickAll` at ~5 Hz via `lastEcgMs` rate-limiter
- `setRipples` / `setFloats` in rAF tick now return the same array reference when nothing expired → eliminates 1–2 extra re-renders per frame while ripples are active
- Added `lastEcgMs: 0` to initial state and `resetGame()`

**`lowestBpm: 0` bug fixed** (`DeathScreen.jsx`)
- `lowestBpm` now destructured from the store and passed to `generateEcgSvg()` instead of hardcoded `0`

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

**StartScreen** — RANKINGS button (centered, `top: 76`); inline top-5 display in idle state

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

## 6. Future Ideas (parked)

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
| Persistence | `expo-file-system` (native) / `localStorage` (web, name only) |
| Database | Firebase Firestore (`pulseon-d9fee`) |
| Deployment | `deploy.bat` → GitHub push → Cloudflare Pages auto-build |
| GitHub repo | https://github.com/Ebrahimous/Pulseon |
| Firebase console | https://console.firebase.google.com → project `pulseon-d9fee` |
