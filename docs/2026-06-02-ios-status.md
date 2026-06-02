# iOS status log (Phase 3)

**Date:** 2026-06-02 · **Result:** ✅ Code + extension-injection proven; ⛔ full on-Simulator run blocked by an Xcode platform-component download (environment, not code).

## What was proven

| Item | Status | Evidence |
|---|---|---|
| WidgetKit/SwiftUI/AppIntents widget written in Swift | ✅ | `src/ios/widget/*.swift` |
| Widget Swift **type-checks clean** (iOS 17 sim target) | ✅ | `swiftc -typecheck` → exit 0 |
| **Cordova hook injects a WidgetKit app-extension target** (the central iOS risk) | ✅ | hook logged "extension injected"; 27 `NosWidgetExtension` refs in `project.pbxproj`; ext dir has Swift + Info.plist + entitlements |
| App Group entitlements written to both targets + embedded `.appex` phase | ✅ | hook output + pbxproj |
| Cordova⇆Swift bridge (`NosWidgetPlugin.swift`) | ⚠️ written, not compile-verified | needs full build (bridging header) — see blocker |
| Full app+extension build / run on Simulator | ⛔ blocked | see below |

## Blocker (environment, not the plugin)

Xcode **26.4** is installed, but its only iOS Simulator SDK is **26.4**, and the installed
simulator *runtimes* are **18.3** and **26.0** — Xcode 26.4 rejects all of them:

```
error: iOS 26.4 is not installed. Please download and install the platform from
Xcode > Settings > Components.
```

`xcodebuild -showdestinations` lists **only macOS (Mac Catalyst)** as eligible for the scheme —
no iOS Simulator destination is accepted (device or simulator) until the iOS 26.4 platform
component is installed. This affects **any** iOS build here, including a vanilla Cordova app.

**Fix:** `xcodebuild -downloadPlatform iOS` (≈7 GB) — or Xcode ▸ Settings ▸ Components ▸ iOS 26.4.
Then build against a concrete 26.4 simulator (Cordova's *generic* simulator destination also
fails because it maps to the not-installed 26.4 runtime — build with
`-destination 'platform=iOS Simulator,name=<a 26.4 device>'`).

## Remaining to verify (after the platform is installed)

- Full app + extension compile & link (incl. the `CDVPlugin` Swift bridge / bridging header).
- App Group data flow at runtime: `writeData` (app) → `UserDefaults(suiteName:)` → widget render.
- Widget placed on the Simulator home screen (logged-out → logged-in), `widgetURL` deep link,
  and the iOS 17 interactive `Button(intent:)` refresh.

## Still gated (unchanged, design §3)

- Device/MABS signing of the 2nd target — needs the Apple Developer assets (App Group, extension
  App ID, profiles) and confirmation that MABS 12 can sign a second iOS target.
