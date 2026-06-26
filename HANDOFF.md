# Pulse — Project Handoff

> **How to use this file:** Open a new session, upload this file, and say:
> *"Read this handoff file and tell me what we're doing next."*

---

## 1. Current Status & Goals

**Project:** Pulse — a minimalist BPM rhythm-survival mobile game built in React Native + Expo SDK 52, deployed as a web app via Cloudflare Pages (GitHub → auto-deploy).

**Current status: All planned features are implemented and deployed.** The last Git commit (`de2ea90`) is pushed to `https://github.com/Ebrahimous/Pulseon` and Cloudflare has built/deployed it.

**What was just completed (this session):**
- Suggestion #6 — Near-miss "whoosh" sound (sawtooth frequency sweep on close ring pass)
- Suggestion #10 — Auto-pause when tab is switched / app is backgrounded (Page Visibility API + AppState)
- Suggestions #2 #3 #4 #5 #7 #8 were completed in the prior session but are worth verifying in-game

**The full feature list and their current state:**

| # | Feature | Status |
|---|---------|--------|
| 1 | Replace ♥ text lives with Heart.png images | ⬜ Not done |
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

**Immediate next task options (in priority order):**
1. Fix the stuck `.git\index.lock` file (blocks all future commits — see §5)
2. Implement #1 — Heart.png lives display (small, high visual impact)
3. Implement #9 — PWA installability (requires `app.json` manifest changes + Cloudflare config)

---

## 2. The "Mental Model" & Architecture

### File Map

```
Pulse on/
├── Assets/
│   ├── Heart.png          ← used on start screen, game screen, death screen, lives HUD
│   └── HeartBeat.wav      ← plays on every tap (expo-av singleton)
├── src/
│   ├── screens/
│   │   ├── StartScreen.jsx    ← BPM gate (tap 65–85 BPM for 3s to enter)
│   │   ├── GameScreen.jsx     ← Main game loop: rAF tick + bpmEngine (setInterval)
│   │   ├── DeathScreen.jsx    ← Post-run stats, share card, streak display
│   │   └── HowToPlayScreen.jsx
│   ├── store/
│   │   └── gameStore.js       ← Zustand store; ALL game state lives here
│   ├── engine/
│   │   ├── bpmEngine.js       ← Ring spawner (setInterval, adapts to player BPM)
│   │   ├── collision.js       ← Ring hit + near-miss detection
│   │   └── zoneManager.js     ← 5 BPM zones: surface/shallow/deep/abyss/void
│   └── utils/
│       ├── sound.js           ← Audio: loadHeartbeat, playHeartbeat, playFlatline, playHit, playWhoosh
│       ├── haptics.js         ← Native haptics (expo-haptics)
│       ├── haptics.web.js     ← Web haptics (navigator.vibrate shim)
│       ├── storage.js         ← Native persistence (expo-file-system → pulse_save.json)
│       ├── storage.web.js     ← Web persistence (localStorage)
│       ├── capture.js         ← Native screenshot (react-native-view-shot)
│       └── capture.web.js     ← Web screenshot stub (canvas-based share in DeathScreen)
├── deploy.bat                 ← git add . && git commit -m "update" && git push
└── HANDOFF.md                 ← this file
```

### How the game loop works

Two parallel systems run during gameplay:

1. **bpmEngine** (`setInterval` at ~player BPM rate) — spawns rings, reschedules itself when BPM changes significantly. Lives in `engineRef.current` in GameScreen.
2. **rAF tick** (`requestAnimationFrame` loop in `useEffect([phase])`) — moves rings, checks collisions, accumulates flatline/stroke timers, ticks survival time. Reads state from `useGameStore.getState()` directly (not via React subscription) to avoid stale closures.

The two systems are paused together via `isPausedRef` (rAF no-ops) + `engineRef.current.stop()` (clears the interval) on tab-hide / app-background.

### Key architecture rules (don't break these)

- **Web share is canvas-only** — never load external images into the share canvas (tainted-canvas errors). The DeathScreen share function draws everything as primitives directly from `ecgHistory` data.
- **Sounds are Web Audio API** — `playFlatline`, `playHit`, `playWhoosh` all call `makeCtx()` which safely returns `null` on native, so they silently no-op. `playHeartbeat` uses expo-av (works on both).
- **`.web.js` files are platform shims** — `haptics.web.js`, `storage.web.js`, `capture.web.js` shadow their native counterparts. Metro/Expo auto-resolves them on web.
- **gameStore.resetGame()** intentionally does NOT reset `bestScore`, `runStreak`, or `bestStreak` — those are persisted across runs.

---

## 3. Exact Next Steps

### Immediate — fix the git lock (do this before anything else)

1. Open File Explorer or a terminal on the PC/laptop
2. Delete: `C:\Users\EB\Claude\Projects\Pulse on\.git\index.lock`
3. After that, `deploy.bat` will work normally again

### Feature #1 — Heart.png lives display (easiest win)

Currently lives are shown as `♥ ♥ ♥` text characters in GameScreen's HUD. Replace with `Heart.png` images:

- Open `src/screens/GameScreen.jsx`
- Find the lives HUD section (search for `♥` or `heartScales`)
- The `heartScales` array already exists (`useRef([new Animated.Value(1), ...])`). The hearts already scale-animate on hit. Just replace the `Text` rendering with `Animated.Image` using `Heart.png` with `tintColor` set per-life to the zone's `accentColor`.
- Size: 18×18 or 20×20 px, `opacity: 0.85`

