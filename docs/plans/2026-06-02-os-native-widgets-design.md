# Native Home-Screen Widgets for OutSystems 11 — Design (POC #2)

- **Date:** 2026-06-02
- **Status:** Approved direction; scaffolding in progress
- **Repo:** `os-cordova-plugin-nos-widgets`
- **Supersedes:** POC #1 (`Cordova-android-widget-plugin`) — Android-only, RemoteViews/XML, app-pushed text only

---

## 1. Goal

A single Cordova plugin, consumable by an **OutSystems 11 mobile app (MABS 12)**, that delivers **native home-screen widgets**:

- **Android** UI written in **Kotlin (Jetpack Glance / Compose)** — no RemoteViews layout XML.
- **iOS** UI written in **Swift (WidgetKit / SwiftUI)** — a real app-extension target.
- **Background refresh** (widget updates itself on a schedule, even when the app is closed).
- **Interactivity** (in-widget actions where the platform allows; tap-to-open everywhere).

## 2. Decisions locked (from brainstorm)

| Axis | Decision |
|---|---|
| Data model | **App-push + background refresh.** App writes session token/data to shared storage; the widget also fetches from the API on its own schedule. |
| Build path | **Cordova plugin via MABS 12 (cloud).** |
| Interactivity | **Tap + in-widget actions**, with iOS progressive enhancement (see §7). |
| iOS floor | **iOS 14** (WidgetKit minimum). 14–16 = render + refresh + tap-to-open; **17+** adds in-widget buttons via AppIntents. |
| Android | Glance, Kotlin enabled, full interactivity across supported range. |

## 3. Constraints & blockers (must stay visible)

1. **No permission to create Apple certificates / provisioning profiles / identifiers.** App Groups, the extension App ID, and regenerated profiles all require an Apple Developer **Admin/Account Holder**. → iOS-via-MABS **signing leg is externally gated.**
2. **(To verify) MABS single-profile limit.** MABS has historically allowed only one iOS provisioning profile per build. If still true in MABS 12, signing a *second* target (the extension) may be unsupported regardless of the assets above. **Verify with OutSystems Support before NOS creates the Apple assets.**
3. **MABS does not `npm install` plugin dependencies** → the `xcode` lib used by the iOS hook must be **vendored** into the plugin.
4. **Glance 1.1 toolchain** needs Kotlin 1.9+ / compileSdk 34+ — confirm against MABS 12's Android toolchain.

Because of (1) and (2), the plan proves iOS **functionally on the Simulator** (no provisioning needed) and treats the **MABS iOS signing** as a separate, gated milestone.

## 4. Architecture overview

```
 OutSystems 11 app (WebView)                 Native widget (separate process/target)
 ┌───────────────────────────┐               ┌──────────────────────────────────────┐
 │ Wrapper module            │               │ Android: GlanceAppWidget (Kotlin)     │
 │  Client Actions           │   writeData   │ iOS:     WidgetKit extension (Swift)  │
 │   WriteWidgetData ───────────────────────▶│                                       │
 │   RefreshWidget   ────────────┐           │ reads ▲ shared store ▲ writes         │
 │   OnWidgetAction  ◀───────────┼─ events ──│                                       │
 └───────────────────────────┘   │           │ Background refresh:                   │
        cordova.plugins.nosWidgets│           │  Android WorkManager / iOS Timeline   │
                                  ▼           │  → fetch API with shared token        │
                          Shared storage  ◀───┤                                       │
                  (Android EncryptedSharedPrefs / iOS App Group UserDefaults)         │
                                              └──────────────────────────────────────┘
```

## 5. Repo layout

```
os-cordova-plugin-nos-widgets/
├── plugin.xml                       # platforms, prefs, manifest/plist edits, hook
├── package.json                     # vendors `xcode` for the iOS hook
├── hooks/ios-add-widget-extension.js# injects WidgetKit target + App Group into .pbxproj
├── src/
│   ├── android/                     # Kotlin
│   │   ├── NosWidgetPlugin.kt        # Cordova bridge
│   │   ├── glance/NosWidget.kt        # GlanceAppWidget — Compose UI
│   │   ├── glance/NosWidgetReceiver.kt
│   │   ├── work/RefreshWorker.kt      # WorkManager background fetch
│   │   ├── action/RefreshAction.kt    # in-widget button → ActionCallback
│   │   └── store/WidgetStore.kt       # EncryptedSharedPreferences / DataStore
│   └── ios/
│       ├── NosWidgetPlugin.swift      # Cordova bridge (main target)
│       └── widget/                    # extension sources (added to new target by hook)
│           ├── NosWidgetBundle.swift
│           ├── NosWidget.swift        # SwiftUI views
│           ├── Provider.swift         # AppIntentTimelineProvider
│           ├── RefreshIntent.swift    # AppIntents (iOS 17+)
│           └── SharedStore.swift      # App Group UserDefaults
├── www/widget.js                    # JS API
├── res/android/xml/nos_widget_info.xml  # tiny appwidget-provider metadata (not UI)
└── outsystems/
    ├── extensibility-configuration.json
    └── WRAPPER_MODULE.md             # Client Actions to build in Service Studio
```

> **"No XML" caveat:** Glance removes the RemoteViews *layout* XML — the UI is 100% Kotlin/Compose. Android still requires one small `appwidget-provider` *metadata* XML (sizes, preview, update period). That is metadata, not UI, and is unavoidable.

