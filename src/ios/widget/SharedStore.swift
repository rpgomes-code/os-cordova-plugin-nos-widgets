import Foundation

/// Read-side of the App Group shared store, used by the WidgetKit extension.
/// Mirrors the keys written by NosWidgetPlugin.swift (app target).
struct NosWidgetData {
    let loggedIn: Bool
    let title: String
}

enum NosSharedStore {

    /// Injected at build time (Info.plist) by the plugin hook; falls back to group.<bundleId>.
    static var appGroup: String {
        (Bundle.main.object(forInfoDictionaryKey: "NosAppGroup") as? String)
            ?? "group.\(Bundle.main.bundleIdentifier?.replacingOccurrences(of: ".widget", with: "") ?? "com.nos.widgethost")"
    }

    private static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

    static func read() -> NosWidgetData {
        let d = defaults
        let loggedIn = d?.bool(forKey: "loggedIn") ?? false
        let payload = d?.string(forKey: "payload") ?? "{}"
        return NosWidgetData(loggedIn: loggedIn, title: parseTitle(payload))
    }

    static func scheme() -> String { defaults?.string(forKey: "scheme") ?? "nosapp" }

    private static func parseTitle(_ json: String) -> String {
        guard let data = json.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let title = obj["title"] as? String else { return "" }
        return title
    }
}
