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

export function createBpmEngine({ getStore, screenWidth, screenHeight, onBeat: onBeatCallback }) {
  let intervalId = null;
  let currentBpm = null;
  let beatCount = 0;

  function msPerBeat(bpm) {
    return 60_000 / bpm;
  }

  function onBeat() {
    const store = getStore();
    const { phase, displayBpm } = store;
    if (phase !== 'playing') return;

    beatCount++;

    // Spawn ring every N beats
    if (beatCount % spawnEveryN(displayBpm) === 0) {
      store.spawnRing(screenWidth, screenHeight);
    }

    // Reschedule if player BPM has shifted
    const latestBpm = getStore().displayBpm;
    if (Math.abs(latestBpm - currentBpm) >= BPM_RESCHEDULE_THRESHOLD) {
      reschedule(latestBpm);
    }
  }

  function reschedule(bpm) {
    stop();
    currentBpm = bpm;
    intervalId = setInterval(onBeat, msPerBeat(bpm));
  }

  function start() {
    beatCount = 0;
    const { displayBpm } = getStore();
    reschedule(displayBpm);
  }

  function stop() {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function updateBpm(newBpm) {
    if (currentBpm === null || Math.abs(newBpm - currentBpm) >= BPM_RESCHEDULE_THRESHOLD) {
      reschedule(newBpm);
    }
  }

  return { start, stop, updateBpm };
}
