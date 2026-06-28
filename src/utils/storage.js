import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';

const NATIVE_PATH = () => FileSystem.documentDirectory + 'pulse_save.json';
const WEB_KEY = 'pulse_save';

export async function loadPersisted() {
  if (Platform.OS === 'web') {
    try {
      const json = typeof localStorage !== 'undefined' && localStorage.getItem(WEB_KEY);
      return json ? JSON.parse(json) : {};
    } catch { return {}; }
  }
  try {
    const json = await FileSystem.readAsStringAsync(NATIVE_PATH());
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export async function savePersisted(data) {
  if (Platform.OS === 'web') {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(WEB_KEY, JSON.stringify(data));
      }
    } catch {}
    return;
  }
  try {
    await FileSystem.writeAsStringAsync(NATIVE_PATH(), JSON.stringify(data));
  } catch (e) {
    console.warn('[storage] save failed', e);
  }
}
