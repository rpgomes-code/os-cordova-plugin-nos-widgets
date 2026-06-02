'use strict';

/**
 * Cordova after_prepare hook (iOS): injects a WidgetKit app-extension target into the
 * generated Xcode project, because Cordova's <source-file> can only add files to the MAIN
 * app target — it cannot create a second target.
 *
 * It:
 *   - copies the widget Swift sources into platforms/ios/<EXT>/
 *   - generates the extension Info.plist (+ App Group key) and entitlements for BOTH targets
 *   - creates the app-extension target, its build phases, frameworks and build settings
 *   - embeds the .appex into the app and adds the target dependency
 *   - sets the App Group entitlement + IPHONEOS_DEPLOYMENT_TARGET
 *
 * Signing (all OPTIONAL, settable per-app via the OutSystems Extensibility Configuration /
 * config.xml preferences, or env vars for local testing):
 *   - NosWidgetAppGroup            App Group id (default: group.<app bundle id>)
 *   - NosWidgetTeamId              DEVELOPMENT_TEAM for the extension (presence enables Manual signing)
 *   - NosWidgetProfileSpecifier    PROVISIONING_PROFILE_SPECIFIER for the extension target
 *   - NosWidgetProvisioningProfile path to a .mobileprovision to install into the build agent's
 *                                  ~/Library/MobileDevice/Provisioning Profiles/ (the MABS "Rung 1"
 *                                  App-Center-style workaround)
 * When team+profile are NOT set, the extension stays on Automatic signing (Simulator / local dev),
 * so this hook never breaks a normal build.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PLUGIN_ID = 'os-cordova-plugin-nos-widgets';
// Overridable per-app via config.xml preferences (read in the hook body): see NosWidget* prefs.
let EXT_NAME = 'NosWidgetExtension';
let DEPLOYMENT_TARGET = '14.0';

module.exports = function (context) {
    const projectRoot = context.opts.projectRoot;
    const iosDir = path.join(projectRoot, 'platforms', 'ios');
    if (!fs.existsSync(iosDir)) { return; }

    const xcode = loadXcode(projectRoot);
    if (!xcode) { console.error('[nos-widgets] xcode module not found; skipping iOS extension.'); return; }

    const projName = fs.readdirSync(iosDir).find((f) => f.endsWith('.xcodeproj'));
    if (!projName) { console.error('[nos-widgets] no .xcodeproj found.'); return; }
    const appName = projName.replace('.xcodeproj', '');
    const pbxPath = path.join(iosDir, projName, 'project.pbxproj');

    const proj = xcode.project(pbxPath);
    proj.parseSync();

    // Optional, OutSystems-configurable preferences (read from config.xml, or an env var for local
    // testing). All have safe fallbacks, so an unconfigured Simulator/local build is unchanged.
    const cfgXml = readConfigXml(iosDir, appName, projectRoot);
    const pref = function (cfgName, envName, fallback) {
        if (envName && process.env[envName]) { return process.env[envName]; }
        const m = cfgXml.match(new RegExp('<preference\\s+name="' + cfgName + '"\\s+value="([^"]*)"'));
        return (m && m[1]) ? m[1] : fallback;
    };
    // Target shape / branding (all optional, defaulting to the historical hardcoded values).
    EXT_NAME = pref('NosWidgetExtensionName', 'NOS_WIDGET_EXTENSION_NAME', 'NosWidgetExtension');
    DEPLOYMENT_TARGET = pref('NosWidgetIosDeploymentTarget', 'NOS_WIDGET_IOS_DEPLOYMENT_TARGET', '14.0');
    const bundleSuffix = pref('NosWidgetBundleSuffix', 'NOS_WIDGET_BUNDLE_SUFFIX', 'widget');
    const displayName = pref('NosWidgetDisplayName', 'NOS_WIDGET_DISPLAY_NAME', 'NOS');
    const urlScheme = pref('NosWidgetUrlScheme', 'NOS_WIDGET_URL_SCHEME', 'nosapp');
    const signing = {
        teamId: pref('NosWidgetTeamId', 'NOS_WIDGET_TEAM_ID', ''),
        profileSpecifier: pref('NosWidgetProfileSpecifier', 'NOS_WIDGET_PROFILE_SPECIFIER', ''),
        profilePath: pref('NosWidgetProvisioningProfile', 'NOS_WIDGET_PROVISIONING_PROFILE', '')
    };

    if (extensionTargetExists(proj)) {
        console.log('[nos-widgets] extension target already present; skipping injection.');
        return;
    }

    const mainBundleId = getBundleIdFromConfig(projectRoot) || getMainBundleId(proj) || ('com.nos.' + appName.toLowerCase());
    const appGroup = pref('NosWidgetAppGroup', 'NOS_WIDGET_APP_GROUP', '') || ('group.' + mainBundleId);
    const extBundleId = mainBundleId + '.' + bundleSuffix;

    // 1. Copy widget Swift sources into platforms/ios/<EXT_NAME>/
    const widgetSrcDir = path.join(projectRoot, 'plugins', PLUGIN_ID, 'src', 'ios', 'widget');
    const extDir = path.join(iosDir, EXT_NAME);
    if (!fs.existsSync(extDir)) { fs.mkdirSync(extDir, { recursive: true }); }
    const swiftFiles = fs.readdirSync(widgetSrcDir).filter((f) => f.endsWith('.swift'));
    swiftFiles.forEach((f) => fs.copyFileSync(path.join(widgetSrcDir, f), path.join(extDir, f)));

    // 2. Generate Info.plist + entitlements
    const infoPlistName = EXT_NAME + '-Info.plist';
    fs.writeFileSync(path.join(extDir, infoPlistName), widgetInfoPlist(appGroup, displayName));
    const extEntName = EXT_NAME + '.entitlements';
    fs.writeFileSync(path.join(extDir, extEntName), entitlements(appGroup));
    // App target: add the App Group to cordova's EXISTING entitlements files (already referenced
    // by the app target as CODE_SIGN_ENTITLEMENTS). Overriding that setting proved flaky.
    ['Debug', 'Release'].forEach(function (cfg) {
        addAppGroupToEntitlements(path.join(iosDir, appName, 'Entitlements-' + cfg + '.plist'), appGroup);
    });
    patchAppInfoPlist(path.join(iosDir, appName, appName + '-Info.plist'), appGroup);
    ensureUrlScheme(path.join(iosDir, appName, appName + '-Info.plist'), urlScheme);

    // 3. pbxproj: group + target
    const pbxGroupKey = proj.pbxCreateGroup(EXT_NAME, EXT_NAME);
    const mainGroup = proj.getFirstProject().firstProject.mainGroup;
    proj.addToPbxGroup(pbxGroupKey, mainGroup);

    const target = proj.addTarget(EXT_NAME, 'app_extension', EXT_NAME, extBundleId);

    proj.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', target.uuid);
    proj.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
    proj.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);

    swiftFiles.forEach((f) => {
        // Path is relative to the group, which already has path EXT_NAME — do NOT prefix it again
        // (doing so produced "NosWidgetExtension/NosWidgetExtension/Foo.swift" / file-not-found).
        proj.addSourceFile(f, { target: target.uuid }, pbxGroupKey);
    });
    // Info.plist as a plain group file (referenced via INFOPLIST_FILE, not built)
    proj.addFile(infoPlistName, pbxGroupKey);

    ['WidgetKit.framework', 'SwiftUI.framework'].forEach((fw) => {
        proj.addFramework('System/Library/Frameworks/' + fw,
            { target: target.uuid, weak: true, sourceTree: 'SDKROOT' });
    });

    // 4. node-xcode's addTarget('app_extension') already creates the embed ("Copy Files") phase
    //    that copies the .appex into the host app — re-adding it caused "Unexpected duplicate
    //    tasks". It does NOT add the build-order dependency, so add only that here.
    proj.addTargetDependency(proj.getFirstTarget().uuid, [target.uuid]);

    // 5. Rung 1 (MABS): install the widget's provisioning profile into the build agent's profiles
    //    dir (App-Center-style) so xcodebuild can manual-sign the extension target. No-op if unset.
    maybeInstallProvisioningProfile(projectRoot, signing.profilePath);

    // 6. Build settings for the extension configurations (incl. signing).
    applyExtensionBuildSettings(proj, extBundleId, infoPlistName, extEntName, signing);

    fs.writeFileSync(pbxPath, proj.writeSync());
    console.log('[nos-widgets] WidgetKit extension injected (appGroup=' + appGroup + ', deploymentTarget=' + DEPLOYMENT_TARGET + ').');
};

// ---------------------------------------------------------------------------- helpers

function extensionTargetExists(proj) {
    // Reliable idempotency check: scan the native target section for our target by name.
    // (pbxTargetByName proved unreliable here and let the hook re-inject on every prepare.)
    const targets = proj.pbxNativeTargetSection();
    return Object.keys(targets).some(function (k) {
        const t = targets[k];
        return t && typeof t === 'object' &&
            (t.name === EXT_NAME || t.name === '"' + EXT_NAME + '"');
    });
}

function loadXcode(projectRoot) {
    const candidates = [
        // 1. Vendored copy committed inside the plugin (node_modules/, declared in
        //    bundleDependencies). MABS fetches the plugin from git and does NOT `npm install` its
        //    dependencies, so this committed copy is the primary, self-contained source.
        path.resolve(__dirname, '..', 'node_modules', 'xcode'),
        // 2. Fallbacks — `xcode` is also a dependency of cordova-ios, so it is present in the host
        //    project's node_modules during ANY iOS build (including MABS) even if, on some npm
        //    version, the vendored copy were stripped while packing the plugin.
        'xcode',
        path.join(projectRoot, 'node_modules', 'xcode'),
        path.join(projectRoot, 'node_modules', 'cordova-ios', 'node_modules', 'xcode'),
    ];
    for (const c of candidates) {
        try {
            const mod = require(c);
            console.log('[nos-widgets] resolved xcode from: ' + require.resolve(c));
            return mod;
        } catch (e) { /* try next candidate */ }
    }
    return null;
}

