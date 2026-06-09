import Foundation
import WidgetKit
// NOTE: do NOT `import Cordova`. Under OutSystems/MABS there is no Swift module named "Cordova"
// (CordovaLib is a static lib whose headers are exposed via the app's add-swift-support
// Bridging-Header.h). CDVPlugin / CDVInvokedUrlCommand / CDVPluginResult resolve from that bridging
// header — same as every other OutSystems Swift plugin (e.g. eSIM). Adding `import Cordova` breaks the
// build with: "Unable to find module dependency: 'Cordova'".

/// Cordova <-> Swift bridge (main app target). Exposed to OutSystems as Client Actions.
/// Writes data into the App Group shared store that the WidgetKit extension reads, and
/// asks WidgetKit to reload the timeline so the widget re-renders.
@objc(NosWidgetPlugin)
class NosWidgetPlugin: CDVPlugin {

    /// App Group is injected at build time (entitlements + Info.plist) by the plugin hook.
    private var appGroup: String {
        (Bundle.main.object(forInfoDictionaryKey: "NosAppGroup") as? String)
            ?? "group.\(Bundle.main.bundleIdentifier ?? "com.nos.widgethost")"
    }
    private var store: UserDefaults? { UserDefaults(suiteName: appGroup) }

    @objc(configure:)
    func configure(_ command: CDVInvokedUrlCommand) {
        let opts = command.argument(at: 0) as? [String: Any] ?? [:]
        if let scheme = opts["scheme"] as? String { store?.set(scheme, forKey: "scheme") }
        if let api = opts["apiBaseUrl"] as? String { store?.set(api, forKey: "apiBaseUrl") }
        if let m = opts["refreshMinutes"] as? NSNumber, m.intValue > 0 { store?.set(m.intValue, forKey: "refreshMinutes") }
        reload()
        sendOk(command)
    }

    @objc(writeData:)
    func writeData(_ command: CDVInvokedUrlCommand) {
        let data = command.argument(at: 0) as? [String: Any] ?? [:]
        let token = data["token"] as? String ?? ""
        var payloadJSON = "{}"
        if let payload = data["payload"],
           let d = try? JSONSerialization.data(withJSONObject: payload),
           let s = String(data: d, encoding: .utf8) {
            payloadJSON = s
        }
        store?.set(token, forKey: "token")
        store?.set(payloadJSON, forKey: "payload")
        store?.set(!token.isEmpty, forKey: "loggedIn")
        store?.set(Date().timeIntervalSince1970, forKey: "lastUpdated")
        reload()
        commandDelegate.send(CDVPluginResult(status: .ok, messageAs: "written"),
                             callbackId: command.callbackId)
    }

    @objc(refreshNow:)
    func refreshNow(_ command: CDVInvokedUrlCommand) {
        reload()
        sendOk(command)
    }

    @objc(isWidgetAdded:)
    func isWidgetAdded(_ command: CDVInvokedUrlCommand) {
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.getCurrentConfigurations { result in
                var added = false
                if case .success(let widgets) = result { added = !widgets.isEmpty }
                self.commandDelegate.send(CDVPluginResult(status: .ok, messageAs: added),
                                          callbackId: command.callbackId)
            }
        } else {
            commandDelegate.send(CDVPluginResult(status: .ok, messageAs: false),
                                 callbackId: command.callbackId)
        }
    }

    @objc(onWidgetAction:)
    func onWidgetAction(_ command: CDVInvokedUrlCommand) {
        // Kept-alive callback for future widget->app events (e.g. deep-link routing on launch).
        let result = CDVPluginResult(status: .noResult)
        result.setKeepCallbackAs(true)
        commandDelegate.send(result, callbackId: command.callbackId)
    }

    private func reload() {
        if #available(iOS 14.0, *) { WidgetCenter.shared.reloadAllTimelines() }
    }
    private func sendOk(_ command: CDVInvokedUrlCommand) {
        commandDelegate.send(CDVPluginResult(status: .ok), callbackId: command.callbackId)
    }
}
