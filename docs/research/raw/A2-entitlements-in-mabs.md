# How OutSystems plugins declare/inject iOS entitlements under MABS
(agent A2)

## THE CONVENTION (verified across 5 plugins)
OS plugins NEVER ship a `.entitlements` file and NEVER use `<edit-config>`. They inject entitlement KEYS via Cordova `<config-file>` into plist files the MABS-generated Xcode project ALREADY contains:
- `*-Debug.plist` / `*-Release.plist` (legacy per-build entitlements), and/or
- `*/Entitlements-Debug.plist` / `*/Entitlements-Release.plist` (at `platforms/ios/<App>/Entitlements-{Debug,Release}.plist`).
Hooks only READ/WRITE those already-existing plists (plist.parse/build). Cordova/MABS hooks do NOT create them and do NOT touch project.pbxproj.

### Exact mechanism per plugin
- **FCM / push** (`cordova-outsystems-firebase-cloud-messaging`, `outsystems-phonegap-plugin-push`):
  ```xml
  <config-file target="*-Info.plist" parent="UIBackgroundModes"><array><string>remote-notification</string></array></config-file>
  <config-file target="*-Debug.plist"   parent="aps-environment"><string>development</string></config-file>
  <config-file target="*-Release.plist" parent="aps-environment"><string>production</string></config-file>
  ```
- **HealthKit** (`cordova-outsystems-healthfitness`): `<config-file target="*/Entitlements-Debug.plist" parent="com.apple.developer.healthkit"><true/></config-file>` (+ `.access`, `.background-delivery`, `-Release` twins).
- **Sign in with Apple** (`cordova-outsystems-sociallogins`): `<config-file target="*/Entitlements-Debug.plist" parent="com.apple.developer.applesignin"><array><string>Default</string></array></config-file>` (+ Release). Hook only DELETES the key if disabled. (Deep links via `CFBundleURLTypes`, not associated-domains.)
- **Apple Pay** (`cordova-outsystems-payments`): config-file `com.apple.developer.in-app-payments` into `*-Debug/Release.plist` + hook rewrites pre-existing `Entitlements-{Debug,Release}.plist` with merchant id.

### The ONE pbxproj-editing precedent (Capacitor/ODC only)
`cordova-outsystems-payments/hooks/capacitorCopyPreferences.js` is the only org code that CREATES an `.entitlements` and edits pbxproj:
```js
const xcode = require('xcode');
// writes App/App.entitlements with com.apple.developer.in-app-payments
project.addBuildProperty('CODE_SIGN_ENTITLEMENTS', `App/App.entitlements`, 'Release', target);
project.addBuildProperty('CODE_SIGN_ENTITLEMENTS', `App/App.entitlements`, 'Debug', target);
```
…but only on `getFirstTarget()` (the MAIN target). NO second target. NO App Group.

## MABS does NOT auto-provision capabilities (doc-confirmed)
- MABS-10 release note RNMT-5935 (`docs-support/src/release-articles/mabs/mabs-10.md`): "Removed functionality that was specifically adding `aps-environments` to plist… This should be handled by each plugin… not generically by MABS."
- Error OS-MABS-SIG-40001 (`docs-support/src/error/mabs/mabs-sig-40001.md`): entitlement value must MATCH the uploaded provisioning profile or signing fails.
- `docs-product/.../publish-apple-app-store.md`: one `.p12` + one `.mobileprovision`, single bundle id. No per-target/capability UI.

## Org-wide App Group search = ZERO
`gh search code --owner OutSystems 'com.apple.security.application-groups'` → 0. `'application-groups'` → 0. `'App Group'` → only incidental. **No OutSystems plugin/tooling anywhere declares an App Group.** We'd be first.

## IMPLICATIONS FOR US
1. **App-side App Group entitlement = SOLVED pattern.** Add to the MAIN app via the proven convention:
   `<config-file target="*/Entitlements-Debug.plist" parent="com.apple.security.application-groups"><array><string>group.<id></string></array></config-file>` (+ `-Release`). Do NOT ship a .entitlements file. Ensure the App ID has the App Groups capability enabled in Apple portal (MABS won't add it).
2. **Widget's SECOND target = net-new.** Nothing in the org adds a 2nd target; config-file/source-file can't. Needs a custom after_prepare hook (our approach) or a MABS build-action.
3. **MABS single-profile manual signing = the real blocker** for the extension's own bundle id/profile. Confirmed by docs.
