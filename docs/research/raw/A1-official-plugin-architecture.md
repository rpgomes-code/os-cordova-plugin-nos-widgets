# OutSystems official native-plugin architecture
(agent A1)

## Three-layer pattern (modern, per barcode & InAppBrowser)
1. **`OS<Feature>Lib-iOS`** — pure Swift, ALL feature logic+UI, no Cordova. Ships BOTH: `Package.swift` (SPM, source) AND a `.podspec` with `vendored_frameworks` + `:http` zip source (binary xcframework — **this is what MABS/CocoaPods pulls**). Entry = one public class + factory/protocol (e.g. `OSBARCManagerFactory`, `OSIABEngine`).
2. **`OS<Feature>Lib-Android`** — pure Kotlin `com.android.library`, published to **Maven Central under group `io.ionic.libs`** (post-Ionic merge; package names stay `com.outsystems.plugins.*`). e.g. `io.ionic.libs:ionbarcode-android`, `io.ionic.libs:ioninappbrowser-android`.
3. **`cordova-outsystems-<feature>`** — THIN bridge: `src/ios/*.swift` (CDVPlugin subclass that `import`s the lib), `src/android/*.kt` (CordovaPlugin dispatching to the lib), `www/` or `src/www/` TS→Vite→`dist/` JS API. No business logic.
- (Legacy, being PHASED OUT: `os-plugins-base-interface` + `OSCore-iOS`'s `PlatformProtocol`/`CordovaImplementation` — multi-framework portability glue. Modern plugins skip it. Don't replicate. `OSPaymentsLib-iOS` is an older non-standard layout — don't model on it.)

## Dependency wiring
- iOS bridge → lib: `<podspec><pods use-frameworks="true"><pod name="OSBarcodeLib" spec="2.0.1"/></pods></podspec>` in plugin.xml. **MABS (CocoaPods 1.16.1) resolves this → downloads release zip → links prebuilt .xcframework.**
- Android bridge → lib: one-line `src/android/build.gradle` `implementation("io.ionic.libs:...:X.Y.Z@aar")` wired via `<framework src="src/android/build.gradle" custom="true" type="gradleReference"/>`.
- Bridges PIN a tested lib version (intentional skew; not auto-bumped).

## plugin.xml contract (key mechanics)
- Android: `<feature>` in res/xml/config.xml, `GradlePluginKotlinEnabled=true` + `GradlePluginKotlinCodeStyle=official`, `<source-file>` .kt, `<framework gradleReference>`.
- iOS: `<feature>` w/ ios-package, `SwiftVersion`, `<config-file target="*-Info.plist">` + `<preference>` variables for usage strings, `<source-file>` .swift, `<podspec>`.
- Host-app mutations: static → `config-file`+`preference`; dynamic → `hooks/` (e.g. InAppBrowser `handle_cleartextTrafficPermitted.js`) OR a **`build-actions/*.json`** MABS Build Action descriptor (modern successor to install hooks).

## Versioning & Forge mapping
- Plain `X.Y.Z` tags (no `v`), enforced by semantic-release `tagFormat:"${version}"`.
- The **`7.1.1+2.0.0` style = `<forge/app version>+<plugin repo version>`** (SemVer build metadata).
- Extensibility Config JSON: `{"plugin":{"url":"github.com/<repo>#<tag>"},"metadata":{"mabs-min":"10.0.0","name":"...","version":"<forgeVersion>"}}` base64'd + POSTed to `/CodeUpdater/rest/Bulk/ExtensabilityUpdate`.
- InAppBrowser carries full O11/ODC release automation: `scripts/{change-extensibility,tag-applications-o11,deploy}.js` + `.github/workflows/o11_*.yml`, `odc_release.yml`, `build-actions/allowHttpTraffic.json`.

## iOS lib release flow (critical for MABS)
`build_framework.sh`: `xcodebuild archive` device+sim w/ `BUILD_LIBRARIES_FOR_DISTRIBUTION=YES` → `-create-xcframework` → zip+LICENSE → attach to GH Release → `pod trunk push`. Keep `Package.swift` in parallel for source/CI tests.

## RECOMMENDATIONS for our widget plugin (production restructure)
1. Split: **`OSWidgetsLib-iOS`** (Swift, all WidgetKit: WidgetBundle/TimelineProvider/AppIntents/App-Group plumbing; ship `Package.swift` + `.podspec` w/ vendored xcframework) + **`OSWidgetsLib-Android`** (Kotlin lib, all Glance; publish to Maven under a group WE own, e.g. `pt.nos.plugins` — can't use `io.ionic.libs`) + **`cordova-outsystems-widgets`** thin bridge (TS→Vite JS API).
2. Wire iOS via `<podspec>` (pin explicit version) — makes MABS pull the prebuilt xcframework. Android via gradleReference Maven aar.
3. Build iOS lib as a binary xcframework per release (copy InAppBrowser's `build_framework.sh`) — **single most important MABS-compat detail.**
4. semantic-release `tagFormat:"${version}"`; copy InAppBrowser's O11 automation; `metadata["mabs-min"]="12.x"`.
5. **BIGGEST STRUCTURAL RISK:** injecting a Widget Extension TARGET is beyond `config-file` — needs a custom Cordova hook (our after_prepare + `xcode` lib) or a MABS build-action. None of the reference plugins add an app-extension target. Validate with MABS early.