function readConfigXml(iosDir, appName, projectRoot) {
    const candidates = [
        path.join(iosDir, appName, 'config.xml'),   // platform config (preferences merged at prepare)
        path.join(projectRoot, 'config.xml')         // app config (fallback)
    ];
    for (const p of candidates) {
        try { return fs.readFileSync(p, 'utf8'); } catch (e) { /* try next */ }
    }
    return '';
}

// Rung 1 (MABS): copy the widget's provisioning profile into the build agent's profiles dir so
// xcodebuild can manual-sign the extension. Renames to <UUID>.mobileprovision when extractable.
// Pure no-op (with a log) when unconfigured or the file is missing — never breaks a build.
function maybeInstallProvisioningProfile(projectRoot, profilePath) {
    if (!profilePath) {
        console.log('[nos-widgets] no widget provisioning profile configured; skipping profile install (Simulator/local, or MABS-managed signing).');
        return;
    }
    const candidates = [
        path.isAbsolute(profilePath) ? profilePath : null,
        path.resolve(projectRoot, profilePath),
        path.join(projectRoot, 'plugins', PLUGIN_ID, profilePath)
    ].filter(Boolean);
    const src = candidates.find(function (p) {
        try { return fs.statSync(p).isFile(); } catch (e) { return false; }
    });
    if (!src) {
        console.warn('[nos-widgets] provisioning profile "' + profilePath + '" not found (looked in projectRoot + plugin dir); skipping. Extension may fail to sign on device.');
        return;
    }
    let destName = path.basename(src);
    try {
        const raw = fs.readFileSync(src, 'latin1');
        const m = raw.match(/<key>UUID<\/key>\s*<string>([0-9A-Fa-f-]+)<\/string>/);
        if (m) { destName = m[1] + '.mobileprovision'; }
    } catch (e) { /* keep basename */ }
    try {
        const destDir = path.join(os.homedir(), 'Library', 'MobileDevice', 'Provisioning Profiles');
        fs.mkdirSync(destDir, { recursive: true });
        const dest = path.join(destDir, destName);
        fs.copyFileSync(src, dest);
        console.log('[nos-widgets] installed widget provisioning profile -> ' + dest);
    } catch (e) {
        console.warn('[nos-widgets] could not install provisioning profile: ' + e.message);
    }
}

