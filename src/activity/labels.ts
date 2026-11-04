// src/activity/labels.ts
// Customer-facing labels (French, like the other V2 customer screens).
import type { ActivitySource, WorkoutKind, WorkoutSource } from './types';

export const KIND_LABEL: Record<WorkoutKind, string> = {
  walk: 'Marche',
  run: 'Course',
  cycle: 'Vélo',
  gym: 'Salle de sport',
};

// For narrow tiles (four in a row).
export const KIND_SHORT: Record<WorkoutKind, string> = {
  walk: 'Marche',
  run: 'Course',
  cycle: 'Vélo',
  gym: 'Salle',
};

export const KIND_ICON: Record<WorkoutKind, string> = {
  walk: 'walk-outline',
  run: 'flash-outline',
  cycle: 'bicycle-outline',
  gym: 'barbell-outline',
};

// Glyph of the L'OPTION icon set for each kind.
export const KIND_GLYPH: Record<WorkoutKind, 'walk' | 'run' | 'cycle' | 'gym'> = { walk: 'walk', run: 'run', cycle: 'cycle', gym: 'gym' };

// One short line under each workout tile.
export const KIND_HINT: Record<WorkoutKind, string> = {
  walk: 'Durée, distance et allure',
  run: 'Durée, distance et allure',
  cycle: 'Durée, distance et vitesse',
  gym: 'Exercices, séries et repos',
};

// What the customer picks on the workout screen. A hike is recorded as a walk
// (same server rules and walking energy estimate) and keeps its name on this
// phone only (DECISIONS #25).
export type ActivityChoice = 'walk' | 'run' | 'cycle' | 'hike' | 'gym';
export const ACTIVITY_CHOICES: {
  id: ActivityChoice;
  kind: WorkoutKind;
  label: string;
  glyph: 'walk' | 'run' | 'cycle' | 'hike' | 'gym';
  hint: string;
  outdoor: boolean;
}[] = [
  { id: 'walk', kind: 'walk', label: 'Marche', glyph: 'walk', hint: 'Carte, distance et allure', outdoor: true },
  { id: 'run', kind: 'run', label: 'Course', glyph: 'run', hint: 'Carte, distance et allure', outdoor: true },
  { id: 'cycle', kind: 'cycle', label: 'Vélo', glyph: 'cycle', hint: 'Carte, distance et vitesse', outdoor: true },
  { id: 'hike', kind: 'walk', label: 'Randonnée', glyph: 'hike', hint: 'Carte, distance et allure', outdoor: true },
  { id: 'gym', kind: 'gym', label: 'Salle de sport', glyph: 'gym', hint: 'Exercices, séries et repos', outdoor: false },
];
export const choiceOf = (kind: WorkoutKind, label?: 'hike' | null): ActivityChoice => (label === 'hike' && kind === 'walk' ? 'hike' : kind);
export const choiceLabel = (kind: WorkoutKind, label?: 'hike' | null): string => ACTIVITY_CHOICES.find((c) => c.id === choiceOf(kind, label))!.label;
export const choiceGlyph = (kind: WorkoutKind, label?: 'hike' | null) => ACTIVITY_CHOICES.find((c) => c.id === choiceOf(kind, label))!.glyph;

export const WORKOUT_SOURCE_LABEL: Record<WorkoutSource, string> = {
  app: 'L’OPTION',
  apple_health: 'Apple Santé',
  health_connect: 'Health Connect',
};

export const ACTIVITY_SOURCE_SHORT: Record<ActivitySource, string> = {
  apple_health: 'Apple Santé',
  health_connect: 'Health Connect',
  device_motion: 'Capteur du téléphone',
};

export function energyLabel(energySource: 'provider_measured' | 'met_estimate' | 'none', source: WorkoutSource): string {
  if (energySource === 'provider_measured') return `mesurée par ${WORKOUT_SOURCE_LABEL[source]}`;
  if (energySource === 'met_estimate') return 'estimation selon l’effort, le poids et la durée';
  return 'indisponible';
}
