# os-cordova-plugin-nos-widgets

Native home-screen widgets for **OutSystems 11** mobile apps (MABS 12), with the UI written natively per platform:

- **Android** — Jetpack **Glance** (Kotlin/Compose). No RemoteViews layout XML.
- **iOS** — **WidgetKit** (Swift/SwiftUI) app-extension target.

Supports **app-pushed data + background self-refresh** and **in-widget interactivity** (with iOS progressive enhancement). This is POC #2; it supersedes the Android-only, XML-based POC #1.

> **Full design & decisions:** [`docs/plans/2026-06-02-os-native-widgets-design.md`](docs/plans/2026-06-02-os-native-widgets-design.md)

## Status

| Area | State |
|---|---|
| Plugin scaffold (manifest, JS API, config) | ✅ done |
| Android (Glance/Kotlin) — built + validated on emulator | ✅ done ([validation](docs/2026-06-02-android-validation.md)) |
| Android via MABS 12 (cloud build) | ⏳ pending (validated locally with cordova-android 13) |
| iOS (WidgetKit/Swift) — built + run on Simulator | ✅ done: build/embed/install/launch + bridge + App Group shared-data flow ([status](docs/2026-06-02-ios-status.md)) |
| iOS build & signing via MABS | ⛔ **gated** — needs Apple Dev assets + MABS multi-target signing confirmation |

## JavaScript API

```js
cordova.plugins.nosWidgets.configure({ appGroup, scheme, apiBaseUrl }, ok, err);
cordova.plugins.nosWidgets.writeData({ token, payload }, ok, err);
cordova.plugins.nosWidgets.refreshNow(ok, err);
cordova.plugins.nosWidgets.onWidgetAction(cb, err);
cordova.plugins.nosWidgets.isWidgetAdded(ok, err);
```

## Using it from OutSystems 11

1. Paste [`outsystems/extensibility-configuration.json`](outsystems/extensibility-configuration.json) into your mobile module's **Extensibility Configuration**, pointing `plugin.url` at this repo.
2. Build a thin **wrapper module** exposing the JS API as Client Actions — see [`outsystems/WRAPPER_MODULE.md`](outsystems/WRAPPER_MODULE.md).
3. Generate the app with **MABS 12**.

## Known gates & must-verify (see design doc §3, §12)

- ⛔ **Apple signing assets** (App Group, extension App ID, provisioning profiles) require an Apple Developer **Admin** — currently unavailable.
- ⚠️ **MABS multi-target signing** — confirm with OutSystems Support that MABS 12 can sign a 2nd iOS target *before* creating Apple assets.
- ⚠️ **Vendor `xcode`** — MABS doesn't `npm install` plugin deps; the iOS hook's dependency must be vendored.
- ⚠️ **Glance toolchain** — needs Kotlin 1.9+/compileSdk 34+; confirm against MABS 12.

## Local development

- **Android:** `cordova platform add android && cordova build android` — testable on an emulator/device.
- **iOS:** `cordova platform add ios && cordova build ios` — run the app + widget on the **Simulator** (App Groups work there without provisioning).

## License

MIT
