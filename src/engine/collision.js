/**
 * Collision Detection
 *
 * Strategy: each ring is a circle stroke. The player is a point.
 * Distance from player to ring edge = |dist(player, ringOrigin) - ringRadius|
 *
 * Zones:
 *   ≤ HIT_THRESHOLD     → player is dead (inside the stroke)
 *   ≤ NEAR_MISS_RANGE   → near-miss: nudge BPM up, trigger danger visual
 *   > NEAR_MISS_RANGE   → clean
 *
 * Called every animation frame from GameScreen's Reanimated worklet
 * (or from a JS-thread rAF loop — either works).
 */

export const HIT_THRESHOLD = 14;      // px — touching the ring stroke
export const NEAR_MISS_RANGE = 24;    // px — close enough to spike BPM

/**
 * Returns collision info for a single ring vs the player position.
 *
 * @param {object} ring   - { originX, originY, radius }
 * @param {number} px     - player X
 * @param {number} py     - player Y
 * @returns {{ hit: boolean, nearMiss: boolean, distance: number }}
 */
export function checkRingCollision(ring, px, py) {
  const dist = Math.hypot(px - ring.originX, py - ring.originY);
  const edgeDist = Math.abs(dist - ring.radius);

  return {
    hit: edgeDist <= HIT_THRESHOLD,
    nearMiss: edgeDist > HIT_THRESHOLD && edgeDist <= NEAR_MISS_RANGE,
    distance: edgeDist,
  };
}

/**
 * Runs collision detection across all rings.
 * Returns an aggregated result so the caller can react once.
 *
 * @param {object[]} rings
 * @param {number} px
 * @param {number} py
 * @returns {{ hit: boolean, nearMissIds: number[], cleanIds: number[] }}
 */
export function checkAllRings(rings, px, py) {
  let hit = false;
  let hitRingId = null;
  const nearMissIds = [];

  for (const ring of rings) {
    const result = checkRingCollision(ring, px, py);
    if (result.hit) {
      hit = true;
      hitRingId = ring.id;
      break;
    } else if (result.nearMiss) {
      nearMissIds.push(ring.id);
    }
  }

  return { hit, hitRingId, nearMissIds };
}
