// src/navigation/notificationLinks.ts
// Maps the data of a tapped notification to an in-app route. Only known
// screens are allowed (never a URL taken from the payload). The route gates
// still apply: a signed-out user lands on the welcome screen and a staff
// account is sent to its own area.
const SCREENS = {
  nutrition: '/(app)/nutrition',
} as const;

export type NotificationRoute = (typeof SCREENS)[keyof typeof SCREENS];

export function notificationTarget(data: Record<string, unknown> | null | undefined): NotificationRoute | null {
  const screen = typeof data?.screen === 'string' ? data.screen : null;
  if (screen && Object.prototype.hasOwnProperty.call(SCREENS, screen)) {
    return SCREENS[screen as keyof typeof SCREENS];
  }
  return null;
}