function getBundleIdFromConfig(projectRoot) {
    // config.xml <widget id="..."> is the source of truth for the app bundle id. The pbxproj may
    // still carry the cordova template default (e.g. com.nos.app) when this after_prepare runs,
    // which would make the extension id not prefix the app id -> "Embedded binary..." build error.
    try {
        const cfg = fs.readFileSync(path.join(projectRoot, 'config.xml'), 'utf8');
        const m = cfg.match(/<widget[^>]*\bid="([^"]+)"/);
        return m ? m[1] : null;
    } catch (e) {
        return null;
    }
}

function getMainBundleId(proj) {
    const configs = proj.pbxXCBuildConfigurationSection();
    for (const key in configs) {
        const c = configs[key];
        if (c && c.buildSettings && c.buildSettings.PRODUCT_BUNDLE_IDENTIFIER &&
            String(c.buildSettings.PRODUCT_BUNDLE_IDENTIFIER).indexOf('.widget') === -1) {
            return String(c.buildSettings.PRODUCT_BUNDLE_IDENTIFIER).replace(/"/g, '');
        }
    }
    return null;
}

function applyExtensionBuildSettings(proj, extBundleId, infoPlistName, extEntName, signing) {
    signing = signing || {};
    const manual = !!(signing.teamId && signing.profileSpecifier);
    const configs = proj.pbxXCBuildConfigurationSection();
    for (const key in configs) {
        const c = configs[key];
        if (!c || !c.buildSettings) { continue; }
        if (c.buildSettings.PRODUCT_NAME === '"' + EXT_NAME + '"') {
            const s = c.buildSettings;
            s.PRODUCT_BUNDLE_IDENTIFIER = '"' + extBundleId + '"';
            s.INFOPLIST_FILE = '"' + EXT_NAME + '/' + infoPlistName + '"';
            s.CODE_SIGN_ENTITLEMENTS = '"' + EXT_NAME + '/' + extEntName + '"';
            s.IPHONEOS_DEPLOYMENT_TARGET = DEPLOYMENT_TARGET;
            s.SWIFT_VERSION = '5.0';
            s.TARGETED_DEVICE_FAMILY = '"1,2"';
            s.GENERATE_INFOPLIST_FILE = 'NO';
            s.SKIP_INSTALL = 'YES';
            // Do NOT force CODE_SIGNING_ALLOWED=NO: the extension must be (ad-hoc) signed so its
            // App Group entitlement is applied — otherwise the shared container isn't created and
            // the widget can't read what the app wrote (true on the Simulator too).
            s.CLANG_ENABLE_MODULES = 'YES';
            s.ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS = 'NO';
            if (manual) {
                // MABS / device: sign with the extension's own App ID + provisioning profile.
                // Per-target pbxproj settings take precedence over cordova's global build-extras.xcconfig.
                s.CODE_SIGN_STYLE = 'Manual';
                s.DEVELOPMENT_TEAM = signing.teamId;
                s.PROVISIONING_PROFILE_SPECIFIER = '"' + signing.profileSpecifier + '"';
            } else {
                // Simulator / local dev: let Xcode manage it (App Groups work without provisioning).
                s.CODE_SIGN_STYLE = 'Automatic';
            }
        }
    }
    console.log('[nos-widgets] extension signing: ' + (manual
        ? 'Manual (team=' + signing.teamId + ', profile="' + signing.profileSpecifier + '")'
        : 'Automatic (no NosWidgetTeamId/NosWidgetProfileSpecifier — Simulator/local).'));
}

function setAppEntitlements(proj, entitlementsRelPath) {
    const configs = proj.pbxXCBuildConfigurationSection();
    const firstTargetName = proj.getFirstTarget().firstTarget ? null : null; // not needed
    for (const key in configs) {
        const c = configs[key];
        if (!c || !c.buildSettings) { continue; }
        const name = c.buildSettings.PRODUCT_NAME;
        // App target configs reference the app product, not the extension.
        if (name && name !== '"' + EXT_NAME + '"' &&
            typeof c.buildSettings.PRODUCT_BUNDLE_IDENTIFIER !== 'undefined' &&
            String(c.buildSettings.PRODUCT_BUNDLE_IDENTIFIER).indexOf('.widget') === -1) {
            c.buildSettings.CODE_SIGN_ENTITLEMENTS = '"' + entitlementsRelPath + '"';
        }
    }
}

function widgetInfoPlist(appGroup, displayName) {
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        '<dict>',
        '  <key>CFBundleDisplayName</key><string>' + (displayName || 'NOS') + '</string>',
        '  <key>CFBundleExecutable</key><string>$(EXECUTABLE_NAME)</string>',
        '  <key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>',
        '  <key>CFBundleName</key><string>$(PRODUCT_NAME)</string>',
        '  <key>CFBundlePackageType</key><string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>',
        '  <key>CFBundleShortVersionString</key><string>1.0</string>',
        '  <key>CFBundleVersion</key><string>1</string>',
        '  <key>NosAppGroup</key><string>' + appGroup + '</string>',
        '  <key>NSExtension</key>',
        '  <dict>',
        '    <key>NSExtensionPointIdentifier</key><string>com.apple.widgetkit-extension</string>',
        '  </dict>',
        '</dict>',
        '</plist>',
        '',
    ].join('\n');
}

