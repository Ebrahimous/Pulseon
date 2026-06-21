/**
 * Heartbeat sound — singleton loader/player
 * Works on native (expo-av) and web (expo-av web adapter).
 */
import { Audio } from 'expo-av';

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
