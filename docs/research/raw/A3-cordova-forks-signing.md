# OutSystems cordova-ios/android forks — signing & target injection
(agent A3) — investigated OutSystems/cordova-ios@7.1.1+2.0.0 (exact MABS 12 build), cordova-android@rel/13.0.0, cordova-plugin-add-swift-support@2.0.3-OS2

## LINCHPIN: cordova-ios build.json supports a per-target provisioning-profile MAP
The single `provisioningProfile` key accepts a STRING **or an OBJECT** `{ bundleId: profileNameOrUUID }`. Two consumers (verified in lib/build.js @ the exact MABS tag):
- **(A) archive stage** writes `cordova/build-extras.xcconfig` → if object, uses only `profile[keys[0]]` as ONE global `PROVISIONING_PROFILE_SPECIFIER` (first entry only).
  ```js
  } else { const keys = Object.keys(buildOpts.provisioningProfile);
    extraConfig += `PROVISIONING_PROFILE_SPECIFIER = ${buildOpts.provisioningProfile[keys[0]]}\n`; }
  ```
- **(B) export stage** writes `exportOptions.plist` → if object, passes the FULL map to `xcodebuild -exportArchive` for TRUE PER-TARGET signing:
  ```js
  } else { events.emit('log','Setting multiple provisioning profiles for signing');
    exportOptions.provisioningProfiles = buildOpts.provisioningProfile; }
  exportOptions.signingStyle = 'manual';
  ```
**So the plumbing to sign a 2nd target (our widget) with its own profile ALREADY EXISTS at the export stage** — IF MABS writes a 2-entry map into keys/build.json.
- This is UPSTREAM Apache (PR #1251 "support multiple provisioning profiles") — byte-identical in the OS fork. No OS patch touches the signing path.
- `CODE_SIGN_STYLE` forced to `Manual` whenever a profile is set (`writeCodeSignStyle` → `updateBuildProperty('CODE_SIGN_STYLE','Manual')` + `addTargetAttribute('ProvisioningStyle','Manual')`) — matches our log exactly.
- Upstream PR #1438 (commit 91f8a7f9, present in this tag): `CODE_SIGN_ENTITLEMENTS` is set PER-TARGET in the pbxproj.

## The gap
MABS controls `keys/build.json` generation (NOT in these repos — couldn't inspect). All other evidence says MABS injects a SINGLE profile → archive xcconfig gets one global specifier and the export map has only the app's bundle id → our extension target has no valid profile. **The open question for OutSystems: can MABS 12 emit a multi-entry `provisioningProfile` map?** If yes, second-target signing works with ZERO hooks.

## Two injection points (both validated by code in-org)
1. **after_prepare hook using node-xcode** (MOST ROBUST): set the extension target's per-config build settings in pbxproj — `PROVISIONING_PROFILE_SPECIFIER`, `DEVELOPMENT_TEAM`, `CODE_SIGN_STYLE=Manual`, `CODE_SIGN_ENTITLEMENTS`, `PRODUCT_BUNDLE_IDENTIFIER` — via `updateBuildProperty(KEY,VALUE,configName)`. Per-target pbxproj settings override the global xcconfig. Still needs the extension's `.mobileprovision` PRESENT (App Center-style: copy into `~/Library/MobileDevice/Provisioning Profiles/` — which EXISTS in current MABS per our log).
2. **exportOptions.plist map via build.json** (zero hooks) — depends entirely on MABS emitting the map.

## add-swift-support = direct precedent for OUR hook + vendoring
- `<hook type="after_prepare" src="src/add-swift-support.js"/>` → `xcode.project(pbxprojPath).parseSync()` → `updateBuildProperty(...)` per build config → `writeSync()`. Same node-xcode `^3.0.1`.
- **OS commit e37bd5c7: "added xcode dependency (for compatibility issues with MABS)"** — OutSystems THEMSELVES vendor node-xcode so the hook runs in MABS. This is EXACTLY what we did. Direct validation of our vendoring task.

## cordova-android (signing = non-issue)
- Defaults @ rel/13.0.0: **Gradle 8.7, AGP 8.3.0, Kotlin 1.9.24, minSdk 24, compile/targetSdk 34, build-tools 34.0.0.** (MABS log showed Gradle 8.11.1 — the +1.1.0 OS suffix likely bumps it.) **Our Glance Compose-compiler must match Kotlin 1.9.24 (→ Compose Compiler 1.5.14).**
- Keystore-based single signing; an Android App Widget/Glance compiles into the one APK/AAB, signed once. **No per-target signing. Android is NOT a constraint.** OS android lib/build.js byte-identical to upstream.

## Source URLs
- https://github.com/OutSystems/cordova-ios/blob/7.1.1+2.0.0/lib/build.js (lines 32-43,118-134,176-211,248-256)
- https://github.com/OutSystems/cordova-ios/blob/7.1.1+2.0.0/lib/projectFile.js
- apache PR #1251 (multi-profile), apache PR #1438 (target-level entitlements)
- https://github.com/OutSystems/cordova-plugin-add-swift-support/blob/2.0.3-OS2/src/add-swift-support.js
- https://github.com/OutSystems/cordova-android/blob/rel/13.0.0/framework/cdv-gradle-config-defaults.json
