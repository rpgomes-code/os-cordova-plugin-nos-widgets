# OutSystems ecosystem & native-widget research (2026-06-02)

Findings from a 7-stream parallel research pass: a sweep of all **234 repos** in the
`github.com/OutSystems` org, the OutSystems forums/docs/Forge/Ideas, the Cordova/Capacitor/RN/Expo
widget community, and how managed cloud-build services sign iOS app extensions. Full per-stream
reports with every source URL are in [`raw/`](raw/). Everything below is cross-referenced against
our own MABS build-log analysis (`docs/2026-06-02-ios-status.md` / the NOS MABS logs).

---

## TL;DR

1. **We are in greenfield.** No Forge component or public OutSystems project implements native
   home-screen widgets (or any 2nd-target extension: App Clip, watchOS, Share/Notification-Service
   extension). OutSystems R&D **declined** the "Android System Widgets" idea (Aug 2022, "not on our
   roadmap"). A custom plugin is the only path — confirmed by multiple MVP/forum threads.
2. **The only real blocker is signing the 2nd iOS target — and it is narrower than feared.** The
   exact cordova-ios MABS uses (`7.1.1+2.0.0`) **already supports per-target provisioning profiles**
   at the IPA-export stage. The question is purely whether MABS will emit a 2-entry profile map (or
   expose a hook to inject the extension's profile). This reframes the OutSystems ask from "please
   build a new capability" to "please pass through a capability cordova-ios already has."
3. **Our vendoring of `xcode` is validated by OutSystems' own code.** Their
   `cordova-plugin-add-swift-support` vendors `node-xcode` with the commit message *"added xcode
   dependency (for compatibility issues with MABS)"* and injects pbxproj build settings from an
   `after_prepare` hook — exactly our approach. MABS **does** run `after_prepare` hooks (proven in
   the logs).
4. **Android has no signing blocker at all** — a Glance widget compiles into the single APK/AAB.
5. **Strategic:** OutSystems is moving ODC mobile from **Cordova → Capacitor** (recommended for new
   apps on **MABS 12**). Our Cordova plugin is correct for OS11 today; budget a Capacitor port.
6. **Production blueprint exists:** every official OS plugin is a 3-repo split (native Swift lib +
   native Kotlin lib + thin Cordova bridge). We should adopt it.

---

## 1. The native-widget question — is it MABS-viable, and how?

### 1a. What's confirmed working (de-risked)
| Capability | Status | Evidence |
|---|---|---|
| MABS runs `after_prepare` hooks | ✅ | `add-swift-support` + `firebase-analytics` run `after_prepare` in our iOS log |
| pbxproj manipulation via `xcode` lib in a hook | ✅ | `add-swift-support` does exactly this; OS vendors `node-xcode` for MABS |
| Vendoring plugin deps (our `xcode` copy) | ✅ | MABS doesn't `npm install` plugin deps (sqlite installs its own via a hook); OS vendors too |
| Inject the WidgetKit target + Swift sources | ✅ (local) | our hook injects cleanly; structurally identical to add-swift-support |
| App-side **App Group** entitlement | ✅ pattern | OS convention: `<config-file target="*/Entitlements-Debug.plist" parent="com.apple.security.application-groups">` (see §2b) |
| Android Glance widget end-to-end | ✅ | cordova-android 13, Gradle 8.x, Kotlin compiles, custom `.gradle` applied, in-APK signing |

### 1b. The one blocker — signing the widget extension — fully characterized
Apple requires the widget to be a **separate target** with its **own explicit App ID + provisioning
profile**, sharing an **App Group** with the app. MABS signs **Manual** with a **single** profile
(`keys/build.json`, confirmed in our log + OS docs error `OS-MABS-SIG-40001` + MABS-10 release note:
MABS does *not* auto-provision capabilities). Nothing in the OutSystems org adds a 2nd target, and
two forum attempts (OneSignal NSE; Notification Content Extension) went **unanswered**.

### 1c. The reframe — why this is more tractable than the forums suggest
Cross-referencing the cordova-ios source with the build infra:

- **cordova-ios `7.1.1+2.0.0` (the exact MABS build) already supports a per-target profile map.**
  `build.json`'s `provisioningProfile` accepts a string **or** an object `{ bundleId: profile }`. At
  the export stage it writes the **full map** into `exportOptions.plist` `provisioningProfiles` for
  true per-target signing (upstream Apache PR #1251; byte-identical in the OS fork). So the IPA
  export can already sign our widget target **if MABS puts a 2-entry map in `build.json`.**
- **MABS 11.2+ runs on Ionic Appflow**, and **Appflow has supported app-extension signing since Dec
  2020** (you upload the app profile *and* the extension profile). The underlying builder can do it.
- **The old "ENOENT … Provisioning Profiles" forum failure looks stale.** Our MABS-12 log shows the
  builder *does* have `~/Library/MobileDevice/Provisioning Profiles/<uuid>.mobileprovision` — so the
  **App Center-style workaround** (ship the extension's `.mobileprovision` + a hook copies it into
  that dir before archive) is plausibly viable now and worth testing.

### 1d. Three concrete paths (in preference order)
1. **Ask MABS to emit a 2-entry `provisioningProfile` map** (`{ "<app-id>":"<uuid>",
   "<app-id>.widget":"<uuid>" }`). Lowest effort — the cordova-ios plumbing already exists; this is
   what Appflow/Bitrise/Codemagic all do. Caveat: cordova's *archive*-stage xcconfig only uses the
   first map entry, so confirm MABS drives signing via **export options** (it archives then exports).
2. **`after_prepare` hook sets the extension target's signing in the pbxproj** (`CODE_SIGN_STYLE=
   Manual`, `PROVISIONING_PROFILE_SPECIFIER`, `DEVELOPMENT_TEAM`, `CODE_SIGN_ENTITLEMENTS`) — per-
   target pbxproj settings override the global xcconfig — **plus** get the extension `.mobileprovision`
   into `~/Library/MobileDevice/Provisioning Profiles/` (App Center pattern). Works without MABS
   product changes *if* a pre-archive hook can place the file.
3. **ASC API automatic signing** (cordova-ios 7 `authenticationKey*` + `automaticProvisioning`) —
   auto-creates App IDs/App Group/profiles per target. Cleanest long-term, biggest MABS change.

Apple-side prerequisites are **ours regardless** (one-time, in App Store Connect): explicit
`…widget` App ID, register one App Group, **enable+assign it on both App IDs**, add
`com.apple.security.application-groups` to both targets, generate the two profiles.

---

## 2. OutSystems official plugin conventions (production blueprint)

### 2a. The 3-layer architecture (adopt this)
Every modern official plugin (Barcode, InAppBrowser, …) splits into **three repos**:
- **`OS<Feature>Lib-iOS`** — pure Swift, all logic/UI. Ships **both** `Package.swift` (SPM, source)
  **and** a `.podspec` with a `vendored_frameworks` xcframework (binary). **MABS pulls the prebuilt
  xcframework via a `<podspec>` block** — building the xcframework per release (`build_framework.sh`:
  archive device+sim → `-create-xcframework` → zip → GH release → `pod trunk push`) is the single
  most important MABS-compat detail.
- **`OS<Feature>Lib-Android`** — pure Kotlin `com.android.library`, published to Maven Central
  (OutSystems uses group `io.ionic.libs` post-Ionic-merge; packages stay `com.outsystems.plugins.*`).
- **`cordova-outsystems-<feature>`** — thin bridge: `src/ios/*.swift` (CDVPlugin importing the lib),
  `src/android/*.kt` (CordovaPlugin), TS→Vite `www/` JS API; native deps via `<podspec>` (iOS) and a
  one-line `build.gradle` `@aar` wired through `<framework type="gradleReference">` (Android).

→ **Recommendation:** restructure our POC into `OSWidgetsLib-iOS` + `OSWidgetsLib-Android` (Maven
group we own, e.g. `pt.nos.plugins`) + `cordova-...-widgets` bridge. (Skip the legacy
`os-plugins-base-interface`/`OSCore` `PlatformProtocol` layer — newer plugins dropped it.)

### 2b. Entitlements convention (this is how we add the App Group)
OS plugins **never ship a `.entitlements` file or use `<edit-config>`**. They inject keys via
`<config-file>` into the plists MABS already generates. For our App Group, add to the **main app**:
```xml
<config-file target="*/Entitlements-Debug.plist"   parent="com.apple.security.application-groups">
  <array><string>group.<your-app-id></string></array></config-file>
<config-file target="*/Entitlements-Release.plist" parent="com.apple.security.application-groups">
  <array><string>group.<your-app-id></string></array></config-file>
```
(Precedents: HealthKit, Sign-in-with-Apple use `*/Entitlements-*.plist`; push/Apple-Pay use
`*-Debug/Release.plist`.) The **extension's** own entitlements are the net-new part — handled by our
hook. Note: a search of the whole org found **zero** existing App Group usage — we'd be first.

### 2c. Other conventions worth copying
- **Versioning:** plain `X.Y.Z` tags via semantic-release; the **`7.1.1+2.0.0` style = `<forge/app
  version>+<plugin-repo version>`**. Extensibility Config JSON `{plugin:{url:"github#tag"},
  metadata:{mabs-min,name,version}}` — set `mabs-min: "12.x"` for us.
- **Build-actions** (`build-actions/*.json`): the modern MABS successor to install hooks for
  build-time config injection — and the mechanism ODC **Capacitor** uses (runs after `capacitor sync`).
- **Meta-plugin pattern** (`secure-sqlite-bundle`): a thin plugin = several `<dependency>` on
  org-owned forks pinned to `#<ver>-OS<n>` tags + a JS clobber facade. Good for a curated bundle.
- **Hooks need their deps vendored** — MABS has no shared npm cache; a hook requiring `xcode` either
  vendors it (our approach + OS's add-swift-support) or ships a `package.json`.

---

## 3. Good-to-know: the OutSystems open-source ecosystem (234 repos)

- **`outsystems-mcp`** — official **remote MCP server** client (a **Claude Code plugin** + Kiro
  Power): *"Edit, publish, deploy OutSystems apps from your AI assistant."* Tools for apps, context,
  server-side OML editing ("Mentor"), publish, deployments, **External Libraries upload**. Alpha, no
  SLA — but directly useful to *this* team for scripting ODC workflows. `install: claude plugin
  marketplace add OutSystems/outsystems-mcp`.
- **Docs are open-source & grep-able:** `docs-product` (OS11), `docs-odc`, `docs-support` (incl. MABS
  release notes + error codes), `docs-howtos`. Faster than the JS-rendered success.outsystems.com.
- **ODC extension dev:** `OutSystems.ExternalLibraries.SDK-templates` (custom .NET server logic),
  `UltimatePDF-ExternalLogic`/`vanguard-xml-to-json` (worked examples), `mcp-python-sdk` (their MCP
  server is Python).
- **CI/CD & ops:** `outsystems-pipeline` (Python, LifeTime deploy API — top dev tool ~46★),
  `odc-jenkins-pipeline`, `OutSystems.SetupTools`, `techsupp-osdiagtool`, `cloud-connector`.
- **Web UI stack (OSS):** `outsystems-ui` (~70★), `os-rds` (Reactive Design System),
  `outsystems-datagrid`, `outsystems-maps`. Plus fork-and-tracked primitives (floating-ui, popper,
  flatpickr, virtual-select).
- **Service Studio internals (high-star OSS):** `WebView` (591★), `CefGlue` (446★), `ReactView`.
- The ~100 `cordova-plugin-*` mirrors + `cordova-outsystems-*` + `OS*Lib-*` + OneSignal/Firebase/
  SQLCipher clusters are the official mobile plugin universe.

---

## 4. How the rest of the world builds hybrid widgets (reusable patterns)

- **Closest Cordova precedent:** `cordova-plugin-today-widget` — `cordova-node-xcode` +
  `after_platform_add` hook + token-substituted entitlements/plist. Today-extension (deprecated) →
  reuse the *mechanism*, swap the target template for WidgetKit.
- **Best pitfall checklist:** Philipp Mayrth's "Apple Watch/Widget in Cordova" — Cordova's
  `ProjectFile.js` forces all targets to config.xml's bundle id (patch the widget's id in a hook);
  WidgetKit forces project-wide iOS 14+ floor; `SWIFT_OBJC_BRIDGING_HEADER` breaks extension Swift;
  hooks must be idempotent (project regenerated each build).
- **Closest API analog:** `capacitor-widget-bridge` (kisimedia, iOS+Android) — `setItem/getItem/
  removeItem`, `reloadAllTimelines/reloadTimelines`, Android `setRegisteredWidgets` — mirror this
  bridge surface.
- **Reference target injector:** `@bacons/apple-targets` (Expo) — `_shared` folder pattern (compile
  the same AppIntents Swift into app + widget); diff-and-replicate pbxproj method.
- **The #1 cross-ecosystem bug:** the App Group entitlement must be on **both** app and widget
  targets with identical group ids, or JS writes succeed but SwiftUI reads return nil. We handle this;
  keep it in the test checklist.
- **Reload discipline:** never reload timelines frequently (battery/throttle; widgets self-refresh
  ~15–30 min). iOS `WidgetCenter.reloadAllTimelines()`; Android `AppWidgetManager`/`updatePeriodMillis`.
- **Structural confirmation:** apache/cordova-ios issue #1641 — there is no first-class plugin.xml
  way to declare an app-extension target; pbxproj manipulation in a hook is the only route (validates
  our design).

---

## 5. Recommended next steps

1. **Add the App Group entitlement to the main app** via the OS `<config-file ... Entitlements-*.plist>`
   convention (§2b) — lowest-risk, proven pattern.
2. **Draft the OutSystems Support ask around the reframe** (§1c/§1d): "cordova-ios 7.1.1 already
   supports a per-target `provisioningProfile` map in `exportOptions.plist` — can MABS 12 emit a
   2-entry map for an app extension, or expose a pre-archive hook to place a second `.mobileprovision`
   (as App Center allowed)?" Attach the log evidence + PR #1251.
3. **Apple assets request** (Admin): explicit `…widget` App ID, one App Group enabled on **both** App
   IDs, two provisioning profiles, App Group capability added to the main app's App ID too.
4. **Pin the Android Compose compiler to Kotlin 1.9.24** (cordova-android 13 default → Compose
   Compiler 1.5.14) and verify in a real MABS build.
5. **Plan the production restructure** into the 3-repo OS architecture (§2a) and, longer-term, a
   **Capacitor port** (MABS 12 / ODC direction).
6. **Optional quick win:** try the App Center-style hook (copy the widget `.mobileprovision` into the
   profiles dir during `after_prepare`) in a throwaway MABS build to test path #2 empirically.

---

### Raw per-stream reports (full detail + all source URLs)
- [`raw/B1-outsystems-forum-docs.md`](raw/B1-outsystems-forum-docs.md) — forums/docs/Forge/Ideas
- [`raw/02-cordova-capacitor-widgets.md`](raw/02-cordova-capacitor-widgets.md) — community widget plugins
- [`raw/03-cloudbuild-extension-signing.md`](raw/03-cloudbuild-extension-signing.md) — cloud-build signing
- [`raw/A1-official-plugin-architecture.md`](raw/A1-official-plugin-architecture.md) — OS plugin architecture
- [`raw/A2-entitlements-in-mabs.md`](raw/A2-entitlements-in-mabs.md) — entitlements convention
- [`raw/A3-cordova-forks-signing.md`](raw/A3-cordova-forks-signing.md) — cordova-ios/android forks
- [`raw/A4-capacitor-and-goodtoknow.md`](raw/A4-capacitor-and-goodtoknow.md) — Capacitor + good-to-know
