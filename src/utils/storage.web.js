// Web stub — use localStorage instead of expo-file-system
const KEY = 'pulse_save';

export async function loadPersisted() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function savePersisted(data) {
  try {
    const existing = await loadPersisted();
    localStorage.setItem(KEY, JSON.stringify({ ...existing, ...data }));
  } catch {}
}
