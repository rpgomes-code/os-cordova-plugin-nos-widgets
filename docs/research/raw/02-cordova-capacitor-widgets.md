# Hybrid-Mobile Native Widget Plugins (Cordova / Capacitor / RN / Expo)
(agent 2 — community widget research)

## Most directly reusable for OUR Cordova plugin
1. **cordova-plugin-today-widget** (DavidStrausz) — the most transferable Cordova pattern: `cordova-node-xcode` + an **`after_platform_add`** hook + token-substituted entitlements/plist (`__APP_IDENTIFIER__`, `group.__APP_IDENTIFIER__`). Today-extension only (deprecated since iOS 14) → reuse the MECHANISM, swap the target template for WidgetKit. config.xml vars: `WIDGET_PATH/NAME/BUNDLE_SUFFIX`, `SWIFT_VERSION`. Explicitly warns you must recreate provisioning profiles WITH the App Group entitlement. https://github.com/DavidStrausz/cordova-plugin-today-widget
2. **Philipp Mayrth — "Adding an Apple Watch App or Widget to Cordova"** — authoritative checklist of Cordova project-regeneration LANDMINES (verified): Cordova's `ProjectFile.js` forces ALL targets to config.xml's bundle id (must patch widget's id in a hook); WidgetKit target forces project-wide iOS 14+ floor; `SWIFT_OBJC_BRIDGING_HEADER` breaks extension Swift; hooks must be idempotent (project regenerated each build). https://dev.to/philippmayrth/adding-an-apple-watch-app-or-widget-to-cordova-3goa
3. **capacitor-widget-bridge** (kisimedia) — closest analog to OUR bridge API (iOS+Android): `setItem/getItem/removeItem`, `reloadAllTimelines/reloadTimelines`, Android `setRegisteredWidgets`, `getCurrentConfigurations`. iOS `UserDefaults(suiteName:)`, Android `SharedPreferences` (RemoteViews, not Glance). v8.1.0 (2026). https://github.com/kisimediaDE/capacitor-widget-bridge
4. **@bacons/apple-targets** (Expo) — reference WidgetKit target injector; uses `@bacons/xcode`; **`_shared` folder pattern** (compile same Swift/AppIntents into app + widget); diff-and-replicate pbxproj method. Supports 20+ target types (widget, Live Activity, App Clip, Watch…). https://github.com/EvanBacon/expo-apple-targets · blog: https://evanbacon.dev/blog/apple-home-screen-widgets
5. **react-native-android-widget** (sAleksovski) — clean Android API: declarative `clickAction`/`clickActionData` + single `WidgetTaskHandler` for taps/updates; Expo config plugin auto-generates the manifest `<receiver>`. Uses RemoteViews+bitmap (NOT Glance) — our Glance approach is more modern but heavier. https://github.com/sAleksovski/react-native-android-widget

## Structural confirmation
- **apache/cordova-ios issue #1641**: there is NO first-class plugin.xml mechanism to declare an iOS app-extension target — every plugin MUST manipulate `project.pbxproj` in a hook via the `xcode` lib. This is the structural reason our injection hook approach is correct (and why all such plugins look "hacky"). https://github.com/apache/cordova-ios/issues/1641
- Expo's own `withXcodeProject` uses `cordova-node-xcode` internally → same lib we vendored.

## Other libs (reference)
- react-native-widget-extension (bndkt) — Expo, iOS widgets + Live Activities; clean app.json option surface (groupIdentifier, deploymentTarget, keychainAccessGroup, frequentUpdates). https://github.com/bndkt/react-native-widget-extension
- expo-widgets (official Expo SDK) — build iOS widgets+Live Activities in SwiftUI WITHOUT native code via `@expo/ui/swift-ui`; shows where ecosystem heads (declarative widget UI from JS). https://docs.expo.dev/versions/latest/sdk/widgets/
- @capgo/capacitor-widget-kit — SVG-template widgets w/ tap "hotspots"→AppIntent action ids, or full-native. https://capgo.app/docs/plugins/widget-kit/
- capacitor-live-activities (ludufre) — iOS 16.2+ Live Activities; pitfall: must manually copy Pods `Shared/*.swift` into the widget target (Xcode doesn't auto-add CocoaPods files to extensions). https://github.com/ludufre/capacitor-live-activities
- gaishimo/eas-widget-example + Nando Rojo gist; Peter Toth interactive widgets (AppIntents). https://www.peterarontoth.com/posts/interactive-widgets-in-expo-managed-workflows

## Cross-cutting patterns & pitfalls
- **#1 data-sharing bug (3+ sources):** App Group entitlement must be on BOTH app + widget targets with IDENTICAL group ids; else JS writes succeed but SwiftUI reads return nil. Verify the extension's own `.entitlements`.
- **pbxproj injection families:** (1) `cordova-node-xcode`/`xcode` in a hook — adds files to existing targets cleanly, but creating a whole new `PBXNativeTarget` is the hard part; (2) `@bacons/xcode` — can create full targets, lightly tested; (3) manual diff-and-replay.
- **Data mechanics (uniform):** iOS `UserDefaults(suiteName:"group.…")`; Android `SharedPreferences` (Glance can use DataStore state too). Files in the App Group container for larger payloads.
- **Reload (uniform):** iOS `WidgetCenter.shared.reloadAllTimelines()`/`reloadTimelines(ofKind:)`; Android `AppWidgetManager` / `ACTION_APPWIDGET_UPDATE`. Universal warning: don't reload often (battery/throttle; widgets self-refresh ~15–30 min).
- **Interactivity (iOS 17+):** AppIntent `perform()` mutates shared UserDefaults then reloads; share intent Swift into both targets. Control Widgets are iOS 18+. Android taps via PendingIntent/clickAction → Activity for deep links.
- **Background refresh:** no "live" data for free — iOS TimelineProvider schedule (+ push for Live Activities); Android `updatePeriodMillis` (min 30 min) or your own WorkManager.

## Maintenance snapshot
- Active (2026): @bacons/apple-targets, capacitor-widget-bridge, react-native-android-widget, react-native-widget-extension, expo-widgets (official).
- Reference/stale: cordova-plugin-today-widget (Today-only, Cordova 7 era), alesmraz/capacitor-native-widgets, capacitor-widgetsbridge-plugin.
