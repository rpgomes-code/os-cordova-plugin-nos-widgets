# OutSystems Support escalation — MABS drops the injected iOS widget extension

**Status:** the plugin is proven correct; the remaining blocker is a **MABS platform limitation** for a
second iOS target (an app extension). This document is the evidence-backed ticket to send to OutSystems
Support (and/or file as an OutSystems Idea).

---

## TL;DR

The plugin injects a WidgetKit **app-extension target** into the MABS-generated Xcode project (via an
`after_prepare` + `before_compile` hook). The MABS build log proves the extension target **and** its
shared‑scheme entry are **present and intact at `before_compile`** — yet the final `xcodebuild archive`
build graph **omits the extension** (it builds only the app + Pods + CordovaLib). The app archives and
exports **successfully but ships with no widget** (a missing extension is not treated as an error).

We reproduced the exact pipeline locally on Apache **cordova‑ios 7.1.1** (same project name, same hook,
**including** the build.json Manual‑signing step and `-workspace -scheme archive`) and the extension
**builds and embeds** (`…app/PlugIns/NosWidgetExtension.appex`). So this is **not** the plugin and **not**
generic cordova‑ios — it is the **OutSystems cordova‑ios fork + MABS CocoaPods/signing pipeline**.

---

## Environment

- OutSystems 11, MABS cloud iOS build, cordova‑ios fork **`OutSystems#7.1.1+2.0.0`**, Xcode/iOS **26.1** SDK.
- App bundle id `pt.nos.osatmospheretest`; widget extension bundle id `pt.nos.osatmospheretest.widget`.
- Plugin `os-cordova-plugin-nos-widgets`. Its iOS hook (registered for **both** `after_prepare` and
  `before_compile`) injects a second Xcode target — WidgetKit app extension **NosWidgetExtension**
  (`NosWidgetExtension.appex`) — and wires it: target, **Embed App Extensions** Copy‑Files phase
  (`dstSubfolderSpec 13`/PlugIns) on the app target, an app→extension `PBXTargetDependency`, a
  `BuildActionEntry` in the app's **shared `.xcscheme`**, per‑target Manual signing
  (`DEVELOPMENT_TEAM 6N3U46YW3N`, `PROVISIONING_PROFILE_SPECIFIER "APP Test DEV Widget"`), and it installs
  the widget `.mobileprovision` (UUID `d5ff5d7b-1ad6-41af-a3cf-64a20cb275a7`) into the agent's
  `~/Library/MobileDevice/Provisioning Profiles/`.

## Symptom (from the MABS build log)

1. **`after_prepare` hook** injects everything → `WidgetKit extension injected` + `registered
   NosWidgetExtension in shared scheme`.
2. **`before_compile` hook** confirms the extension target (uuid `DBEA229D…`) **and** the shared‑scheme
   `BuildActionEntry` are **both still present** (`extension target already present … re-asserting
   shared-scheme registration` / `extension already registered in shared scheme; skipping`).
3. The **only** step between `before_compile` and the archive is cordova‑ios's build.json processing:
   `ProvisioningProfile build option set, changing project settings to Manual. Set CODE_SIGN_STYLE Build
   Property to Manual. Set ProvisioningStyle Target Attribute to Manual.`
4. `xcodebuild -workspace "<App>.xcworkspace" -scheme "<App>" -configuration Debug -destination
   generic/platform=iOS -archivePath … archive` → **`Target dependency graph (46 targets)`** in which the
   app depends only on **CordovaLib + Pods** — **`NosWidgetExtension` is absent**. **Zero** extension
   Swift files compiled, **no** `.appex` produced/embedded, only the app target signed. **ARCHIVE and
   EXPORT SUCCEED.** No `pod install` / project regeneration is logged after `before_compile`.

## Proof this is a MABS/fork issue (not the plugin, not generic cordova‑ios)

We reproduced the pipeline locally on **Apache cordova‑ios 7.1.1**, same project name
`Outsystems Test App (Only DEV)`, the real hook, **with** the build.json Manual‑signing step and the same
`-workspace -scheme … archive` invocation:

- `Target dependency graph (3 targets)` → includes **`Explicit dependency on target 'NosWidgetExtension'`**.
- xcodebuild **builds + attempts to sign** the extension (`… in target 'NosWidgetExtension'`); it fails
  only because the local keychain lacks the `.p12` private key — a signing‑only failure, not a missing
  target.
- A before/after `project.pbxproj` snapshot of the build.json step shows it changes **only**
  `ProvisioningStyle`/`CODE_SIGN_STYLE` → Manual. It removes **no** target, dependency, embed phase, or
  scheme entry (scheme file byte‑identical).
- With `CODE_SIGNING_ALLOWED=NO` the same project archives cleanly and **embeds**
  `…app/PlugIns/NosWidgetExtension.appex`.

