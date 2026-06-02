# Signing a Second iOS Target (App Extension / WidgetKit) in Cloud/CI Build Systems
(agent 3 — cloud-build extension signing)

## Headline
- **cordova-ios `build.json` supports a bundle-id → profile-UUID MAP for multiple targets** (verified in `lib/build.js`; PR #1251 merged 2022-09-05; ships in cordova-ios 7.x). When `provisioningProfile` is an OBJECT, it's written to `exportOptions.plist` `provisioningProfiles`. MABS uses cordova-ios 7.1.1 → the plumbing MAY already exist.
  - Caveats: published cordova docs only document the single-GUID string form (feature is under-documented — cite the PR/source, not docs); and the `PROVISIONING_PROFILE_SPECIFIER` build-setting fallback only uses the FIRST key (export-options path is the one that works).
  - Intended shape:
    ```json
    { "ios": { "release": { "provisioningProfile": {
      "app.package.name":        "UUID-1",
      "app.package.name.widget": "UUID-2" } } } }
    ```

## Apple baseline (non-negotiable)
- Explicit (non-wildcard) App ID per target; a wildcard App ID can't carry App Group entitlements.
- A provisioning profile per target (app + widget = 2 profiles).
- App Group registered once, then ENABLED + ASSIGNED on BOTH App IDs (app + extension). Verbatim portal steps captured.
- Each target's `.entitlements` needs `com.apple.security.application-groups` with the `group.*` id.
- Automatic signing: provider auto-creates App IDs/profiles/App Groups (EAS, Codemagic). Manual (MABS's mode): everything supplied out-of-band, mapped per bundle id.

## Per-tool comparison
| System | 2nd-target signing | How extra profile supplied | App Group |
|---|---|---|---|
| cordova-ios build.json | Yes (src, PR #1251, cordova-ios 7.x) | `provisioningProfile` object → exportOptions.plist | out of band |
| Ionic Appflow | Yes (Dec 2020) | upload app + extension profiles | out of band |
| Expo EAS | Yes (declarative + auto-gen) | `extra.eas...ios.appExtensions[]` / credentials.json | AUTO-registers & assigns |
| MS App Center | NO (UI single profile) | post-clone script copies extra .mobileprovision | out of band |
| VoltBuilder | not documented (likely no) | fixed single dev/dist pair | n/a |
| Bitrise | Yes | upload profile(s) + installer step before archive | out of band |
| Codemagic | Yes | auto-match `app.*`, or list in YAML | out of band / auto |

## Most instructive precedent — Microsoft App Center
Closest analog to MABS (single-profile UI). Documented community workaround: a **post-clone script copies the extra `.mobileprovision` into `~/Library/MobileDevice/Provisioning Profiles/`** so Xcode finds it at build time (MicrosoftDocs/appcenter-docs issues #48, #55). Transfers directly to MABS IF MABS exposes any pre-build hook.

## Fastlane primitives
- `match(app_identifier: [app, ext])` — array of bundle ids in one call; use `readonly: is_ci`.
- `sigh -a <id>` — one invocation per bundle id.
- `update_code_signing_settings` (replaces deprecated `automatic_code_signing`) — per-target manual signing; params incl. `targets`, `profile_name`, `profile_uuid`, `bundle_identifier`. Call once per target.

## Three asks to frame for OutSystems MABS (in preference order)
1. **Accept multiple profiles mapped by bundle id** (Appflow/Bitrise/Codemagic do this). Ask if MABS will pass a `build.json` `provisioningProfile` OBJECT — may already work on cordova-ios 7.x. Lowest-effort.
2. **Expose a pre-build / post-clone hook** (App Center style) so we ship the widget `.mobileprovision` + a script copies it into the profiles dir.
3. **ASC API automatic signing** (cordova-ios 7 `authenticationKey*` + `automaticProvisioning`) — auto-creates App IDs/App Group/profiles. Biggest change, cleanest long-term.

Apple-side prereqs are OURS regardless: explicit `…widget` App ID, register 1 App Group, enable+assign on both App IDs, entitlements on both targets, generate 2 profiles. MABS only needs to CONSUME them (or auto-gen via option 3).

## Key sources
- cordova-ios PR #1251 (merged): https://github.com/apache/cordova-ios/pull/1251
- cordova-ios lib/build.js: https://raw.githubusercontent.com/apache/cordova-ios/master/lib/build.js
- cordova-ios 7.0.0 (ASC API auth): https://cordova.apache.org/announcements/2023/07/10/cordova-ios-7.0.0.html
- fastlane match/sigh/update_code_signing_settings: https://docs.fastlane.tools/actions/match/ , /sigh/ , /update_code_signing_settings/
- Expo EAS app extensions: https://docs.expo.dev/build-reference/app-extensions/ ; iOS capabilities: https://docs.expo.dev/build-reference/ios-capabilities/
- App Center workaround: https://github.com/MicrosoftDocs/appcenter-docs/issues/55 , /issues/48
- Codemagic iOS signing: https://docs.codemagic.io/yaml-code-signing/signing-ios/
- Apple portal — enable capabilities: https://developer.apple.com/help/account/identifiers/enable-app-capabilities ; register app group: https://developer.apple.com/help/account/manage-identifiers/register-an-app-group/

(Flagged: Apple's JS-rendered reference pages — QA1713, application-groups entitlement, configuring-app-groups — gave title-only; substance corroborated via the rendering portal help pages + secondary docs.)