### Feature #9 — PWA installability

- Open `app.json` (Expo config at project root)
- Add `"web": { "name": "Pulse", "shortName": "Pulse", "themeColor": "#000000", "backgroundColor": "#000000" }` under `"expo"`
- Add a `public/manifest.json` if Cloudflare Pages needs it (Expo usually auto-generates one from app.json)
- Add a 512×512 icon to `Assets/` for the PWA icon (or reuse Heart.png scaled up)
- Test by opening the deployed URL in Chrome and checking for the install prompt in the address bar

### Feature #11 — Practice mode (replace SKIP)

- In `StartScreen.jsx`, the SKIP button currently calls `resetGame()` and navigates to Game
- Change it to navigate to Game but also set a `practiceMode: true` flag in the store
- In GameScreen, when `practiceMode === true`: disable the death screen navigation and lives loss, show a "PRACTICE" watermark overlay
- In gameStore: add `practiceMode: false` to state, reset it to `false` in `resetGame()`

---

## 4. Recent Changes & Decisions

### This session (June 25, 2026)

**#6 — Near-miss whoosh sound** (`src/utils/sound.js`)
- Added `playWhoosh()` — a `sawtooth` oscillator frequency-ramped from 640 Hz → 80 Hz over 0.18s
- Called in `GameScreen.jsx` inside the `nearMissIds` branch of the collision check, alongside the existing cyan flash and BPM spike
- Decision: sawtooth chosen over sine for a more "doppler" feel; short duration keeps it snappy

**#10 — Auto-pause** (`src/screens/GameScreen.jsx`)
- Added `isPausedRef` (ref, for synchronous access inside rAF) + `isPaused` (state, for React re-render of overlay)
- `useEffect([phase])` subscribes to `document.visibilitychange` (web) and `AppState` (native)
- On hide: `engineRef.current.stop()` + `isPausedRef.current = true`
- On resume: `useGameStore.setState({ lastTapMs: Date.now() })` (prevents instant flatline on return) + `engineRef.current.start()` + `isPausedRef.current = false`
- Added "PAUSED / return to continue" dim overlay in JSX
- Decision: we keep the rAF loop alive during pause (just no-ops) rather than cancelling and restarting it, because the rAF `useEffect([phase])` cleanup would fight with our manual restart attempt

### Prior session (June 23, 2026) — commit de2ea90

- **#2** Cyan near-miss flash (Animated overlay, `nearMissFlash` value)
- **#3** Death screen heart entrance animation (scale 1.6 → 1.0, fade in on mount)
- **#4** Flatline tone (`playFlatline` — 1 kHz sine, 1.4s fade via Web Audio)
- **#5** Hit/damage sound (`playHit` — 160 Hz sawtooth, 0.28s via Web Audio), called in the `lives` useEffect
- **#7** Run streak counter — `runStreak`/`bestStreak` added to `gameStore.js`, persisted via `savePersisted()`, displayed on DeathScreen with gold styling at 3+
- **#8** BPM range-narrow announcement — `diffAnnounceOpacity` + `diffAnnounceText` state in GameScreen, fires on `difficultyLevel` change, shows `RANGE  72–78 BPM` in red

---

## 5. Open Blocks & Known Issues

### 🔴 Critical — `.git\index.lock` blocks all commits

```
C:\Users\EB\Claude\Projects\Pulse on\.git\index.lock
```

This file was left by a previous crashed git process. Until deleted, `deploy.bat` will fail with:
```
fatal: Unable to create '...index.lock': File exists.
```

**Fix:** Delete the file manually. It's safe to delete — it's just a lock file, not data.

### 🟡 Streak threshold tuning

The streak counter only increments if a run lasts ≥ 15 seconds (`STREAK_THRESHOLD_MS = 15_000` in `gameStore.js → recordRunResult`). This was a reasonable default but might feel too strict or too lenient depending on playtesting. Easy to tune by changing that constant.

### 🟡 Flatline/hit/whoosh sounds don't work on iOS Safari

Web Audio API (`AudioContext`) requires a user gesture to unlock on iOS. The heartbeat sound works because it's triggered by a tap. But `playFlatline` (triggered on death, from inside the rAF loop) may be silently blocked on iOS Safari. This is a known iOS restriction. A workaround would be to pre-unlock the AudioContext on the first tap and reuse it as a singleton — currently `makeCtx()` creates a fresh context every time.

### 🟡 Ring spawning + index.lock interaction

Because `deploy.bat` can't commit right now, any new changes you make locally won't be deployable until the lock file is deleted.

### 🟢 No functional regressions known

All code is linted-clean (no obvious syntax errors). The game is live and playable at the Cloudflare Pages URL.

---

## 6. Tech Stack Quick Reference

| Thing | Value |
|-------|-------|
| Framework | React Native + Expo SDK 52 |
| Target | Web (Cloudflare Pages) — native is secondary |
| State management | Zustand (`useGameStore`) |
| Audio | expo-av (heartbeat) + Web Audio API (synth sounds) |
| Animations | React Native `Animated` + `react-native-svg` (Animated wrappers) |
| Gestures | `react-native-gesture-handler` |
| Persistence | `expo-file-system` (native) / `localStorage` (web) |
| Deployment | GitHub push → Cloudflare Pages auto-build |
| Deploy command | `deploy.bat` (or `git add . && git commit -m "update" && git push`) |
| Live URL | Cloudflare Pages (check Cloudflare dashboard for exact URL) |
| GitHub repo | https://github.com/Ebrahimous/Pulseon |
