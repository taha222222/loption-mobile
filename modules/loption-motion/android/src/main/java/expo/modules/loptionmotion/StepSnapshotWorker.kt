package expo.modules.loptionmotion

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

// Reads the step counter every ~15 minutes (Android's minimum for periodic
// work; the system may defer it in Doze or battery saver). WorkManager
// keeps the schedule across app restarts and device reboots. Readings stay
// on the device; nothing is uploaded from the background.
class StepSnapshotWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    if (!StepSnapshotStore.backgroundEnabled(applicationContext)) return Result.success()
    StepCounterReader.read(applicationContext, "background")?.let { StepSnapshotStore.append(applicationContext, it) }
    return Result.success()
  }

  companion object {
    private const val NAME = "loption-step-snapshots"

    fun schedule(context: Context) {
      val request = PeriodicWorkRequestBuilder<StepSnapshotWorker>(15, TimeUnit.MINUTES).build()
      WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    fun cancel(context: Context) {
      WorkManager.getInstance(context).cancelUniqueWork(NAME)
    }
  }
}
