// src/activity/backgroundGpsTask.ts
// Registers the workout GPS background task. expo-task-manager requires the
// definition at the top level of a module loaded when the app (or a
// headless background launch) starts, so this file is imported once from
// app/_layout.tsx and has this single, deliberate side effect.
import * as TaskManager from 'expo-task-manager';
import { handleTaskBatch, WORKOUT_GPS_TASK } from './backgroundGps';

try {
  if (!TaskManager.isTaskDefined(WORKOUT_GPS_TASK)) {
    TaskManager.defineTask(WORKOUT_GPS_TASK, async ({ data, error }: TaskManager.TaskManagerTaskBody<any>) => {
      await handleTaskBatch((data as any)?.locations, error);
    });
  }
} catch {
  // Task manager unavailable (Expo Go, web): workouts use on-screen GPS only.
}
