import WidgetKit
import SwiftUI

struct NosEntry: TimelineEntry {
    let date: Date
    let data: NosData
}

/// Shared timeline provider for all three widgets. Reads the App Group store and schedules a
/// periodic refresh; in production getTimeline is where a background fetch would run.
struct NosProvider: TimelineProvider {
    func placeholder(in context: Context) -> NosEntry {
        NosEntry(date: Date(), data: NosSharedStore.read())
    }

    func getSnapshot(in context: Context, completion: @escaping (NosEntry) -> Void) {
        completion(NosEntry(date: Date(), data: NosSharedStore.read()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NosEntry>) -> Void) {
        let entry = NosEntry(date: Date(), data: NosSharedStore.read())
        let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date())
            ?? Date().addingTimeInterval(1800)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}
