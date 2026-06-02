# OutSystems forums/docs/Forge — native widgets & app extensions
(agent B1)

## Prior art: NONE (greenfield confirmed)
- **No native home-screen widget component on Forge** (iOS or Android). Forge "widget" components are all in-app UI (OutMon Core Widgets, Rich Widgets, Gadgets). https://www.outsystems.com/forge/list
- Community consensus (2 threads): native widgets ONLY via custom Cordova plugin, no public examples. https://www.outsystems.com/forums/discussion/32945/widgets-for-mobile-apps/ · https://www.outsystems.com/forums/discussion/79083/can-you-build-widgets-for-android-and-ios/
- App Clips / Instant Apps: MVP says "not possible" from OutSystems. https://www.outsystems.com/forums/discussion/91488/
- Siri Shortcuts plugin EXISTS but runs in-process (NO 2nd target) — the one shipped "extension-like" capability, and notably the kind needing no separate target. https://outsystems.com/forge/component-overview/5499/
- All push plugins (Firebase/OneSignal/Pushwoosh) are single-target; none ship a Notification Service/Content Extension.

## The second-target wall — documented, unresolved
- **[KEY] Notification Content Extension profile install FAILED in MABS sandbox**: hook writing to `~/Library/MobileDevice/Provisioning Profiles` got `ENOENT … scandir '/Users/sandbox04/Library/MobileDevice/Provisioning Profiles'`. 0 replies. https://www.outsystems.com/forums/discussion/80410/
  - **NUANCE (cross-ref our MABS log):** our analyzed MABS-12 log (ionic-cloud-team) DOES `ProcessProductPackaging … /Users/ionic-cloud-team/Library/MobileDevice/Provisioning Profiles/<uuid>.mobileprovision` — so the profiles dir EXISTS in current MABS. The old ENOENT (sandbox04) may be stale → the App Center-style "copy extra .mobileprovision into the dir via hook" workaround may now be viable. WORTH TESTING.
- **[KEY] OneSignal NSE on MABS — asked, answer "Sadly no", never resolved by staff.** https://www.outsystems.com/forums/discussion/41959/
- **[KEY] iOS Capabilities (App Groups)**: MVP Jorge Martins — enable App Groups in Apple portal (NOT OutSystems); use plugins `cordova-plugin-nsuserdefaults-for-app-groups`, `cordova-plugin-fdkeychain`; entitlements "might" be configurable via extensibility. https://www.outsystems.com/forums/discussion/50400/
- **Official Ideas: "Make OutSystems Support Android System Widgets" → DECLINED.** Staffer Filipe Fernandes (Aug 2022): "Not right now… not [on] our roadmap for the foreseeable future." https://www.outsystems.com/ideas/12194/

## Extensibility / MABS mechanics (official)
- **Extensibility Config JSON top-level keys = `plugin`, `preferences`, `resource` ONLY.** Cannot declare a 2nd native target; anything more lives in the referenced plugin's plugin.xml. https://success.outsystems.com/Documentation/11/Delivering_Mobile_Apps/Customize_Your_Mobile_App/Extensibility_Configurations_JSON_Schema
- Preferences ending in `UsageDescription` auto-inject into Info.plist. Deeper plist control via `<config-file target="*-Info.plist">` in plugin.xml (proven: alt-app-icon tutorial https://johnalvinsalamat.medium.com/personalize-ios-mobile-app-icon-in-outsystems-9e7442b22571).
- MABS internals blog: sandboxed macOS builder, **temporary keychain with "your certificate and provisioning profile"** (singular), Cordova template, only client code+plugins reach builder. Hooks: before/after prepare, before/after compile, before/after build (NOT deploy/run). https://www.outsystems.com/blog/posts/how-mobile-apps-build-service-works/
- Which hooks fire (staff): `after_plugin_add` works, `after_prepare` "might get to run", `after_deploy`/`after_run` never. https://www.outsystems.com/forums/discussion/55053/
- **Hooks can require `xcode` npm module BUT must ship a `package.json` (no shared NPM cache) or build fails "Cannot find module 'xcode'".** Corroborates need to vendor deps; alt to our committed-node_modules approach. https://raphael-ranieri.medium.com/upgrading-your-outsystems-cordova-plugins-to-use-android-14-target-api-34-and-mabs-10-cae82390a61d
- Official "create a Cordova plugin from scratch" + Template Plugin (Forge id 1676). https://www.outsystems.com/blog/posts/how-to-create-a-cordova-plugin-from-scratch/

## Provisioning model (the root constraint)
- Native Platforms Config UI accepts a SINGLE App ID + SINGLE profile per app. No field for a 2nd App ID/profile (extension). https://success.outsystems.com/Documentation/11/Delivering_Mobile_Apps/Generate_and_Distribute_Your_Mobile_App/Native_Platforms_Configuration
- One `.p12` cert can sign many apps; App IDs + profiles are per-app/unique. So the CERT isn't the blocker — the missing 2nd PROFILE slot is.
- **Multiple provisioning profiles in one MABS build: NOT SUPPORTED / NOT DOCUMENTED** (only evidence is the failed/unanswered attempts).

## Conclusions
1. No prior art for any 2nd-target feature (widget/App Clip/watch/share/NSE). 2. The wall is SIGNING, not code. 3. Only theoretical hook to add a target = after_plugin_add/after_prepare + `xcode` lib (our approach). 4. Official stance = "no/not planned"; community attempts unanswered.
