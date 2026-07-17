/**
 * BPM Engine — ring spawner only
 *
 * BPM is now entirely player-controlled (tap-derived).
 * This engine just reads displayBpm from the store and
 * spawns rings at the appropriate rate.
 *
 * Spawn frequency by BPM:
 *   50  BPM → every 3 beats
 *   95  BPM → every 2 beats
 *   140+ BPM → every beat
 */

const BPM_RESCHEDULE_THRESHOLD = 2;

function spawnEveryN(bpm) {
  return Math.max(1, Math.ceil(3 - (bpm - 50) / 45));
}

const clampBpm = (b) => Math.min(200, Math.max(30, b));

// Phase-preserving scheduler: previously every BPM shift (≥2, which fires on
// nearly every tap) did clearInterval + a fresh setInterval, postponing the
// next beat by a full period. Sustained tapping restarted the interval
// constantly and starved ring spawns. A setTimeout chain that always derives
// its delay from the last beat's timestamp keeps beat phase continuous across
// tempo changes.
export function createBpmEngine({ getStore, getDims, onBeat: onBeatCallback }) {
  let timeoutId  = null;
  let lastBeatAt = 0;
  let currentBpm = null;
  let beatCount  = 0;

  function msPerBeat(bpm) {
    return 60_000 / bpm;
  }

  function scheduleNext() {
    const delay = Math.max(0, lastBeatAt + msPerBeat(clampBpm(currentBpm)) - Date.now());
    timeoutId = setTimeout(onBeat, delay);
  }

  function onBeat() {
    lastBeatAt = Date.now();
    const store = getStore();
    const { phase, displayBpm, score } = store;

    if (phase === 'playing') {
      beatCount++;

      // Progressive ring frequency: increases with score (caps at 3× base rate)
      const freqMult      = Math.min(3.0, 1.0 + score / 500);
      const beatsPerSpawn  = Math.max(1, Math.round(spawnEveryN(displayBpm) / freqMult));

      if (beatCount % beatsPerSpawn === 0) {
        const { width, height } = getDims();
        store.spawnRing(width, height);
      }
    }

    currentBpm = getStore().displayBpm; // pick up new tempo for the next beat
    scheduleNext();                     // always — engine.stop() is what ends the chain
  }

  function updateBpm(newBpm) {
    if (currentBpm !== null && Math.abs(newBpm - currentBpm) < BPM_RESCHEDULE_THRESHOLD) return;
    currentBpm = newBpm;
    clearTimeout(timeoutId);
    scheduleNext(); // delay re-derived from lastBeatAt → beat phase preserved
  }

  function start() {
    beatCount  = 0;
    currentBpm = getStore().displayBpm;
    lastBeatAt = Date.now();
    scheduleNext();
  }

  function stop() {
    clearTimeout(timeoutId);
    timeoutId = null;
  }

  return { start, stop, updateBpm };
}
