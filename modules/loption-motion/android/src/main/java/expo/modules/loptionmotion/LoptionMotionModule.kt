package expo.modules.loptionmotion

import android.Manifest
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.content.Context
import android.os.Build
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

// L'OPTION phone motion (Android): the hardware step counter
// (Sensor.TYPE_STEP_COUNTER), which counts in a low-power coprocessor while
// the app is closed. Android keeps no history, so the app keeps readings
// (snapshots) on the device: when it is opened, while a screen listens, and
// every ~15 minutes in the background once the customer enabled it.
class LoptionMotionModule : Module() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private var liveListener: SensorEventListener? = null

  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context unavailable")

  override fun definition() = ModuleDefinition {
    Name("LoptionMotion")
    Events("onMotionUpdate")

    Function("capabilities") {
      mapOf(
        "platform" to "android",
        "stepCounting" to (StepCounterReader.sensor(context) != null),
        "distance" to false,
        "history" to false,
        "background" to true,
        "historyDays" to 0
      )
    }

    AsyncFunction("getPermissionsAsync") { promise: Promise ->
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        Permissions.getPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.ACTIVITY_RECOGNITION)
      } else {
        Permissions.getPermissionsWithPermissionsManager(appContext.permissions, promise)
      }
    }

    AsyncFunction("requestPermissionsAsync") { promise: Promise ->
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        Permissions.askForPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.ACTIVITY_RECOGNITION)
      } else {
        Permissions.askForPermissionsWithPermissionsManager(appContext.permissions, promise)
      }
    }

    // Takes a reading now and stores it; resolves with it, or null when the
    // device has no counter, permission is missing or no value came.
    AsyncFunction("recordSnapshotAsync") { promise: Promise ->
      scope.launch {
        val s = StepCounterReader.read(context, "foreground")
        if (s != null) StepSnapshotStore.append(context, s)
        promise.resolve(s?.toMap())
      }
    }

    AsyncFunction("getSnapshotsAsync") { sinceMs: Double ->
      StepSnapshotStore.all(context).filter { it.wallTimeMs >= sinceMs.toLong() }.map { it.toMap() }
    }

    AsyncFunction("clearSnapshotsAsync") {
      StepSnapshotStore.clear(context)
    }

    AsyncFunction("setBackgroundEnabledAsync") { enabled: Boolean ->
      StepSnapshotStore.setBackgroundEnabled(context, enabled)
      if (enabled) StepSnapshotWorker.schedule(context) else StepSnapshotWorker.cancel(context)
      enabled
    }

    Function("isBackgroundEnabled") {
      StepSnapshotStore.backgroundEnabled(context)
    }

    // Live counter values while a screen listens (foreground only).
    Function("startLiveUpdates") { _: Double ->
      val manager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager ?: return@Function
      val counter = manager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) ?: return@Function
      if (!StepCounterReader.hasPermission(context) || liveListener != null) return@Function
      val listener = object : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent) {
          sendEvent("onMotionUpdate", mapOf("counter" to event.values[0].toDouble(), "to" to System.currentTimeMillis().toDouble(),
            "bootCount" to StepCounterReader.bootCount(context)))
        }
        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
      }
      // Batched by the sensor hub (up to 10 s) to save battery.
      manager.registerListener(listener, counter, SensorManager.SENSOR_DELAY_NORMAL, 10_000_000)
      liveListener = listener
    }

    Function("stopLiveUpdates") {
      val manager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
      liveListener?.let { manager?.unregisterListener(it) }
      liveListener = null
    }

    OnDestroy {
      val manager = appContext.reactContext?.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
      liveListener?.let { manager?.unregisterListener(it) }
      liveListener = null
    }
  }
}
