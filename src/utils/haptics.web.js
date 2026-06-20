// Web stub — browsers have no haptic API, silently no-op
export const ImpactFeedbackStyle = {
  Light: 'Light', Medium: 'Medium', Heavy: 'Heavy',
};
export const NotificationFeedbackType = {
  Success: 'Success', Warning: 'Warning', Error: 'Error',
};
export const impactAsync    = () => Promise.resolve();
export const notificationAsync = () => Promise.resolve();
