# iOS provisioning checklist — NOS Widgets

Hand-off task for whoever has the **Apple Developer "Admin" (or "App Manager")** role. This is the
only thing standing between the current state and a successful iOS build: the plugin itself is
already validated end-to-end in MABS — the build only fails because the **App Group capability isn't
set up in the Apple Developer portal yet**.

## The exact identifiers (use these verbatim)

| What | Value |
|---|---|
| App bundle id (main target) | `pt.nos.osatmospheretest` |
| Widget extension bundle id | `pt.nos.osatmospheretest.widget` |
| App Group | `group.pt.nos.osatmospheretest` |

The widget extension is a **second iOS target** that shares data with the app through the App Group.
Apple requires: an **explicit** App ID per target (App Groups can't live on a wildcard App ID), the
App Group enabled + assigned on **both**, and a provisioning profile per target.

## Why the last build failed (for context)
```
Provisioning profile "APP Test Enablers" doesn't support the App Groups capability /
group.pt.nos.osatmospheretest / com.apple.security.application-groups entitlement
(in target 'Outsystems Test App (Only DEV)')  →  ** ARCHIVE FAILED **
```
The plugin correctly added the App Group entitlement to the app; the app's current profile just
doesn't carry that capability. Fixing the portal (below) clears it.

---

## Prerequisites
- Apple Developer Program access with **Admin / App Manager** role.
- The **signing certificate** already used for this app (the one behind "APP Test Enablers").
- Decide the **build type** and make every profile below match it:
  - **Development** — for installing on registered test devices (what the current Debug build is).
  - **Distribution** (App Store / In-House) — for store / enterprise distribution.

> Everything happens in **Certificates, Identifiers & Profiles** at https://developer.apple.com/account → Certificates, IDs & Profiles.

## Step 1 — Register the App Group
1. Identifiers → **＋** → **App Groups** → Continue.
2. Description: `NOS Widgets App Group` · Identifier: **`group.pt.nos.osatmospheretest`**
3. Continue → Register.

## Step 2 — App ID for the MAIN app (explicit + App Groups)
1. Identifiers → look for an **explicit** App ID `pt.nos.osatmospheretest`.
   - If it doesn't exist (e.g. the app is currently signed with a wildcard/shared profile): **＋** → **App IDs** → **App** → Continue → Bundle ID = **Explicit** → `pt.nos.osatmospheretest`.
2. In its **Capabilities**, enable **App Groups**.
   - ⚠️ Also keep enabled **every capability the app already uses** (Push Notifications, Associated Domains, etc.) — the new/updated profile must not drop them, or the app will lose push/deep-links.
3. Click **App Groups → Configure/Edit** → tick **`group.pt.nos.osatmospheretest`** → Save.

## Step 3 — App ID for the WIDGET extension (explicit + App Groups)
1. Identifiers → **＋** → **App IDs** → **App** → Continue.
2. Description: `NOS Widget Extension` · Bundle ID = **Explicit** → **`pt.nos.osatmospheretest.widget`**
3. Enable **App Groups** → Register.
4. **App Groups → Configure** → tick the **same** `group.pt.nos.osatmospheretest` → Save.

## Step 4 — Provisioning profiles (one per App ID, same type)
1. **Main app profile** — Profiles → **＋** → choose *Development* (or *Distribution*) → App ID `pt.nos.osatmospheretest` → select the certificate → (Development: select test devices) → Name: `NOS Test App` → Generate → **Download**.
2. **Widget profile** — Profiles → **＋** → same type → App ID `pt.nos.osatmospheretest.widget` → same certificate → (same devices) → Name: `NOS Test Widget` → Generate → **Download**.
3. Note the **exact widget profile name** (`NOS Test Widget`) — or its UUID — you'll need it for OutSystems.

---

## Step 5 — OutSystems configuration

### 5a. Main app signing (Distribute → Native Platforms → iOS)
- Bundle id: `pt.nos.osatmospheretest`
- Upload the **new main-app provisioning profile** (`NOS Test App`, the one that now has App Groups) — this **replaces** "APP Test Enablers".
- Keep the same signing **certificate (.p12)**.

→ This alone clears the failure you saw (the app target will sign).

### 5b. Widget extension signing (Extensibility Configuration → `plugin.variables`)
```json
{
  "plugin": {
    "url": "https://github.com/rpgomes-code/os-cordova-plugin-nos-widgets#0.5.0",
    "variables": [
      { "name": "NOS_WIDGET_URL_SCHEME",           "value": "pt.nos.osatmospheretest" },
      { "name": "NOS_WIDGET_APP_GROUP",            "value": "group.pt.nos.osatmospheretest" },
      { "name": "NOS_WIDGET_TEAM_ID",              "value": "<YOUR 10-CHAR TEAM ID>" },
      { "name": "NOS_WIDGET_PROFILE_SPECIFIER",    "value": "NOS Test Widget" },
      { "name": "NOS_WIDGET_PROVISIONING_PROFILE", "value": "widget.mobileprovision" }
    ]
  }
}
```
- `NOS_WIDGET_TEAM_ID` — the 10-character Team ID (Membership page, top-right).
- `NOS_WIDGET_PROFILE_SPECIFIER` — the widget profile **name** (`NOS Test Widget`) or its UUID.
- Setting Team + Specifier flips the widget target to **Manual** signing against that profile.

## Step 6 — Get the widget profile onto the MABS build agent
MABS only ingests the **single** profile from Step 5a (the main app's). The widget's profile reaches
the build agent as an **OutSystems module Resource** (recommended — keeps it out of the public repo):

1. **Service Studio** → add `widget.mobileprovision` as a **Resource** of the app module (Deploy Action
   `Do Nothing` is fine; it's not a server file). Its **Runtime Path** (e.g.
   `/NOSWidgetsPlugin/widget.mobileprovision`) is where MABS bundles it, under the app's `www/`.
2. Set `NOS_WIDGET_PROVISIONING_PROFILE` to just the **filename** — `widget.mobileprovision`. As of
   plugin **0.5.0** the iOS hook scans the generated Cordova project tree for that filename and copies
   whatever it finds into the agent's `~/Library/MobileDevice/Provisioning Profiles/`, so the exact MABS
   path doesn't matter. (You may also give an explicit project-root-relative path, e.g.
   `www/NOSWidgetsPlugin/widget.mobileprovision`.)

> A `.mobileprovision` is not a private key (the secret is the `.p12`), but shipping it as a Resource
> still keeps signing assets out of the public repo.

**Alternative (cleaner long-term — OutSystems Support ask):** request that MABS emit a 2-entry
`provisioningProfile` map (bundle id → profile) in `build.json`; cordova-ios already supports it at the
export stage, so nothing needs shipping. (See `docs/research/2026-06-02-ecosystem-and-widget-research.md` §1.)

## Verify
Rebuild the iOS app in MABS and check the log:
- `[nos-widgets] extension signing: Manual (team=…, profile="NOS Test Widget")`
- `[nos-widgets] installed widget provisioning profile -> …` (if using Option A)
- `** ARCHIVE SUCCEEDED **` and an `.ipa` produced.

If it still fails, the error message names the exact target + missing capability — send the log and
it'll pinpoint the remaining gap.