## 6. Plugin API (consumed by OS11 Client Actions)

```js
cordova.plugins.nosWidgets.configure({ appGroup, scheme, apiBaseUrl }, ok, err) // one-time
cordova.plugins.nosWidgets.writeData({ token, payload }, ok, err)               // app → widget
cordova.plugins.nosWidgets.refreshNow(ok, err)                                  // force reload
cordova.plugins.nosWidgets.onWidgetAction(cb, err)                              // widget → app stream
cordova.plugins.nosWidgets.isWidgetAdded(ok, err)                               // wired up (POC #1 bug fixed)
```

## 7. Android design (fully unblocked → end-to-end via MABS)

- **Kotlin:** `GradlePluginKotlinEnabled=true`. **Glance** via `androidx.glance:glance-appwidget`. **WorkManager** + **security-crypto**.
- **UI:** `GlanceAppWidget.provideGlance {}` Compose content. `GlanceAppWidgetReceiver` registered through a manifest `<config-file>` edit.
- **Background refresh:** `CoroutineWorker` (periodic ≥15 min + on-demand) fetches with the shared token, writes Glance state, calls `NosWidget().updateAll(context)`.
- **Interactivity:** `actionRunCallback<RefreshAction>()` runs **without opening the app**; `actionStartActivity` deep-links into it.
- **Shared store:** `EncryptedSharedPreferences`, written by the plugin and read by widget + worker.
- **State persistence (POC #1 fix):** last payload persisted in the store and rendered on `onUpdate`/reboot — no static-field state.

## 8. iOS design (code + Simulator now; MABS signing gated)

- **Injection hook** (`xcode`, `after_prepare`): create `app-extension` target, add Swift sources, embed it, write **App Group** entitlements to both targets, set deployment target **iOS 14**.
- **UI/data:** SwiftUI views; `AppIntentTimelineProvider` for timeline refresh; `widgetURL` for deep links; App Group `UserDefaults` shares data; plugin calls `WidgetCenter.reloadTimelines` after `writeData`.
- **Progressive enhancement:**

  | iOS | Renders | Background refresh | In-widget buttons |
  |---|---|---|---|
  | 14–16 | ✅ | ✅ timeline | ❌ → tap-to-open fallback |
  | 17+ | ✅ | ✅ | ✅ AppIntents (`if #available(iOS 17, *)`) |

- **Validation:** iOS Simulator (App Groups work without provisioning). Device/MABS signing waits on §3.1/§3.2.

## 9. Shared concerns

- **Auth / 401:** token kept in shared storage; on `401` the widget cannot re-login silently → renders a **"Please log in"** state with tap-to-open (POC #1 pattern returns by design). *Hardening:* move token to Keychain access group (iOS) / Keystore (Android) for production.
- **Deep links:** custom scheme (e.g. `nosapp://widget/...`) registered via plugin config (`CFBundleURLTypes` / Android intent-filter); OS11 routes it to a screen.
- **OutSystems glue:** `extensibility-configuration.json` references the plugin git URL + preferences; a Service-Studio wrapper module exposes the Client Actions.

## 10. Phased plan

1. **Scaffold** — repo, plugin manifest, JS API, extensibility config, design doc. *(in progress)*
2. **Android end-to-end via MABS** — Glance UI → app-pushed data → background refresh → interactivity → deep link. Test on emulator.
3. **iOS code + Simulator** — hook + extension + shared data + timeline + AppIntents (gated). Validate on Simulator.
4. **Verify MABS multi-target signing** with OutSystems Support; **hand off the Apple asset request**; once provisioned, wire MABS iOS signing.
5. **Document** risks, MABS findings, and the OutSystems wrapper module.

## 11. Verification strategy

- **Android:** real emulator/device via local tooling — install APK, add widget to home screen, screenshot, tap button, confirm background refresh and deep link.
- **iOS:** Simulator — confirm render, shared-data read, timeline refresh, AppIntents (17+), tap-to-open fallback (14–16).
- **OutSystems:** smoke-test the wrapper module's Client Actions against the plugin JS API.

## 12. Risks & open items

| # | Risk / unknown | Mitigation |
|---|---|---|
| R1 | MABS 12 may not sign a 2nd iOS target | **Verify with OutSystems Support before creating Apple assets.** Fallback: non-MABS iOS build (breaks requirement) or iOS scope reduction. |
| R2 | No permission for Apple certs/profiles | Hand the §3 asset request to an Apple Dev Admin. |
| R3 | MABS won't `npm install` plugin deps | Vendor `xcode` in the plugin. |
| R4 | Glance/Kotlin toolchain mismatch in MABS 12 | Confirm Kotlin 1.9+/compileSdk 34+; pin versions. |
| R5 | Token at rest outside WebView | EncryptedSharedPreferences / App Group now; Keychain/Keystore for production. |
| R6 | Hook fragility across MABS Xcode/cordova-ios upgrades | Keep hook minimal/defensive; pin tested versions; log loudly. |

## 13. Open questions

- Exact data payload the widget must show (fields, refresh cadence, endpoint, auth scheme)?
- Deep-link target screen(s) in the OS11 app?
- Branding/sizes for each platform's widget families?
