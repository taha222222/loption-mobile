package expo.modules.loptionmotion

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

object StepCounterReader {
  fun sensor(context: Context): Sensor? =
    (context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager)?.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)

  fun hasPermission(context: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
      context.checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED

  fun bootCount(context: Context): Int = try {
    Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT)
  } catch (_: Exception) {
    -1
  }

  // Registers for one event of the step counter and unregisters. Returns
  // null when the device has no counter, permission is missing, or the
  // sensor gives no value within the timeout (nothing is invented).
  suspend fun read(context: Context, origin: String, timeoutMs: Long = 8000): StepSnapshot? {
    val manager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager ?: return null
    val counter = manager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) ?: return null
    if (!hasPermission(context)) return null
    val value = withTimeoutOrNull(timeoutMs) {
      suspendCancellableCoroutine<Float> { cont ->
        val listener = object : SensorEventListener {
          override fun onSensorChanged(event: SensorEvent) {
            manager.unregisterListener(this)
            if (cont.isActive) cont.resume(event.values[0])
          }
          override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
        }
        manager.registerListener(listener, counter, SensorManager.SENSOR_DELAY_NORMAL, 0)
        cont.invokeOnCancellation { manager.unregisterListener(listener) }
      }
    } ?: return null
    return StepSnapshot(value.toDouble(), System.currentTimeMillis(), bootCount(context), SystemClock.elapsedRealtime(), origin)
  }
}
