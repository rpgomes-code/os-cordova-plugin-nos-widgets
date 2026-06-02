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

    if (extensionTargetExists(proj)) {
        console.log('[nos-widgets] extension target already present; skipping injection.');
        return;
    }

    const mainBundleId = getBundleIdFromConfig(projectRoot) || getMainBundleId(proj) || ('com.nos.' + appName.toLowerCase());
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
    // App target: add the App Group to cordova's EXISTING entitlements files (already referenced
    // by the app target as CODE_SIGN_ENTITLEMENTS). Overriding that setting proved flaky.
    ['Debug', 'Release'].forEach(function (cfg) {
        addAppGroupToEntitlements(path.join(iosDir, appName, 'Entitlements-' + cfg + '.plist'), appGroup);
    });
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

    // 5. Build settings for the extension configurations
    applyExtensionBuildSettings(proj, extBundleId, infoPlistName, extEntName);

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
        'xcode',
        path.join(projectRoot, 'node_modules', 'xcode'),
        path.join(projectRoot, 'node_modules', 'cordova-ios', 'node_modules', 'xcode'),
    ];
    for (const c of candidates) {
        try { return require(c); } catch (e) { /* try next */ }
    }
    return null;
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
            // Do NOT force CODE_SIGNING_ALLOWED=NO: the extension must be (ad-hoc) signed so its
            // App Group entitlement is applied — otherwise the shared container isn't created and
            // the widget can't read what the app wrote (true on the Simulator too).
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