The **only** difference between the working local archive (3 targets, **no Pods**) and the failing MABS
archive (**46 targets, with Pods**, extension absent) is the **OutSystems fork + its CocoaPods workspace
assembly and signing inputs**.

## Likely mechanism (please confirm)

Either or both:

- **(a) Workspace/scheme handling:** the fork regenerates/filters the `.xcworkspace` or shared scheme when
  integrating CocoaPods, so the plugin's `BuildActionEntry` no longer pulls the extension into the
  Pods‑based build graph.
- **(b) Single‑profile signing:** MABS feeds xcodebuild a build.json with a single **string**
  `provisioningProfile` (the one app profile uploaded in Service Center). cordova‑ios converts a string
  into `exportOptions.provisioningProfiles = { [appBundleId]: profile }` — a **single‑key** map with no
  entry for `pt.nos.osatmospheretest.widget`. With the project forced Manual project‑wide and no profile
  mapped to the extension's bundle id, the extension cannot be signed/built.

cordova‑ios **already supports the fix upstream**: an **object** `provisioningProfile` keyed by bundle id
(`{"<appId>":"…","<appId>.widget":"…"}`) → passed through to `exportOptions.provisioningProfiles`
(cordova‑ios issue #953 / PR #956, merged as **PR #1251**). **Ionic Appflow** — the same
`xcodebuild archive`‑after‑build.json pipeline — builds and embeds app extensions exactly this way; its
only requirement is *"add the provisioning profile for the extension along with the provisioning profile
of your application."*

On MABS this fix is **unreachable**: MABS generates build.json itself from the single Service Center
profile, exposes no way to supply a per‑bundle‑id map or a second profile, and offers **no documented hook
that runs after the build.json signing step / before the archive** (`after_prepare` and `before_compile`
both run before it).

## Asks (priority order)

1. **Preserve plugin‑injected secondary targets** (and their shared‑scheme `BuildActionEntry`) through the
   build/signing step so `xcodebuild archive`'s graph includes them and the `.appex` is built + embedded.
   At minimum, **do not silently drop** an unsigned/unmapped secondary target — surface an error.
2. **Honor a cordova‑ios build.json `provisioningProfile` map keyed by bundle id** (the object form already
   supported upstream, PR #1251) **and** expose a Service Center / Extensibility Configuration way to
   upload a **second** provisioning profile for the extension's bundle id (`<appId>.widget`), so MABS emits
   `"provisioningProfile": {"<appId>":"…","<appId>.widget":"…"}`.
3. **Expose a pre‑archive hook** (after cordova‑ios writes build.json / before `xcodebuild archive`) so
   plugins can finalize build.json / exportOptions.plist / pbxproj signing for injected targets.

## Questions for OutSystems

1. Does the MABS cordova‑ios fork (`OutSystems#7.1.1+2.0.0`) include cordova‑ios's multi‑profile support
   (PR #1251)? If so, the supported way to feed it a per‑bundle‑id map on MABS?
2. Any way to upload a second provisioning profile (for the extension bundle id) and have MABS include it
   in build.json / `exportOptions.plist`?
3. Does MABS regenerate or filter the `.xcworkspace` / shared schemes (or filter scheme `BuildActionEntries`
   to the app target) during Pods integration or signing?
4. If none of the above exist today, please confirm that shipping a plugin‑injected iOS app extension via
   MABS is currently unsupported, and treat the above as a feature request / Idea.

## References

- cordova‑ios multi‑profile support: <https://github.com/apache/cordova-ios/pull/956> +
  <https://github.com/apache/cordova-ios/issues/953> (merged as PR #1251)
- cordova‑ios `lib/build.js` (string vs object `provisioningProfile` → `exportOptions.provisioningProfiles`)
- Ionic "AppFlow and Extensions":
  <https://ionic.zendesk.com/hc/en-us/articles/27939200396055-AppFlow-and-Extensions>
- Ionic forum, multiple targets:
  <https://forum.ionicframework.com/t/issues-with-build-having-multiple-targets-in-ionic-capacitor-app/215318>

---

## Note for our own records (not for the ticket)

- The plugin hook is **correct and complete** and needs no further change for this issue. It is verified
  intact at `before_compile` on MABS and produces a working `.appex` on Apache cordova‑ios 7.1.1.
- **Android is fully working** end‑to‑end (home + lock‑screen eligible). This blocker is iOS‑on‑MABS only.
- If OutSystems cannot support a 2nd target on MABS, alternative paths: (1) ship the iOS widget via a
  build pipeline that allows a per‑bundle‑id profile map (e.g. Ionic Appflow, or a self‑managed
  fastlane/Xcode Cloud archive), or (2) the OutSystems **Capacitor** track (OS is migrating mobile to
  Capacitor) may expose the needed signing/build control — re‑evaluate there.
