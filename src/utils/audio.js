/**
 * Audio — programmatic heartbeat sounds
 *
 * Generates two sine-wave WAV files (lub + dub), writes them to the
 * device cache once on init, then plays them on every tap.
 *
 * Setup:  npx expo install expo-av   (then restart Metro)
 */

import * as FileSystem from 'expo-file-system';
import { Audio } from 'expo-av';

// ── WAV generator ────────────────────────────────────────────────────────────

function buildSineWav(freq, durationMs, amplitude = 0.4, sampleRate = 22050) {
  const n   = Math.floor(sampleRate * durationMs / 1000);
  const buf = new ArrayBuffer(44 + n * 2);
  const v   = new DataView(buf);
  const cc  = (off, s) => [...s].forEach((c, i) => v.setUint8(off + i, c.charCodeAt(0)));

  cc(0, 'RIFF');  v.setUint32(4, 36 + n * 2, true);
  cc(8, 'WAVE');  cc(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);            // PCM
  v.setUint16(22, 1, true);            // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  cc(36, 'data'); v.setUint32(40, n * 2, true);

  for (let i = 0; i < n; i++) {
    const t   = i / sampleRate;
    const env = Math.min(1, t * 200) * Math.exp(-t * 18);
    v.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * freq * t) * amplitude * env * 32767), true);
  }
  return buf;
}

function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

// ── Module state ─────────────────────────────────────────────────────────────

let lubSound = null;
let dubSound = null;
let ready    = false;

// ── Public API ───────────────────────────────────────────────────────────────

export async function initAudio() {
  if (!Audio?.Sound) return; // expo-av not available
  try {
    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });

    const lubPath = FileSystem.cacheDirectory + 'pulse_lub.wav';
    const dubPath = FileSystem.cacheDirectory + 'pulse_dub.wav';

    await FileSystem.writeAsStringAsync(
      lubPath, bufToBase64(buildSineWav(100, 100, 0.45)),
      { encoding: FileSystem.EncodingType.Base64 },
    );
    await FileSystem.writeAsStringAsync(
      dubPath, bufToBase64(buildSineWav(72, 70, 0.30)),
      { encoding: FileSystem.EncodingType.Base64 },
    );

    const { sound: l } = await Audio.Sound.createAsync({ uri: lubPath });
    const { sound: d } = await Audio.Sound.createAsync({ uri: dubPath });
    lubSound = l;
    dubSound = d;
    ready    = true;
  } catch (e) {
    console.warn('[audio] init error', e);
  }
}

export async function playHeartbeat(zoneId) {
  if (!ready) return;
  try {
    const vol = zoneId === 'void'    ? 1.0
              : zoneId === 'abyss'   ? 0.85
              : zoneId === 'deep'    ? 0.70
              : zoneId === 'shallow' ? 0.55
              : 0.40;

    await lubSound.setVolumeAsync(vol);
    await lubSound.setPositionAsync(0);
    await lubSound.playAsync();

    setTimeout(async () => {
      try {
        await dubSound.setVolumeAsync(vol * 0.7);
        await dubSound.setPositionAsync(0);
        await dubSound.playAsync();
      } catch {}
    }, 120);
  } catch {}
}
