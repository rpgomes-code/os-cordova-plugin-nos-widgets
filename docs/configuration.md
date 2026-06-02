# Configuration reference

Everything an OutSystems app can tune without forking the plugin. Two mechanisms:
**build-time preferences** (set in the Extensibility Configuration) and **runtime options**
(passed to the JS `configure()` Client Action).

## Build-time preferences (Extensibility Configuration → `preferences`)

Set these in the OutSystems app's Extensibility Configuration JSON. All are **optional** — each has
a safe built-in fallback, so an unconfigured Simulator/local build works with none of them. The iOS
`after_prepare` hook reads them from `config.xml`. (They are intentionally NOT declared as plugin
`<preference>` variables, because cordova would then make them *mandatory* at install time.)

```json
{ "preferences": {
    "NosWidgetAppGroup":            "group.com.acme.app",
    "NosWidgetUrlScheme":           "acmeapp",
    "NosWidgetBundleSuffix":        "widget",
    "NosWidgetIosDeploymentTarget": "16.0",
    "NosWidgetDisplayName":         "ACME",
    "NosWidgetExtensionName":       "AcmeWidgetExtension",
    "NosWidgetTeamId":              "ABCDE12345",
    "NosWidgetProfileSpecifier":    "ACME Widget Dev",
    "NosWidgetProvisioningProfile": "profiles/acme-widget.mobileprovision"
} }
```

| Preference | Default | Controls |
|---|---|---|
| `NosWidgetAppGroup` | `group.<app bundle id>` | App Group id shared between app + widget (must be registered on both App IDs in the Apple portal) |
| `NosWidgetUrlScheme` | `nosapp` | deep-link URL scheme registered on the app (also pass to `configure({scheme})` so it matches at runtime) |
| `NosWidgetBundleSuffix` | `widget` | widget extension bundle-id suffix → `<app id>.<suffix>`; must match the extension's App ID / profile |
| `NosWidgetIosDeploymentTarget` | `14.0` | extension `IPHONEOS_DEPLOYMENT_TARGET` (raise to 16/17 for richer interactive widgets) |
| `NosWidgetDisplayName` | `NOS` | name shown for the extension (widget gallery context) |
| `NosWidgetExtensionName` | `NosWidgetExtension` | Xcode extension target / product name |
| `NosWidgetTeamId` | — | Apple Developer Team ID. **Setting Team + Profile switches the extension to Manual signing** (MABS/device) |
| `NosWidgetProfileSpecifier` | — | `PROVISIONING_PROFILE_SPECIFIER` (name or UUID) for the extension target |
| `NosWidgetProvisioningProfile` | — | path to the extension's `.mobileprovision`; the hook copies it into the build agent's `~/Library/MobileDevice/Provisioning Profiles/` ("Rung 1") |

When `NosWidgetTeamId` + `NosWidgetProfileSpecifier` are **unset**, the extension stays on **Automatic**
signing (Simulator / local), so the hook never breaks a normal build. See
[`research/2026-06-02-ecosystem-and-widget-research.md`](research/2026-06-02-ecosystem-and-widget-research.md) §1
for the full MABS signing story.

## Runtime options (`configure()` Client Action)

```js
cordova.plugins.nosWidgets.configure({
  scheme: 'acmeapp',        // deep-link scheme the widget builds links with (match NosWidgetUrlScheme)
  apiBaseUrl: 'https://…',  // endpoint the background worker fetches from
  refreshMinutes: 30        // background self-refresh cadence; Android enforces a 15-minute minimum
}, onOk, onErr);
```

`refreshMinutes` is runtime (not a build preference) because it only affects scheduling: it drives the
Android WorkManager period and the iOS WidgetKit timeline `.after` policy. Default `30`.

## Android toolchain (already in `plugin.xml`)

Pinned to match the OutSystems cordova-android 13 fork (do not split apart): Kotlin `1.9.24` (→ Compose
compiler `1.5.14`), `minSdk 23`, `compile/targetSdk 34`.

## Not configurable (internal contract — do not change per app)

The `writeData` payload shape (`balance` / `plan` / `data` / `minutes` / `sms` / `bill`), widget `kind`
identifiers, the deep-link host + paths (`widget/open`, `widget/pay`), storage keys, package names, and
brand colors (in `res/android/values*/nos_colors.xml` + iOS `Theme.swift`).