function entitlements(appGroup) {
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        '<dict>',
        '  <key>com.apple.security.application-groups</key>',
        '  <array><string>' + appGroup + '</string></array>',
        '</dict>',
        '</plist>',
        '',
    ].join('\n');
}

function addAppGroupToEntitlements(plistPath, appGroup) {
    let content;
    try {
        content = fs.readFileSync(plistPath, 'utf8');
    } catch (e) {
        content = '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
            '<plist version="1.0">\n<dict>\n</dict>\n</plist>\n';
    }
    if (content.indexOf('application-groups') !== -1) { return; }
    const group = '\t<key>com.apple.security.application-groups</key>\n\t<array>\n\t\t<string>' +
        appGroup + '</string>\n\t</array>\n';
    if (content.match(/<dict\s*\/>/)) {
        content = content.replace(/<dict\s*\/>/, '<dict>\n' + group + '</dict>');
    } else {
        content = content.replace(/<\/dict>/, group + '</dict>');
    }
    fs.writeFileSync(plistPath, content);
}

function patchAppInfoPlist(plistPath, appGroup) {
    if (!fs.existsSync(plistPath)) { return; }
    let content = fs.readFileSync(plistPath, 'utf8');
    if (content.indexOf('NosAppGroup') !== -1) { return; }
    const inject = '\t<key>NosAppGroup</key>\n\t<string>' + appGroup + '</string>\n</dict>\n</plist>';
    content = content.replace(/<\/dict>\s*<\/plist>\s*$/, inject);
    fs.writeFileSync(plistPath, content);
}

