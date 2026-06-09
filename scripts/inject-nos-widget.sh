#!/usr/bin/env bash
#
# inject-nos-widget.sh — inject the NOS WidgetKit extension (.appex) into a MABS-built .ipa and
# re-sign it locally. This is the proven workaround for MABS silently dropping the plugin-injected
# widget extension before archive (see docs/outsystems-mabs-extension-escalation.md and
# docs/ios-widget-local-inject-workaround.md).
#
#   *** DEV / ad-hoc only — a re-signed build CANNOT be submitted to App Store / TestFlight. ***
#
# Prerequisites (the one hard requirement is the cert):
#   - The app's signing identity (.p12 = cert + private key) imported into your LOGIN keychain,
#     on the SAME Apple team as the profiles (e.g. "Apple Development: Pedro Matias (53N4BPWA5F)",
#     team 6N3U46YW3N). Verify with:  security find-identity -v -p codesigning
#   - A prebuilt, UNSIGNED NosWidgetExtension.appex (build it with cordova-ios 7.1.1 — see the doc).
#   - The widget provisioning profile (e.g. APP_Test_DEV_Widget.mobileprovision).
#   - The target iPhone's UDID present in BOTH the app and widget profiles (Development requirement).
#
# Usage:
#   IDENTITY="Apple Development: Pedro Matias (53N4BPWA5F)" \
#     ./scripts/inject-nos-widget.sh \
#       "<MABS .ipa>" "<NosWidgetExtension.appex>" "<widget.mobileprovision>" "<out.ipa>"
#
set -euo pipefail

IPA="${1:?usage: path to the MABS-built .ipa}"
APPEX="${2:?usage: path to the prebuilt NosWidgetExtension.appex}"
WPROF="${3:?usage: path to the widget .mobileprovision}"
OUT="${4:?usage: output .ipa path}"
IDENTITY="${IDENTITY:?set IDENTITY env var to your signing cert common name (security find-identity -v -p codesigning)}"

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
cp "$IPA" in.ipa && unzip -q in.ipa && rm in.ipa
APP="$(ls -d Payload/*.app | head -1)"
echo "[inject] app bundle: $APP"

# 1) inject the extension + its provisioning profile
mkdir -p "$APP/PlugIns"
cp -R "$APPEX" "$APP/PlugIns/"
EXT="$APP/PlugIns/$(basename "$APPEX")"
cp "$WPROF" "$EXT/embedded.mobileprovision"
echo "[inject] embedded $(basename "$APPEX") into PlugIns/"

# 2) entitlements: take the APP's real entitlements from its existing signature (most accurate),
#    and the WIDGET's from its provisioning profile.
codesign -d --entitlements :- "$APP" > app-entitlements.plist 2>/dev/null
security cms -D -i "$WPROF" > w.plist
/usr/libexec/PlistBuddy -x -c "Print :Entitlements" w.plist > widget-entitlements.plist

# 3) re-sign bottom-up: frameworks -> .appex -> app (so the app's seal covers PlugIns/)
if [ -d "$APP/Frameworks" ]; then
  find "$APP/Frameworks" -maxdepth 1 \( -name '*.framework' -o -name '*.dylib' \) \
    -exec codesign --force --sign "$IDENTITY" --timestamp=none {} \;
fi
codesign --force --sign "$IDENTITY" --entitlements widget-entitlements.plist \
  --generate-entitlement-der --timestamp=none "$EXT"
codesign --force --sign "$IDENTITY" --entitlements app-entitlements.plist \
  --generate-entitlement-der --timestamp=none "$APP"

# 4) verify + repackage
codesign --verify --deep --strict --verbose=2 "$APP"
rm -f "$OUT"
zip -qry "$OUT" Payload
echo "[inject] OK -> $OUT"
echo "[inject] install with:  xcrun devicectl device install app --device <UDID> \"$OUT\""
