/**
 * Zone system: 5 zones mapped to BPM ranges.
 * Each zone has a unique accent color and score multiplier.
 *
 *   Surface  50–79    calm cyan
 *   Shallow  80–99    green
 *   Deep    100–119   amber
 *   Abyss   120–139   orange-red
 *   Void    140–160   magenta
 */

export const ZONES = [
  {
    id: 'surface',
    label: 'Surface',
    bpmMin: 50,
    bpmMax: 79,
    color: '#00E5FF',      // cyan
    scoreMultiplier: 1,
  },
  {
    id: 'shallow',
    label: 'Shallow',
    bpmMin: 80,
    bpmMax: 99,
    color: '#69FF47',      // green
    scoreMultiplier: 1.5,
  },
  {
    id: 'deep',
    label: 'Deep',
    bpmMin: 100,
    bpmMax: 119,
    color: '#FFD740',      // amber
    scoreMultiplier: 2.5,
  },
  {
    id: 'abyss',
    label: 'Abyss',
    bpmMin: 120,
    bpmMax: 139,
    color: '#FF6D00',      // orange-red
    scoreMultiplier: 4,
  },
  {
    id: 'void',
    label: 'Void',
    bpmMin: 140,
    bpmMax: 160,
    color: '#E040FB',      // magenta
    scoreMultiplier: 7,
  },
];

/**
 * Returns the Zone object for a given BPM value.
 * Clamps to outermost zones if bpm is out of range.
 */
export function getZoneForBpm(bpm) {
  for (const zone of ZONES) {
    if (bpm >= zone.bpmMin && bpm <= zone.bpmMax) return zone;
  }
  return bpm < ZONES[0].bpmMin ? ZONES[0] : ZONES[ZONES.length - 1];
}
