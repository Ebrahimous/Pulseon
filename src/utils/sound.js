/**
 * Heartbeat sound — singleton loader/player
 * Works on native (expo-av) and web (expo-av web adapter).
 *
 * Synthesised sounds (playFlatline, playHit) use Web Audio API on web;
 * they silently no-op on native where window is undefined.
 */
import { Audio } from 'expo-av';

// ── Web Audio helpers ─────────────────────────────────────────────────────────
// Singleton AudioContext: Chrome caps ~6 contexts per page, and each `new Ctx()`
// call was never closed — after a handful of near-misses every synth sound
// silently failed, including the death flatline. One shared, resumed context
// fixes that and lets `unlockAudio()` unlock it from a user gesture on iOS.
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

/** Call from a user-gesture handler (tap) to unlock/resume the shared AudioContext on iOS Safari. */
export function unlockAudio() {
  getCtx();
}

/** Continuous 1 kHz sine tone — played when the player dies (flatline). */
export function playFlatline() {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 1000;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.22, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.4);
    osc.start();
    osc.stop(ctx.currentTime + 1.4);
  } catch {}
}

/** Quick frequency sweep — played when a ring just barely misses the dot. */
export function playWhoosh() {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(640, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.18);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } catch {}
}

/** Short low sawtooth thud — played when a ring hits the dot. */
export function playHit() {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 160;
    osc.type = 'sawtooth';
    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
    osc.start();
    osc.stop(ctx.currentTime + 0.28);
  } catch {}
}

let _sound = null;
let _loading = false;

export async function loadHeartbeat() {
  if (_sound || _loading) return;
  _loading = true;
  try {
    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
    const { sound } = await Audio.Sound.createAsync(
      require('../../Assets/HeartBeat.wav'),
      { shouldPlay: false, volume: 1.0 }
    );
    _sound = sound;
  } catch (e) {
    // Silently fail — sound is non-critical
    console.warn('Heartbeat load failed:', e?.message ?? e);
  } finally {
    _loading = false;
  }
}

export async function playHeartbeat() {
  if (!_sound) return;
  try {
    await _sound.setPositionAsync(0);
    await _sound.playAsync();
  } catch {}
}

export function unloadHeartbeat() {
  if (_sound) {
    _sound.unloadAsync().catch(() => {});
    _sound = null;
  }
}
