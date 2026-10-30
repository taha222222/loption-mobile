// src/services/workoutApi.ts
// Supabase calls for workouts. The server estimates the energy of an app
// workout (MET x weight x time) and refuses overlaps and implausible
// distances; uploads are idempotent (client_session_id / provider id).
import { supabase } from '../lib/supabase';
import type { FinishedSession } from '../activity/workoutSession';
import type { ImportedWorkout, WorkoutKind, WorkoutSource } from '../activity/types';
import type { Result } from './activityApi';
import { isTransient } from '../activity/sync';

export type EnergySource = 'provider_measured' | 'met_estimate' | 'none';

export interface WorkoutRecord {
  id: string;
  source: WorkoutSource;
  kind: WorkoutKind;
  startedAt: string;
  endedAt: string;
  activeSeconds: number;
  localDate: string;
  distanceM: number | null;
  distanceSource: 'gps' | 'provider' | null;
  energyKcal: number | null;
  energySource: EnergySource;
  met: number | null;
  duplicateOf: string | null;
}

export async function uploadAppWorkout(s: FinishedSession): Promise<Result<true>> {
  const { error } = await supabase.from('workout_sessions').upsert(
    {
      source: 'app',
      client_session_id: s.clientSessionId,
      kind: s.kind,
      started_at: s.startedAt,
      ended_at: s.endedAt,
      active_seconds: s.activeSeconds,
      time_zone: s.timeZone,
      distance_m: s.distanceM,
      distance_source: s.distanceM === null ? null : 'gps',
    },
    { onConflict: 'user_id,client_session_id', ignoreDuplicates: true }
  );
  if (error) return { data: null, error };
  return { data: true, error: null };
}

export async function importProviderWorkouts(
  workouts: ImportedWorkout[],
  source: WorkoutSource,
  timeZone: string
): Promise<Result<true>> {
  const rows = workouts
    .filter((w) => w.activeSeconds >= 60)
    .map((w) => ({
      source,
      external_id: w.externalId,
      kind: w.kind,
      started_at: w.startedAt,
      ended_at: w.endedAt,
      active_seconds: w.activeSeconds,
      time_zone: timeZone,
      distance_m: w.kind === 'gym' ? null : w.distanceM,
      distance_source: w.kind === 'gym' || w.distanceM === null ? null : 'provider',
      provider_energy_kcal: w.energyKcal,
    }));
  // One request per workout: a record the server refuses (e.g. an
  // implausible distance) is skipped without blocking the others; a
  // transport failure stops the import so the caller can retry it.
  for (const row of rows) {
    const { error } = await supabase
      .from('workout_sessions')
      .upsert(row, { onConflict: 'user_id,source,external_id', ignoreDuplicates: true });
    if (error && isTransient(error)) return { data: null, error };
  }
  return { data: true, error: null };
}

export async function deleteWorkout(id: string): Promise<Result<true>> {
  const { error } = await supabase.from('workout_sessions').delete().eq('id', id);
  if (error) return { data: null, error };
  return { data: true, error: null };
}

export async function deleteImportedWorkouts(source: WorkoutSource): Promise<Result<true>> {
  const { error } = await supabase.from('workout_sessions').delete().eq('source', source);
  if (error) return { data: null, error };
  return { data: true, error: null };
}

export function toWorkoutRecord(r: any): WorkoutRecord {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: r.id,
    source: r.source,
    kind: r.kind,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    activeSeconds: Number(r.active_seconds),
    localDate: String(r.local_date).slice(0, 10),
    distanceM: num(r.distance_m),
    distanceSource: r.distance_source ?? null,
    energyKcal: num(r.energy_kcal),
    energySource: r.energy_source ?? 'none',
    met: num(r.met),
    duplicateOf: r.duplicate_of ?? null,
  };
}

export async function fetchWorkouts(from: string, to: string): Promise<Result<WorkoutRecord[]>> {
  const { data, error } = await supabase.rpc('activity_workouts', { p_from: from, p_to: to });
  if (error) return { data: null, error };
  return { data: ((data as any[]) ?? []).map(toWorkoutRecord), error: null };
}

export function workoutErrorMessage(error: { code?: string; message?: string } | null | undefined): string {
  const msg = String(error?.message ?? '');
  if (/overlaps another session/i.test(msg)) return 'Une autre séance enregistrée couvre déjà ce moment.';
  if (/implausible distance/i.test(msg)) return 'La distance mesurée n’est pas plausible pour cette activité : elle n’a pas été enregistrée.';
  if (/last 30 days/i.test(msg)) return 'Cette séance est trop ancienne pour être enregistrée.';
  if (/unknown time zone/i.test(msg)) return 'Le fuseau horaire de l’appareil n’est pas reconnu.';
  return 'Séance non envoyée. Elle est gardée sur l’appareil et sera renvoyée automatiquement.';
}
