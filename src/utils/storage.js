import * as FileSystem from 'expo-file-system';

const PATH = FileSystem.documentDirectory + 'pulse_save.json';

export async function loadPersisted() {
  try {
    const json = await FileSystem.readAsStringAsync(PATH);
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export async function savePersisted(data) {
  try {
    await FileSystem.writeAsStringAsync(PATH, JSON.stringify(data));
  } catch (e) {
    console.warn('[storage] save failed', e);
  }
}
