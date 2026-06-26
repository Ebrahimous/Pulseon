import { db } from './firebase';
import {
  collection, addDoc, query, orderBy, limit, getDocs, serverTimestamp,
} from 'firebase/firestore';

const COLLECTION = 'leaderboard';

/**
 * Submit a score entry.
 * Returns true on success, false on failure (network, validation, etc.)
 */
export async function submitScore({ name, score, survivalMs, grade, zoneName, bestCombo }) {
  try {
    await addDoc(collection(db, COLLECTION), {
      name:       name.trim().toUpperCase().slice(0, 20),
      score:      Math.floor(score),
      survivalMs: Math.floor(survivalMs),
      grade,
      zoneName,
      bestCombo,
      timestamp:  serverTimestamp(),
    });
    return true;
  } catch (e) {
    console.warn('[leaderboard] submitScore failed:', e);
    return false;
  }
}

/**
 * Fetch top N scores ordered by score descending.
 * Returns an array of entries, or [] on failure.
 */
export async function fetchTopScores(n = 10) {
  try {
    const q    = query(collection(db, COLLECTION), orderBy('score', 'desc'), limit(n));
    const snap = await getDocs(q);
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (e) {
    console.warn('[leaderboard] fetchTopScores failed:', e);
    return [];
  }
}
