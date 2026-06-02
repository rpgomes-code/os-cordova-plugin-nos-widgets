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
 *   - sets the App Group entitlement + IPHONEOS_DEPLOYMENT_TARGET = 14.0
 *
 * NOTE: device/MABS signing of this 2nd target is gated (see docs/plans design §3); this is
 * validated on the iOS Simulator, where App Groups work without provisioning.
 */

const fs = require('fs');
const path = require('path');

const PLUGIN_ID = 'os-cordova-plugin-nos-widgets';
const EXT_NAME = 'NosWidgetExtension';
const DEPLOYMENT_TARGET = '14.0';

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

    if (proj.pbxTargetByName(EXT_NAME)) {
        console.log('[nos-widgets] extension target already present; skipping injection.');
        return;
    }

    const mainBundleId = getMainBundleId(proj) || ('com.nos.' + appName.toLowerCase());
    const appGroup = 'group.' + mainBundleId;
    const extBundleId = mainBundleId + '.widget';

    // 1. Copy widget Swift sources into platforms/ios/<EXT_NAME>/
    const widgetSrcDir = path.join(projectRoot, 'plugins', PLUGIN_ID, 'src', 'ios', 'widget');
    const extDir = path.join(iosDir, EXT_NAME);
    if (!fs.existsSync(extDir)) { fs.mkdirSync(extDir, { recursive: true }); }
    const swiftFiles = fs.readdirSync(widgetSrcDir).filter((f) => f.endsWith('.swift'));
    swiftFiles.forEach((f) => fs.copyFileSync(path.join(widgetSrcDir, f), path.join(extDir, f)));

    // 2. Generate Info.plist + entitlements
    const infoPlistName = EXT_NAME + '-Info.plist';
    fs.writeFileSync(path.join(extDir, infoPlistName), widgetInfoPlist(appGroup));
    const extEntName = EXT_NAME + '.entitlements';
    fs.writeFileSync(path.join(extDir, extEntName), entitlements(appGroup));
    const appEntName = appName + '.entitlements';
    fs.writeFileSync(path.join(iosDir, appName, appEntName), entitlements(appGroup));
    patchAppInfoPlist(path.join(iosDir, appName, appName + '-Info.plist'), appGroup);

    // 3. pbxproj: group + target
    const pbxGroupKey = proj.pbxCreateGroup(EXT_NAME, EXT_NAME);
    const mainGroup = proj.getFirstProject().firstProject.mainGroup;
    proj.addToPbxGroup(pbxGroupKey, mainGroup);

    const target = proj.addTarget(EXT_NAME, 'app_extension', EXT_NAME, extBundleId);

    proj.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', target.uuid);
    proj.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
    proj.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);

    swiftFiles.forEach((f) => {
        proj.addSourceFile(path.join(EXT_NAME, f), { target: target.uuid }, pbxGroupKey);
    });
    // Info.plist as a plain group file (referenced via INFOPLIST_FILE, not built)
    proj.addFile(path.join(EXT_NAME, infoPlistName), pbxGroupKey);

    ['WidgetKit.framework', 'SwiftUI.framework'].forEach((fw) => {
        proj.addFramework('System/Library/Frameworks/' + fw,
            { target: target.uuid, weak: true, sourceTree: 'SDKROOT' });
    });

    // 4. Embed the extension into the app + dependency
    const appTargetUuid = proj.getFirstTarget().uuid;
    proj.addTargetDependency(appTargetUuid, [target.uuid]);
    proj.addBuildPhase([EXT_NAME + '.appex'], 'PBXCopyFilesBuildPhase',
        'Embed App Extensions', appTargetUuid, 'app_extension');

    // 5. Build settings for the extension configurations
    applyExtensionBuildSettings(proj, extBundleId, infoPlistName, extEntName);

    // 6. App target: App Group entitlement
    setAppEntitlements(proj, appName + '/' + appEntName);

    fs.writeFileSync(pbxPath, proj.writeSync());
    console.log('[nos-widgets] WidgetKit extension injected (appGroup=' + appGroup + ', deploymentTarget=' + DEPLOYMENT_TARGET + ').');
};

// ---------------------------------------------------------------------------- helpers

function loadXcode(projectRoot) {
    const candidates = [
        'xcode',
        path.join(projectRoot, 'node_modules', 'xcode'),
        path.join(projectRoot, 'node_modules', 'cordova-ios', 'node_modules', 'xcode'),
    ];
    for (const c of candidates) {
        try { return require(c); } catch (e) { /* try next */ }
    }
    return null;
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

function applyExtensionBuildSettings(proj, extBundleId, infoPlistName, extEntName) {
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
            s.CODE_SIGN_STYLE = 'Automatic';
            s.CODE_SIGNING_ALLOWED = 'NO';
            s.CLANG_ENABLE_MODULES = 'YES';
            s.ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS = 'NO';
        }
    }
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

function widgetInfoPlist(appGroup) {
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        '<dict>',
        '  <key>CFBundleDisplayName</key><string>NOS</string>',
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

function patchAppInfoPlist(plistPath, appGroup) {
    if (!fs.existsSync(plistPath)) { return; }
    let content = fs.readFileSync(plistPath, 'utf8');
    if (content.indexOf('NosAppGroup') !== -1) { return; }
    const inject = '\t<key>NosAppGroup</key>\n\t<string>' + appGroup + '</string>\n</dict>\n</plist>';
    content = content.replace(/<\/dict>\s*<\/plist>\s*$/, inject);
    fs.writeFileSync(plistPath, content);
}
