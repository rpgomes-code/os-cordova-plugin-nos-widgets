import Foundation

/// All widget data, parsed from the App Group shared store. Mirrors the JSON the app pushes
/// via writeData (see the demo app for the shape).
struct NosData {
    let loggedIn: Bool
    let balance: String
    let plan: String
    let dataUsed: Double, dataTotal: Double, dataUnit: String
    let minUsed: Int, minTotal: Int
    let smsUsed: Int, smsTotal: Int
    let billAmount: String, billDue: String
}

enum NosSharedStore {
    /// Authoritative value is the `NosAppGroup` Info.plist key the plugin hook writes at build time.
    /// The fallback derives `group.<app bundle id>` by dropping the last component of this (extension)
    /// target's bundle id — suffix-agnostic, so it works for any configured widget bundle suffix.
    static var appGroup: String {
        if let g = Bundle.main.object(forInfoDictionaryKey: "NosAppGroup") as? String { return g }
        let bundleId = Bundle.main.bundleIdentifier ?? "com.nos.widgethost.widget"
        let appId = bundleId.contains(".") ? String(bundleId[..<bundleId.lastIndex(of: ".")!]) : bundleId
        return "group.\(appId)"
    }

    private static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

    static func scheme() -> String { defaults?.string(forKey: "scheme") ?? "nosapp" }
    static func refreshMinutes() -> Int { let m = defaults?.integer(forKey: "refreshMinutes") ?? 0; return m > 0 ? m : 30 }

    static func read() -> NosData {
        let d = defaults
        let loggedIn = d?.bool(forKey: "loggedIn") ?? false
        let payload = d?.string(forKey: "payload") ?? "{}"
        let obj = ((try? JSONSerialization.jsonObject(with: Data(payload.utf8))) as? [String: Any]) ?? [:]

        func dict(_ k: String) -> [String: Any] { obj[k] as? [String: Any] ?? [:] }
        func dbl(_ m: [String: Any], _ k: String) -> Double {
            if let n = m[k] as? Double { return n }
            if let n = m[k] as? Int { return Double(n) }
            if let s = m[k] as? String { return Double(s) ?? 0 }
            return 0
        }
        func int(_ m: [String: Any], _ k: String) -> Int { Int(dbl(m, k)) }

        let data = dict("data"), mins = dict("minutes"), sms = dict("sms"), bill = dict("bill")
        return NosData(
            loggedIn: loggedIn,
            balance: obj["balance"] as? String ?? "—",
            plan: obj["plan"] as? String ?? "NOS",
            dataUsed: dbl(data, "used"), dataTotal: dbl(data, "total"),
            dataUnit: data["unit"] as? String ?? "GB",
            minUsed: int(mins, "used"), minTotal: int(mins, "total"),
            smsUsed: int(sms, "used"), smsTotal: int(sms, "total"),
            billAmount: bill["amount"] as? String ?? "—",
            billDue: bill["due"] as? String ?? "—"
        )
    }
}
