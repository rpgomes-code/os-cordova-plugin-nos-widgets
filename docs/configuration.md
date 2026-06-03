# Configuration reference

Everything an OutSystems app can tune without forking the plugin. Two mechanisms:
**build-time variables** (set as plugin variables in the Extensibility Configuration) and **runtime
options** (passed to the JS `configure()` Client Action).

## Build-time configuration (Extensibility Configuration → `plugin.variables`)

Set these as **plugin variables** in the OutSystems app's Extensibility Configuration. All are
**optional** — each has a non-empty default, so an unconfigured Android-only / Simulator build needs
none of them. cordova substitutes them into `config.xml` at install time, where the iOS
`after_prepare` hook reads them.

```json
{
  "plugin": {
    "url": "https://github.com/rpgomes-code/os-cordova-plugin-nos-widgets#0.2.0",
    "variables": [
      { "name": "NOS_WIDGET_URL_SCHEME",           "value": "pt.nos.myapp" },
      { "name": "NOS_WIDGET_APP_GROUP",            "value": "group.pt.nos.myapp" },
      { "name": "NOS_WIDGET_TEAM_ID",              "value": "ABCDE12345" },
      { "name": "NOS_WIDGET_PROFILE_SPECIFIER",    "value": "MyApp Widget Dev" },
      { "name": "NOS_WIDGET_PROVISIONING_PROFILE", "value": "profiles/widget.mobileprovision" }
    ]
  }
}
```

| Variable | Default | Controls |
|---|---|---|
| `NOS_WIDGET_URL_SCHEME` | `nosapp` | deep-link URL scheme registered on the app (pass the same value to `configure({scheme})` so it matches at runtime) |
| `NOS_WIDGET_APP_GROUP` | derived `group.<app bundle id>` | App Group id shared between app + widget (must be registered on both App IDs in the Apple portal) |
| `NOS_WIDGET_BUNDLE_SUFFIX` | `widget` | widget extension bundle-id suffix → `<app id>.<suffix>`; must match the extension's App ID / profile |
| `NOS_WIDGET_IOS_DEPLOYMENT_TARGET` | `14.0` | extension `IPHONEOS_DEPLOYMENT_TARGET` (raise to 16/17 for richer interactive widgets) |
| `NOS_WIDGET_DISPLAY_NAME` | `NOS` | name shown for the extension (widget gallery context) |
| `NOS_WIDGET_EXTENSION_NAME` | `NosWidgetExtension` | Xcode extension target / product name |
| `NOS_WIDGET_TEAM_ID` | (unset) | Apple Developer Team ID. **Setting Team + Profile switches the extension to Manual signing** (MABS/device) |
| `NOS_WIDGET_PROFILE_SPECIFIER` | (unset) | `PROVISIONING_PROFILE_SPECIFIER` (name or UUID) for the extension target |
| `NOS_WIDGET_PROVISIONING_PROFILE` | (unset) | path to the extension's `.mobileprovision`; the hook copies it into the build agent's `~/Library/MobileDevice/Provisioning Profiles/` ("Rung 1") |

The "unset" variables use a `__unset__` sentinel default internally (cordova requires a non-empty
default, otherwise the variable becomes mandatory at install); the hook treats `__unset__` as empty
and falls back. So when `NOS_WIDGET_TEAM_ID` + `NOS_WIDGET_PROFILE_SPECIFIER` are not provided, the
extension stays on **Automatic** signing (Simulator / local) and a normal build is never broken. See
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
