// L'OPTION phone motion (iOS). Core Motion's CMPedometer keeps the steps
// and distance measured by the motion coprocessor for the last 7 days,
// whether or not the app was running, so days are read on demand: nothing
// runs in the background and nothing is polled. Live updates are delivered
// only while the app is in the foreground and a screen listens.
import CoreMotion
import ExpoModulesCore

private let EVENT_UPDATE = "onMotionUpdate"

public final class LoptionMotionModule: Module {
  private lazy var pedometer = CMPedometer()
  private var liveFrom: Date?

  public func definition() -> ModuleDefinition {
    Name("LoptionMotion")
    Events(EVENT_UPDATE)

    Function("capabilities") { () -> [String: Any] in
      return [
        "platform": "ios",
        "stepCounting": CMPedometer.isStepCountingAvailable(),
        "distance": CMPedometer.isDistanceAvailable(),
        "history": true,
        "background": false,
        "historyDays": 7
      ]
    }

    // 'authorized' | 'denied' | 'restricted' | 'not_determined'
    Function("authorizationStatus") { () -> String in
      switch CMPedometer.authorizationStatus() {
      case .authorized: return "authorized"
      case .denied: return "denied"
      case .restricted: return "restricted"
      default: return "not_determined"
      }
    }

    // Steps and distance between two instants (ms since epoch). The first
    // query shows the Motion & Fitness permission prompt.
    AsyncFunction("queryAsync") { (startMs: Double, endMs: Double, promise: Promise) in
      let start = Date(timeIntervalSince1970: startMs / 1000.0)
      let end = Date(timeIntervalSince1970: endMs / 1000.0)
      guard end > start else {
        promise.resolve(["steps": 0, "distanceM": NSNull(), "from": startMs, "to": endMs])
        return
      }
      self.pedometer.queryPedometerData(from: start, to: end) { data, error in
        if let error = error as NSError? {
          // CMErrorMotionActivityNotAuthorized = 105
          promise.reject(error.code == 105 ? "E_MOTION_DENIED" : "E_MOTION_QUERY", error.localizedDescription)
          return
        }
        let distance: Any = data?.distance.map { $0.doubleValue } ?? NSNull()
        promise.resolve([
          "steps": data?.numberOfSteps.intValue ?? 0,
          "distanceM": distance,
          "from": (data?.startDate.timeIntervalSince1970 ?? start.timeIntervalSince1970) * 1000.0,
          "to": (data?.endDate.timeIntervalSince1970 ?? end.timeIntervalSince1970) * 1000.0
        ])
      }
    }

    // Live steps since `fromMs` (start of the day or of a workout segment).
    Function("startLiveUpdates") { (fromMs: Double) in
      let from = Date(timeIntervalSince1970: fromMs / 1000.0)
      self.liveFrom = from
      self.pedometer.startUpdates(from: from) { [weak self] data, _ in
        guard let data else { return }
        self?.sendEvent(EVENT_UPDATE, [
          "steps": data.numberOfSteps.intValue,
          "distanceM": data.distance.map { $0.doubleValue } as Any,
          "from": fromMs,
          "to": data.endDate.timeIntervalSince1970 * 1000.0
        ])
      }
    }

    Function("stopLiveUpdates") {
      self.liveFrom = nil
      self.pedometer.stopUpdates()
    }

    OnAppEntersBackground {
      if self.liveFrom != nil { self.pedometer.stopUpdates() }
    }

    OnAppEntersForeground {
      if let from = self.liveFrom {
        let fromMs = from.timeIntervalSince1970 * 1000.0
        self.pedometer.startUpdates(from: from) { [weak self] data, _ in
          guard let data else { return }
          self?.sendEvent(EVENT_UPDATE, [
            "steps": data.numberOfSteps.intValue,
            "distanceM": data.distance.map { $0.doubleValue } as Any,
            "from": fromMs,
            "to": data.endDate.timeIntervalSince1970 * 1000.0
          ])
        }
      }
    }

    OnDestroy {
      self.pedometer.stopUpdates()
    }
  }
}
