# Ship the iOS widget WITHOUT OutSystems — local inject + re-sign

MABS silently drops the plugin‑injected widget extension before it archives (proven; see
`outsystems-mabs-extension-escalation.md`). This is the **proven, OutSystems‑free workaround**: build the
`NosWidgetExtension.appex` locally, inject it into the MABS‑built `.ipa`, re‑sign, and install.

> **Scope: DEV / ad‑hoc only.** A re‑signed build **cannot** go to App Store / TestFlight (you can't add
> an extension to an already‑uploaded build). For store delivery the only path is MABS embedding the
> extension itself — which needs the OutSystems change in the escalation doc.

## Why this works (and what was proven)

- The plugin **builds a valid `.appex`** — on cordova‑ios 7.1.1 locally (every CocoaPods config tested),
  the archive produces a correct arm64 WidgetKit extension (`pt.nos.osatmospheretest.widget`,
  `NSExtensionPointIdentifier=com.apple.widgetkit-extension`, App Group `group.pt.nos.osatmospheretest`,
  links only system frameworks → self‑contained).
- The MABS `.ipa` app is already signed by the team (`6N3U46YW3N`) and **already carries the App Group
  entitlement**, so injecting + re‑signing the `.appex` with the matching widget profile produces a valid,
  installable bundle (`codesign --verify --deep --strict` passes).
- **The one prerequisite that can't be faked:** the app's signing identity (`.p12` = cert + private key,
  same team `6N3U46YW3N`, e.g. *Apple Development: Pedro Matias (53N4BPWA5F)*) must be in your login
  keychain. Whoever signs the app for OutSystems has it.

## Step A — build the unsigned `.appex` (once; regenerate when the widget changes)

```bash
rm -rf /tmp/widgetbuild && mkdir /tmp/widgetbuild && cd /tmp/widgetbuild
cordova create app pt.nos.osatmospheretest "Outsystems Test App (Only DEV)"
cd app
cordova platform add ios@7.1.1
cordova plugin add /Users/rpgomes/Documents/Projects/Outsystems/NOS/widgets/os-cordova-plugin-nos-widgets \
    --variable NOS_WIDGET_TEAM_ID=6N3U46YW3N \
    --variable 'NOS_WIDGET_PROFILE_SPECIFIER=APP Test DEV Widget'
cordova prepare ios
cd "platforms/ios"
xcodebuild archive \
    -workspace "Outsystems Test App (Only DEV).xcworkspace" \
    -scheme "Outsystems Test App (Only DEV)" \
    -configuration Release \
    -archivePath /tmp/widgetbuild/NosWidget.xcarchive \
    -destination "generic/platform=iOS" \
    CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" SWIFT_VERSION=5.0
cp -R "/tmp/widgetbuild/NosWidget.xcarchive/Products/Applications/Outsystems Test App (Only DEV).app/PlugIns/NosWidgetExtension.appex" /tmp/NosWidgetExtension.appex
```

> Gotcha (already handled): a bare cordova app target has an empty `SWIFT_VERSION`, which fails archive with
> `SWIFT_VERSION '' is unsupported`. The `SWIFT_VERSION=5.0` flag fixes it. (Real MABS builds set it via
> `cordova-plugin-add-swift-support`, so this only affects this standalone local build.)

## Step B — inject + re-sign the MABS `.ipa`

Import the `.p12` into your login keychain first, then:

```bash
IDENTITY="Apple Development: Pedro Matias (53N4BPWA5F)" \
  ./scripts/inject-nos-widget.sh \
    "/Users/rpgomes/Downloads/Outsystems Test App (Only DEV).ipa" \
    /tmp/NosWidgetExtension.appex \
    "/Users/rpgomes/Downloads/APP_Test_DEV_Widget.mobileprovision" \
    "/Users/rpgomes/Downloads/Outsystems-Test-App-with-widget.ipa"
```

The script injects the `.appex`, copies in the widget profile, re‑signs bottom‑up
(frameworks → `.appex` → app) using the app's real entitlements + the widget's entitlements, verifies, and
repackages.

## Step C — install on a registered device

```bash
xcrun devicectl device install app --device <UDID> \
  "/Users/rpgomes/Downloads/Outsystems-Test-App-with-widget.ipa"
# or drag the .ipa onto the device in Apple Configurator 2, or Xcode > Window > Devices & Simulators.
```

Then long‑press the home screen → **＋** → **NOS** → add Saldo / Fatura / Consumos. The App Group is on
both targets, so the widget reads the app's shared data.

## Caveats

- **DEV/ad‑hoc only** — not App Store / TestFlight.
- **Per‑build** — re‑run after every MABS build (each new `.ipa` lacks the widget again).
- **Same team** — the `.appex` and app must be signed by team `6N3U46YW3N`; signing under a different team
  requires creating your own App ID + App Group + widget App ID + profiles in that account.
- **Device UDID** must be in both the app and widget profiles (it already is for the current fleet).

## The store‑shippable fix (separate, needs OutSystems or a self‑managed build)

The only way to get the widget into an App Store build is for **MABS to embed the extension itself** — see
`outsystems-mabs-extension-escalation.md`. Alternatively, archive + export the whole app **outside MABS**
(local/fastlane) with an `exportOptions.plist` `provisioningProfiles` map keyed by bundle id
(`pt.nos.osatmospheretest` + `pt.nos.osatmospheretest.widget`) — but OutSystems O11 does not officially
expose its generated Xcode project for that.
