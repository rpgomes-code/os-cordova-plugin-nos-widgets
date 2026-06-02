import AppIntents
import WidgetKit

/// In-widget refresh action. Interactive widget buttons that run an AppIntent are iOS 17+,
/// so the Button that invokes this is gated behind `#available(iOS 17, *)` in the view.
@available(iOS 16.0, *)
struct RefreshIntent: AppIntent {
    static var title: LocalizedStringResource = "Refresh"

    func perform() async throws -> some IntentResult {
        // Runs in the widget's process without opening the app. In production this is where
        // a fetch with the shared token would happen; here we just reload the timeline.
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}
