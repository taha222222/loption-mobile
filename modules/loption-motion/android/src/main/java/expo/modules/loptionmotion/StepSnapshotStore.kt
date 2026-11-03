package expo.modules.loptionmotion

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

// One reading of the hardware step counter. The counter counts steps since
// the last boot (it restarts at 0 on reboot), so every reading keeps the
// boot it belongs to. Readings stay on the device; the app turns them into
// daily totals (src/activity/stepCounter.ts).
data class StepSnapshot(
  val value: Double, // cumulative steps since boot
  val wallTimeMs: Long, // System.currentTimeMillis() at the reading
  val bootCount: Int, // Settings.Global.BOOT_COUNT, -1 when unknown
  val elapsedMs: Long, // SystemClock.elapsedRealtime() at the reading
  val origin: String // "foreground" or "background"
) {
  fun toJson(): JSONObject = JSONObject()
    .put("value", value).put("wallTimeMs", wallTimeMs).put("bootCount", bootCount)
    .put("elapsedMs", elapsedMs).put("origin", origin)

  fun toMap(): Map<String, Any> = mapOf(
    "value" to value, "wallTimeMs" to wallTimeMs.toDouble(), "bootCount" to bootCount,
    "elapsedMs" to elapsedMs.toDouble(), "origin" to origin
  )

  companion object {
    fun fromJson(o: JSONObject) = StepSnapshot(
      o.getDouble("value"), o.getLong("wallTimeMs"), o.optInt("bootCount", -1), o.optLong("elapsedMs", 0), o.optString("origin", "foreground")
    )
  }
}

object StepSnapshotStore {
  private const val PREFS = "loption_motion"
  private const val KEY = "snapshots"
  private const val KEY_BACKGROUND = "background_enabled"
  private const val MAX_AGE_MS = 10L * 24 * 3600 * 1000
  private const val MAX_COUNT = 2000

  @Synchronized
  fun all(context: Context): List<StepSnapshot> {
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return emptyList()
    return try {
      val arr = JSONArray(raw)
      (0 until arr.length()).map { StepSnapshot.fromJson(arr.getJSONObject(it)) }
    } catch (_: Exception) {
      emptyList()
    }
  }

  // Appends a reading; drops readings older than 10 days. A reading equal to
  // the previous one within 5 minutes adds nothing and is skipped.
  @Synchronized
  fun append(context: Context, s: StepSnapshot) {
    val now = System.currentTimeMillis()
    val list = all(context).filter { now - it.wallTimeMs <= MAX_AGE_MS }.toMutableList()
    val last = list.lastOrNull()
    if (last != null && last.bootCount == s.bootCount && last.value == s.value && s.wallTimeMs - last.wallTimeMs < 5 * 60 * 1000) return
    list.add(s)
    val kept = list.sortedBy { it.wallTimeMs }.takeLast(MAX_COUNT)
    val arr = JSONArray()
    kept.forEach { arr.put(it.toJson()) }
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, arr.toString()).apply()
  }

  @Synchronized
  fun clear(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY).apply()
  }

  fun setBackgroundEnabled(context: Context, enabled: Boolean) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_BACKGROUND, enabled).apply()
  }

  fun backgroundEnabled(context: Context): Boolean =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_BACKGROUND, false)
}