// Register the widget deep-link URL scheme on the app target's Info.plist. Adds it to the existing
// CFBundleURLSchemes array (the plugin registers a default), or creates the block if none exists.
// No-op when the scheme is already present, so it's safe to re-run.
function ensureUrlScheme(plistPath, scheme) {
    if (!scheme || !fs.existsSync(plistPath)) { return; }
    let content = fs.readFileSync(plistPath, 'utf8');
    if (content.indexOf('<string>' + scheme + '</string>') !== -1) { return; }
    if (content.indexOf('CFBundleURLSchemes') !== -1) {
        content = content.replace(/(<key>CFBundleURLSchemes<\/key>\s*<array>)/,
            '$1\n\t\t\t\t<string>' + scheme + '</string>');
    } else {
        const block = '\t<key>CFBundleURLTypes</key>\n\t<array>\n\t\t<dict>\n' +
            '\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>' + scheme + '</string>\n' +
            '\t\t\t</array>\n\t\t</dict>\n\t</array>\n';
        content = content.replace(/<\/dict>\s*<\/plist>\s*$/, block + '</dict>\n</plist>');
    }
    fs.writeFileSync(plistPath, content);
    console.log('[nos-widgets] registered widget URL scheme "' + scheme + '" on the app Info.plist.');
}
