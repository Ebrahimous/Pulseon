// Web haptics — uses navigator.vibrate() where available (Android Chrome).
// iOS Safari does not support vibrate; calls are silently ignored.
export const ImpactFeedbackStyle = {
  Light: 'Light', Medium: 'Medium', Heavy: 'Heavy',
};
export const NotificationFeedbackType = {
  Success: 'Success', Warning: 'Warning', Error: 'Error',
};

const vibe = (pattern) => {
  try { navigator?.vibrate?.(pattern); } catch {}
};

export const impactAsync = (style) => {
  switch (style) {
    case ImpactFeedbackStyle.Heavy:  vibe([30, 10, 30]); break;
    case ImpactFeedbackStyle.Medium: vibe(20);            break;
    default:                         vibe(10);            break;
  }
  return Promise.resolve();
};

export const notificationAsync = () => { vibe([15, 10, 15]); return Promise.resolve(); };
