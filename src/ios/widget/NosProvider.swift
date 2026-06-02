import WidgetKit
import SwiftUI

struct NosEntry: TimelineEntry {
    let date: Date
    let data: NosWidgetData
}

/// Reads the App Group store and schedules a periodic refresh. In production, getTimeline
/// is where a background fetch (with the shared token) would run before building the entry.
struct NosProvider: TimelineProvider {
    func placeholder(in context: Context) -> NosEntry {
        NosEntry(date: Date(), data: NosWidgetData(loggedIn: false, title: ""))
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
