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
let DEPLOYMENT_TARGET = '16.0'; // iOS 16 floor: lock-screen accessory widgets + Gauge require it.

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
    // '__unset__' is the sentinel default of the optional plugin variables (a cordova install
    // <preference> must have a non-empty default, so "not configured" is encoded as this sentinel).
    const pref = function (cfgName, envName, fallback) {
        let v = (envName && process.env[envName]) ? process.env[envName] : null;
        if (v === null) {
            const m = cfgXml.match(new RegExp('<preference\\s+name="' + cfgName + '"\\s+value="([^"]*)"'));
            v = m ? m[1] : null;
        }
        return (v === null || v === '' || v === '__unset__') ? fallback : v;
    };
    // Target shape / branding (all optional, defaulting to the historical hardcoded values).
    EXT_NAME = pref('NosWidgetExtensionName', 'NOS_WIDGET_EXTENSION_NAME', 'NosWidgetExtension');
    DEPLOYMENT_TARGET = pref('NosWidgetIosDeploymentTarget', 'NOS_WIDGET_IOS_DEPLOYMENT_TARGET', '16.0');
    const bundleSuffix = pref('NosWidgetBundleSuffix', 'NOS_WIDGET_BUNDLE_SUFFIX', 'widget');
    const displayName = pref('NosWidgetDisplayName', 'NOS_WIDGET_DISPLAY_NAME', 'NOS');
    const urlScheme = pref('NosWidgetUrlScheme', 'NOS_WIDGET_URL_SCHEME', 'nosapp');
    const signing = {
        teamId: pref('NosWidgetTeamId', 'NOS_WIDGET_TEAM_ID', ''),
        profileSpecifier: pref('NosWidgetProfileSpecifier', 'NOS_WIDGET_PROFILE_SPECIFIER', ''),
        profilePath: pref('NosWidgetProvisioningProfile', 'NOS_WIDGET_PROVISIONING_PROFILE', ''),
        profileB64: pref('NosWidgetMobileprovisionB64', 'NOS_WIDGET_MOBILEPROVISION_B64', '')
    };
    // 0.10.0 (default OFF): emit a Podfile target block so CocoaPods integrates the ext target.
    const podfileTargetOn = /^(1|true|yes|on)$/i.test(
        pref('NosWidgetPodfileTarget', 'NOS_WIDGET_PODFILE_TARGET', ''));
    // Which cordova hook phase we are in (cordova sets this on context.hook).
    const hookType = (context && context.hook) || 'unknown';
    console.log('[nos-widgets] hook phase=' + hookType + ' ext=' + EXT_NAME +
        ' podfileTarget=' + (podfileTargetOn ? 'ON' : 'off'));

    if (extensionTargetExists(proj)) {
        // Already injected — either an earlier prepare in this build, or this hook running again at
        // before_compile (registered for BOTH). Some MABS / cordova-ios pipelines REWRITE the .pbxproj
        // or regenerate the shared scheme AFTER after_prepare, dropping the app->extension dependency /
        // embed phase and leaving the scheme entry dangling, so xcodebuild silently skips the extension.
        // Re-assert ALL the pbxproj edges (embed phase + target dependency) AND the scheme entry against
        // the CURRENT uuid so the wiring survives such a rewrite, then dump full diagnostics.
        const existingUuid = findExtensionTargetUuid(proj, EXT_NAME);
        console.log('[nos-widgets] extension target already present (uuid=' + existingUuid + '); re-asserting wiring.');
        if (existingUuid) {
            reassertEmbedAndDependency(proj, existingUuid, EXT_NAME);
            // 0.11.0: (re)add the inside-xcodebuild run-script markers (idempotent — guarded by name).
            addInstrumentationBuildPhases(proj, existingUuid, EXT_NAME);
            fs.writeFileSync(pbxPath, proj.writeSync());
            addExtensionToSharedScheme(iosDir, projName, appName, EXT_NAME, existingUuid);
        }
        if (podfileTargetOn) { maybeWritePodfileTarget(iosDir, EXT_NAME); }
        // Re-parse from disk so diagnostics reflect exactly what xcodebuild will read.
        const projAfter = xcode.project(pbxPath); projAfter.parseSync();
        runDiagnostics(projAfter, iosDir, projName, appName, EXT_NAME, existingUuid, hookType);
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
    //    that copies the .appex into the host app — re-adding it caused "Unexpected duplicate tasks".
    //    It does NOT add the build-order dependency. CAUTION: node-xcode's addTargetDependency only
    //    writes anything if the PBXTargetDependency + PBXContainerItemProxy sections ALREADY exist
    //    (its `if (sectionA && sectionB)` guard). A bare Cordova app has NEITHER, so without this the
    //    dependency is silently dropped and `xcodebuild archive` never builds/embeds the extension
    //    (the app ships with no widget). Create the sections first, then add app -> extension.
    const pbxObjects = proj.hash.project.objects;
    pbxObjects['PBXTargetDependency'] = pbxObjects['PBXTargetDependency'] || {};
    pbxObjects['PBXContainerItemProxy'] = pbxObjects['PBXContainerItemProxy'] || {};
    proj.addTargetDependency(proj.getFirstTarget().uuid, [target.uuid]);

    // 5. Rung 1 (MABS): install the widget's provisioning profile into the build agent's profiles
    //    dir (App-Center-style) so xcodebuild can manual-sign the extension target. No-op if unset.
    maybeInstallProvisioningProfile(projectRoot, signing.profilePath, signing.profileB64);

    // 6. Build settings for the extension configurations (incl. signing).
    applyExtensionBuildSettings(proj, extBundleId, infoPlistName, extEntName, signing);

    // 6b. Strip CodeSignOnCopy from the embed Copy-Files phase if a round-trip ever added it (D2),
    //     and make sure exactly one app->ext dependency exists (D3). Cheap insurance.
    reassertEmbedAndDependency(proj, target.uuid, EXT_NAME);

    // 6c. 0.11.0: add the inside-xcodebuild run-script markers ([nos-rs][ext] / [nos-rs][app]).
    addInstrumentationBuildPhases(proj, target.uuid, EXT_NAME);

    fs.writeFileSync(pbxPath, proj.writeSync());

    // 7. Register the extension in the app's SHARED SCHEME's BuildActionEntries. CRITICAL for MABS:
    //    cordova-ios 7's `xcodebuild -workspace -scheme archive` only builds targets that are in the
    //    scheme (or a resolved dependency of one). The embed Copy-Files phase + target dependency alone
    //    do NOT pull the extension into the build graph on cordova-ios 7 (verified: the archive's target
    //    dependency graph omits it), so the .appex is never built and the app ships with NO widget.
    //    node-xcode has no scheme API, so the .xcscheme XML is patched directly.
    addExtensionToSharedScheme(iosDir, projName, appName, EXT_NAME, target.uuid);

    // 8. (0.10.0, gated OFF) make CocoaPods aware of the extra target in the ~46-target workspace.
    if (podfileTargetOn) { maybeWritePodfileTarget(iosDir, EXT_NAME); }

    console.log('[nos-widgets] WidgetKit extension injected (appGroup=' + appGroup + ', deploymentTarget=' + DEPLOYMENT_TARGET + ').');

    // 9. MAXIMUM DIAGNOSTICS: re-parse from disk and dump the true graph xcodebuild will read.
    const projAfter = xcode.project(pbxPath); projAfter.parseSync();
    runDiagnostics(projAfter, iosDir, projName, appName, EXT_NAME, target.uuid, hookType);
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
function maybeInstallProvisioningProfile(projectRoot, profilePath, profileB64) {
    if (!profilePath && !profileB64) {
        console.log('[nos-widgets] no widget provisioning profile configured; skipping profile install (Simulator/local, or MABS-managed signing).');
        return;
    }
    let src = null;
    if (profilePath) {
        const candidates = [
            path.isAbsolute(profilePath) ? profilePath : null,
            path.resolve(projectRoot, profilePath),
            path.join(projectRoot, 'plugins', PLUGIN_ID, profilePath)
        ].filter(Boolean);
        src = candidates.find(function (p) {
            try { return fs.statSync(p).isFile(); } catch (e) { return false; }
        });
        if (!src) {
            // MABS may drop an OutSystems module Resource somewhere other than the literal path. Scan the
            // generated project tree for the filename so it's found wherever it lands.
            const base = path.basename(profilePath);
            const matches = scanForFile(projectRoot, base, 9);
            if (matches.length) {
                src = matches[0];
                console.log('[nos-widgets] provisioning profile "' + base + '" located via project scan -> ' + src +
                    (matches.length > 1 ? '  (' + matches.length + ' matches: ' + matches.join(', ') + ')' : ''));
            }
        }
    }
    // Guaranteed-delivery fallback: the .mobileprovision passed INLINE as base64 in a plugin variable.
    // This never depends on a file / OutSystems Resource reaching the MABS build tree.
    if (!src && profileB64) {
        try {
            const buf = Buffer.from(String(profileB64).replace(/\s+/g, ''), 'base64');
            if (buf && buf.length > 500) {
                src = path.join(os.tmpdir(), 'nos-widget.mobileprovision');
                fs.writeFileSync(src, buf);
                console.log('[nos-widgets] widget provisioning profile decoded from NOS_WIDGET_MOBILEPROVISION_B64 (' + buf.length + ' bytes) -> ' + src);
            } else {
                console.warn('[nos-widgets] NOS_WIDGET_MOBILEPROVISION_B64 decoded to ' + (buf ? buf.length : 0) + ' bytes (too small); ignoring.');
            }
        } catch (e) {
            console.warn('[nos-widgets] could not decode NOS_WIDGET_MOBILEPROVISION_B64: ' + e.message);
        }
    }
    if (!src) {
        console.warn('[nos-widgets] widget provisioning profile NOT found (tried path "' + (profilePath || '') +
            '" + project scan' + (profileB64 ? ' + base64' : '') + '). Skipping — the widget extension may fail ' +
            'to sign on device. Set NOS_WIDGET_MOBILEPROVISION_B64 to the base64 of the .mobileprovision ' +
            '(guaranteed), or ensure the file reaches the build tree.');
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

// Recursively search `rootDir` (bounded depth; skips heavy/irrelevant dirs) for files named
// `fileName`. Lets the widget profile be shipped as an OutSystems module Resource and found wherever
// MABS places it in the generated Cordova project (typically under www/<module>/).
function scanForFile(rootDir, fileName, maxDepth) {
    const SKIP = new Set(['node_modules', '.git', 'Pods', 'build', 'DerivedData', 'CordovaLib', '.cordova']);
    const out = [];
    (function walk(dir, depth) {
        if (depth > maxDepth) { return; }
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
        for (const ent of entries) {
            if (ent.isDirectory()) {
                if (!SKIP.has(ent.name)) { walk(path.join(dir, ent.name), depth + 1); }
            } else if (ent.name === fileName) {
                out.push(path.join(dir, ent.name));
            }
        }
    })(rootDir, 0);
    return out;
}

// Register the injected extension target in EVERY shared/user scheme so `xcodebuild -scheme archive`
// builds it. cordova-ios 7's archive only builds targets in the scheme (or a resolved dependency), and
// the embed phase alone does NOT pull the appex into the graph (verified). node-xcode has no scheme API,
// so the .xcscheme XML is patched directly.
//
// D1 (the leading hypothesis): a BuildActionEntry is SILENTLY dropped if its ReferencedContainer does
// not resolve to the .xcodeproj that holds the target. Rather than (re)compute the container from a
// path — whose resolution base is ambiguous and silently wrong if off — we reuse the EXACT container
// string from the scheme's existing APP BuildActionEntry: the app and the extension live in the SAME
// .xcodeproj, the app entry already resolves and the app builds, so that container is provably correct.
function addExtensionToSharedScheme(iosDir, projName, appName, extName, extTargetUuid) {
    const schemeFiles = findAllSchemes(iosDir, appName);
    if (!schemeFiles.length) {
        console.warn('[nos-widgets] NO .xcscheme found under ' + iosDir + '; -scheme archive cannot build the extension.');
        return;
    }
    schemeFiles.forEach(function (schemeFile) {
        let s;
        try { s = fs.readFileSync(schemeFile, 'utf8'); } catch (e) { return; }
        if (s.indexOf('<BuildActionEntries>') === -1) {
            console.warn('[nos-widgets][scheme] no <BuildActionEntries> in ' + schemeFile + '; skipping.');
            return;
        }
        // D1: reuse the container string from the EXISTING app BuildActionEntry in THIS scheme (same
        // .xcodeproj as the ext, already resolves). Fall back to "container:<projName>" only if absent.
        const appContainer = extractAppReferencedContainer(s, extName);
        const container = appContainer || ('container:' + projName);
        if (!appContainer) {
            console.warn('[nos-widgets][scheme] no existing app BuildActionEntry ReferencedContainer in ' +
                schemeFile + '; falling back to "' + container + '".');
        }

        // D5: force implicit-dependency resolution ON even when the attribute is absent.
        s = s.replace(/buildImplicitDependencies\s*=\s*"NO"/g, 'buildImplicitDependencies = "YES"');
        if (s.indexOf('buildImplicitDependencies') === -1) {
            s = s.replace(/<BuildAction\b/, '<BuildAction\n      buildImplicitDependencies = "YES"');
        }

        // D7: strip ANY existing entry for <ext>.appex (any uuid/container) so we never leave a stale,
        // unresolvable entry beside the good one.
        s = stripBuildActionEntryByAppex(s, extName + '.appex');

        const entry =
            '      <BuildActionEntry\n' +
            '         buildForTesting = "NO"\n' +
            '         buildForRunning = "YES"\n' +
            '         buildForProfiling = "YES"\n' +
            '         buildForArchiving = "YES"\n' +
            '         buildForAnalyzing = "YES">\n' +
            '         <BuildableReference\n' +
            '            BuildableIdentifier = "primary"\n' +
            '            BlueprintIdentifier = "' + extTargetUuid + '"\n' +
            '            BuildableName = "' + extName + '.appex"\n' +
            '            BlueprintName = "' + extName + '"\n' +
            '            ReferencedContainer = "' + container + '">\n' +
            '         </BuildableReference>\n' +
            '      </BuildActionEntry>\n';
        // Insert the extension BEFORE the app entry so it is built first.
        s = s.replace('<BuildActionEntries>', '<BuildActionEntries>\n' + entry);
        fs.writeFileSync(schemeFile, s);
        console.log('[nos-widgets][scheme] registered ' + extName + ' (uuid=' + extTargetUuid +
            ', container="' + container + '") in ' + schemeFile);
    });
}

// Pull the ReferencedContainer string out of the scheme's existing APP BuildActionEntry (i.e. the one
// whose BuildableName is NOT the <ext>.appex). The app and ext share the .xcodeproj, so this exact
// container value is provably correct for the ext entry too. Returns null if none found.
function extractAppReferencedContainer(xml, extName) {
    const appexName = extName + '.appex';
    const re = /<BuildActionEntry\b[\s\S]*?<\/BuildActionEntry>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
        const block = m[0];
        if (block.indexOf('BuildableName = "' + appexName + '"') !== -1) { continue; } // skip ext entry
        const c = block.match(/ReferencedContainer = "([^"]*)"/);
        if (c) { return c[1]; }
    }
    return null;
}

// All shared AND per-user schemes named <app>.xcscheme under platforms/ios (workspace- and project-hosted).
function findAllSchemes(iosDir, appName) {
    const SKIP = new Set(['Pods', 'build', 'CordovaLib', 'DerivedData']);
    const out = [];
    (function walk(dir, depth) {
        if (depth > 7) { return; }
        let ents;
        try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
        for (const ent of ents) {
            const p = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                if (!SKIP.has(ent.name)) { walk(p, depth + 1); }
            } else if (ent.name === appName + '.xcscheme') {
                out.push(p);
            }
        }
    })(iosDir, 0);
    return out;
}

// Remove a full <BuildActionEntry>...</BuildActionEntry> block whose BuildableName == appexName.
function stripBuildActionEntryByAppex(xml, appexName) {
    const re = /<BuildActionEntry\b[\s\S]*?<\/BuildActionEntry>\s*/g;
    return xml.replace(re, function (block) {
        return block.indexOf('BuildableName = "' + appexName + '"') !== -1 ? '' : block;
    });
}

// Find the uuid of the injected extension native target in the current parsed project. Used when the
// target already exists (e.g. the before_compile re-run) to re-assert the scheme registration against
// the live uuid rather than a stale one.
function findExtensionTargetUuid(proj, extName) {
    const targets = proj.pbxNativeTargetSection();
    for (const k in targets) {
        if (k.indexOf('_comment') !== -1) { continue; }
        const t = targets[k];
        if (t && typeof t === 'object') {
            const n = String(t.name || '').replace(/^"|"$/g, '');
            if (n === extName) { return k; }
        }
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

// ---------------------------------------------------------------------------- 0.10.0 hardening

// D2/D3: ensure exactly one app->ext PBXTargetDependency exists and the embed Copy-Files phase
// (dstSubfolderSpec 13) holds the .appex with NO CodeSignOnCopy (which would cause a build cycle).
function reassertEmbedAndDependency(proj, extUuid, extName) {
    const objs = proj.hash.project.objects;
    objs['PBXTargetDependency'] = objs['PBXTargetDependency'] || {};
    objs['PBXContainerItemProxy'] = objs['PBXContainerItemProxy'] || {};
    const appUuid = proj.getFirstTarget().uuid;
    const appTarget = proj.pbxNativeTargetSection()[appUuid];

    // Count existing app->ext dependencies.
    let depCount = 0;
    const deps = (appTarget && appTarget.dependencies) || [];
    deps.forEach(function (d) {
        const td = objs['PBXTargetDependency'][d.value];
        if (td && td.target === extUuid) { depCount++; }
    });
    if (depCount === 0) {
        proj.addTargetDependency(appUuid, [extUuid]);
        console.log('[nos-widgets] (re)added app->ext PBXTargetDependency.');
    } else {
        console.log('[nos-widgets] app->ext PBXTargetDependency already present (count=' + depCount + ').');
    }

    // Strip CodeSignOnCopy from any embed-phase PBXBuildFile referencing <ext>.appex.
    const buildFiles = objs['PBXBuildFile'] || {};
    for (const k in buildFiles) {
        const bf = buildFiles[k];
        if (bf && typeof bf === 'object' && bf.fileRef_comment &&
            bf.fileRef_comment.indexOf(extName + '.appex') !== -1 && bf.settings) {
            console.warn('[nos-widgets] stripping settings (' + JSON.stringify(bf.settings) +
                ') from embed build file for ' + extName + '.appex');
            delete bf.settings;
        }
    }
}

// ---------------------------------------------------------------------------- 0.11.0 instrumentation
// INSIDE-XCODEBUILD run-script markers. If the [nos-rs][ext] marker NEVER appears in a MABS log, the
// extension target was excluded from xcodebuild's build graph (the smoking gun we're hunting). The
// [nos-rs][app] marker (added as the FIRST app build phase, so it runs early) lists the products dir
// and any embedded .appex so we can see, from INSIDE the build, whether the appex was produced/embedded.
//
// Idempotent: guarded by name so the before_compile re-run does not duplicate them, and (re)added in
// BOTH the fresh-inject path and the already-exists/before_compile path.
const EXT_RS_PHASE_NAME = '[nos-rs] NosWidgetExtension marker';
const APP_RS_PHASE_NAME = '[nos-rs] App build marker';
const EXT_RS_MARKER = '[nos-rs][ext] NosWidgetExtension TARGET BUILDING';
const APP_RS_MARKER = '[nos-rs][app] building';

function addInstrumentationBuildPhases(proj, extUuid, extName) {
    try {
        const objs = proj.hash.project.objects;
        const appUuid = proj.getFirstTarget().uuid;

        // --- EXTENSION target marker --------------------------------------------------------------
        if (!shellPhaseExistsOnTarget(proj, extUuid, EXT_RS_PHASE_NAME)) {
            const extScript =
                'echo "' + EXT_RS_MARKER + ' action=$ACTION config=$CONFIGURATION sdk=$SDKROOT ' +
                'archs=$ARCHS bundle=$PRODUCT_BUNDLE_IDENTIFIER"';
            proj.addBuildPhase([], 'PBXShellScriptBuildPhase', EXT_RS_PHASE_NAME, extUuid, {
                shellPath: '/bin/sh',
                shellScript: extScript
            });
            // 0.11.0 fix: DISABLE Xcode's full-env dump (showEnvVarsInLog=0). The script already echoes the
            // specific vars we need; the full script-phase env on a SIGNING build leaks team/cert/profile
            // identity (DEVELOPMENT_TEAM, EXPANDED_CODE_SIGN_IDENTITY, PROVISIONING_PROFILE, keychain/agent
            // paths) into a log the user shares verbatim. node-xcode omits the key by default and Xcode treats
            // an ABSENT key as ON, so we must write 0 explicitly to suppress the dump.
            setShellPhaseFlags(proj, extUuid, EXT_RS_PHASE_NAME, { showEnvVarsInLog: 0 });
            console.log('[nos-widgets] added EXT run-script marker phase to ' + extName + '.');
        } else {
            console.log('[nos-widgets] EXT run-script marker phase already present; skipping.');
        }

        // --- APP target marker (FIRST build phase) ------------------------------------------------
        if (!shellPhaseExistsOnTarget(proj, appUuid, APP_RS_PHASE_NAME)) {
            const appScript = [
                'echo "' + APP_RS_MARKER + ' action=$ACTION config=$CONFIGURATION ' +
                    'scheme=$SCHEME_NAME target=$TARGET_NAME"',
                'echo "[nos-rs][app] BUILT_PRODUCTS_DIR=$BUILT_PRODUCTS_DIR"',
                'ls -la "$BUILT_PRODUCTS_DIR" 2>/dev/null || true',
                'ls -la "$BUILT_PRODUCTS_DIR"/*.appex 2>/dev/null || true',
                'ls -la "${CODESIGNING_FOLDER_PATH}/PlugIns" 2>/dev/null || true',
                'echo "[nos-rs][app] end"'
            ].join('\n');
            const res = proj.addBuildPhase([], 'PBXShellScriptBuildPhase', APP_RS_PHASE_NAME, appUuid, {
                shellPath: '/bin/sh',
                shellScript: appScript
            });
            setShellPhaseFlags(proj, appUuid, APP_RS_PHASE_NAME, { showEnvVarsInLog: 0 }); // 0.11.0: no full-env dump (see EXT phase note)
            // addBuildPhase pushes to the END of buildPhases; move it to the FRONT so it runs early.
            moveBuildPhaseToFront(proj, appUuid, res.uuid);
            console.log('[nos-widgets] added APP run-script marker phase (as first phase) to app target.');
        } else {
            console.log('[nos-widgets] APP run-script marker phase already present; skipping.');
        }
    } catch (e) {
        console.warn('[nos-widgets] addInstrumentationBuildPhases failed (non-fatal): ' + (e && e.stack ? e.stack : e));
    }
}

// True if the given native target already has a PBXShellScriptBuildPhase with this name.
function shellPhaseExistsOnTarget(proj, targetUuid, phaseName) {
    const objs = proj.hash.project.objects;
    const target = (objs['PBXNativeTarget'] || {})[targetUuid];
    if (!target || !Array.isArray(target.buildPhases)) { return false; }
    const phases = objs['PBXShellScriptBuildPhase'] || {};
    const quoted = '"' + phaseName + '"';
    return target.buildPhases.some(function (bp) {
        const ph = phases[bp.value];
        return ph && (ph.name === quoted || ph.name === phaseName);
    });
}

// Set extra flags (e.g. showEnvVarsInLog) on the named shell phase of a target.
function setShellPhaseFlags(proj, targetUuid, phaseName, flags) {
    const objs = proj.hash.project.objects;
    const target = (objs['PBXNativeTarget'] || {})[targetUuid];
    if (!target || !Array.isArray(target.buildPhases)) { return; }
    const phases = objs['PBXShellScriptBuildPhase'] || {};
    const quoted = '"' + phaseName + '"';
    target.buildPhases.forEach(function (bp) {
        const ph = phases[bp.value];
        if (ph && (ph.name === quoted || ph.name === phaseName)) {
            Object.keys(flags).forEach(function (k) { ph[k] = flags[k]; });
        }
    });
}

// Move a build-phase reference to the FRONT of a target's buildPhases array (so it runs first).
function moveBuildPhaseToFront(proj, targetUuid, phaseUuid) {
    const objs = proj.hash.project.objects;
    const target = (objs['PBXNativeTarget'] || {})[targetUuid];
    if (!target || !Array.isArray(target.buildPhases)) { return; }
    const idx = target.buildPhases.findIndex(function (bp) { return bp.value === phaseUuid; });
    if (idx > 0) {
        const item = target.buildPhases.splice(idx, 1)[0];
        target.buildPhases.unshift(item);
    }
}

// (0.10.0, gated by NOS_WIDGET_PODFILE_TARGET) append an empty Podfile target block so the next
// `pod install` integrates the ext target into the CocoaPods workspace graph. Idempotent.
function maybeWritePodfileTarget(iosDir, extName) {
    const podfile = path.join(iosDir, 'Podfile');
    let content;
    try { content = fs.readFileSync(podfile, 'utf8'); } catch (e) {
        console.warn('[nos-widgets][podfile] no Podfile at ' + podfile + '; skipping target block.');
        return;
    }
    if (new RegExp("target\\s+'" + extName + "'").test(content)) {
        console.log('[nos-widgets][podfile] target block already present; skipping.');
        return;
    }
    const block = "\ntarget '" + extName + "' do\n  platform :ios, '16.0'\nend\n";
    fs.writeFileSync(podfile, content.replace(/\s*$/, '\n') + block);
    console.log('[nos-widgets][podfile] appended empty target block for ' + extName + ' to ' + podfile);
}

// ---------------------------------------------------------------------------- 0.10.0 diagnostics
// Emits a [nos-widgets][diag] block: the single source of truth for the next MABS log.
function runDiagnostics(proj, iosDir, projName, appName, extName, extUuid, hookType) {
    const D = function () {
        console.log('[nos-widgets][diag] ' + Array.prototype.join.call(arguments, ' '));
    };
    try {
        D('=========== BEGIN (phase=' + hookType + ') ===========');
        D('ext uuid =', extUuid, '| ext name =', extName);

        // (a) all native targets
        const nts = proj.pbxNativeTargetSection();
        const targetNames = [];
        for (const k in nts) {
            if (k.indexOf('_comment') !== -1) { continue; }
            const t = nts[k];
            if (t && typeof t === 'object') {
                targetNames.push(String(t.name).replace(/"/g, '') + '=' + k +
                    ' [' + String(t.productType || '').replace(/"/g, '') + ']');
            }
        }
        D('native targets (' + targetNames.length + '):');
        targetNames.forEach(function (n) { D('  target', n); });

        // (b) app target dependencies + proxies
        const objs = proj.hash.project.objects;
        const appUuid = proj.getFirstTarget().uuid;
        const app = nts[appUuid];
        const deps = (app && app.dependencies) || [];
        D('app target =', String(app && app.name).replace(/"/g, ''), '(' + appUuid + ') deps=' + deps.length);
        deps.forEach(function (d) {
            const td = (objs['PBXTargetDependency'] || {})[d.value] || {};
            const px = (objs['PBXContainerItemProxy'] || {})[td.targetProxy] || {};
            D('  dep target=' + td.target +
              ' proxyType=' + px.proxyType +
              ' containerPortal=' + px.containerPortal +
              ' remoteGlobalIDString=' + px.remoteGlobalIDString +
              ' remoteInfo=' + String(px.remoteInfo || '').replace(/"/g, '') +
              (td.target === extUuid ? '   <== EXT DEP' : ''));
        });
        const extDepOk = deps.some(function (d) {
            const td = (objs['PBXTargetDependency'] || {})[d.value] || {};
            return td.target === extUuid;
        });
        D('ASSERT app->ext PBXTargetDependency:', extDepOk ? 'PRESENT' : '*** MISSING ***');

        // (c) all copy-files phases (flag dstSubfolderSpec 13 + CodeSignOnCopy)
        const phases = objs['PBXCopyFilesBuildPhase'] || {};
        let embedHasAppex = false;
        for (const pk in phases) {
            if (pk.indexOf('_comment') !== -1) { continue; }
            const ph = phases[pk];
            if (!ph || typeof ph !== 'object') { continue; }
            const files = (ph.files || []).map(function (f) {
                const bf = (objs['PBXBuildFile'] || {})[f.value] || {};
                const csc = bf.settings && JSON.stringify(bf.settings).indexOf('CodeSignOnCopy') !== -1;
                if (String(bf.fileRef_comment || '').indexOf(extName + '.appex') !== -1 &&
                    String(ph.dstSubfolderSpec) === '13') { embedHasAppex = true; }
                return (bf.fileRef_comment || '?') + (csc ? ' [CODESIGNONCOPY!]' : '');
            });
            D('  copyPhase dstSubfolderSpec=' + ph.dstSubfolderSpec +
              ' name=' + String(ph.name || ph.comment || '').replace(/"/g, '') +
              ' files=[' + files.join(', ') + ']');
        }
        D('ASSERT embed(13) contains', extName + '.appex:', embedHasAppex ? 'PRESENT' : '*** MISSING ***');

        // (d) ext productReference basename
        const ext = nts[extUuid];
        if (ext) {
            const prodRef = (objs['PBXFileReference'] || {})[ext.productReference] || {};
            D('ext productReference basename =', String(prodRef.path || prodRef.name || '?').replace(/"/g, ''));
        }

        // (e) every scheme + its appex BuildActionEntry + container resolution (D1)
        const schemes = findAllSchemes(iosDir, appName);
        const projAbs = path.join(iosDir, projName);
        D('schemes found:', schemes.length);
        schemes.forEach(function (sf) {
            let xml = '';
            try { xml = fs.readFileSync(sf, 'utf8'); } catch (e) { return; }
            D('  scheme', sf);
            // The app entry's container — the value we reuse for the ext entry (D1).
            const appContainer = extractAppReferencedContainer(xml, extName);
            D('    app entry container=' + (appContainer || '(none)'));
            const m = xml.match(/BuildableName = "([^"]*\.appex)"[\s\S]*?ReferencedContainer = "([^"]*)"/);
            if (!m) { D('    (no .appex BuildActionEntry in this scheme)'); return; }
            D('    appex entry: BuildableName=' + m[1] + ' container=' + m[2]);
            D('    ASSERT ext container == app container:' +
              (appContainer && m[2] === appContainer ? ' YES' : ' *** NO (' + m[2] + ' != ' + appContainer + ') ***'));
            const bp = xml.match(/BlueprintIdentifier = "([^"]*)"[\s\S]*?BuildableName = "[^"]*\.appex"/);
            D('    BlueprintIdentifier=' + (bp ? bp[1] : '?') +
              (bp && bp[1] === extUuid ? ' (matches ext uuid)' : ' (*** uuid MISMATCH ***)'));
            // Resolve container the way Xcode does: relative to the dir CONTAINING the .xcworkspace
            // (or .xcodeproj) the scheme belongs to — for a cordova project that is iosDir, where the
            // .xcodeproj lives. (Resolving relative to the scheme FILE's dir is wrong for workspace-hosted
            // schemes and produced a misleading MISSING; the decisive signal is "ext container == app
            // container" above.)
            const containerRel = m[2].replace(/^container:/, '');
            const resolved = path.resolve(iosDir, containerRel);
            let exists = false;
            try { exists = fs.statSync(resolved).isDirectory(); } catch (e) { exists = false; }
            D('    container resolves to ' + resolved + ' -> ' + (exists ? 'EXISTS' : '*** MISSING ***') +
              (path.resolve(projAbs) === resolved ? ' (== app .xcodeproj)' : ' (!= app .xcodeproj at ' + projAbs + ')'));
            const bid = xml.match(/buildImplicitDependencies = "([^"]*)"/);
            D('    buildImplicitDependencies=' + (bid ? bid[1] : '(absent)'));
        });

        // (f) workspace contents
        const wsData = path.join(iosDir, appName + '.xcworkspace', 'contents.xcworkspacedata');
        try {
            const ws = fs.readFileSync(wsData, 'utf8');
            D('contents.xcworkspacedata FileRefs:');
            (ws.match(/location = "[^"]*"/g) || []).forEach(function (l) { D('  ' + l); });
        } catch (e) { D('contents.xcworkspacedata NOT readable at ' + wsData); }

        // (g) Podfile awareness of the ext
        const podfile = path.join(iosDir, 'Podfile');
        try {
            const pf = fs.readFileSync(podfile, 'utf8');
            D('Podfile mentions ext target:', new RegExp("target\\s+'" + extName + "'").test(pf) ? 'YES' : 'no');
        } catch (e) { D('Podfile NOT readable at ' + podfile); }

        // (i) 0.11.0: ext target's resolved XCBuildConfiguration build settings from the pbxproj — cheap
        //     (no xcodebuild), so run it at every phase. Spots an exclusion setting (SDKROOT /
        //     SUPPORTED_PLATFORMS / SKIP_INSTALL / EXCLUDED_ARCHITECTURES / ONLY_ACTIVE_ARCH ...).
        dumpExtResolvedBuildSettings(proj, extName, D);

        // (h)+(j) THE DECISIVE xcodebuild probes: -list (schemes/targets) and -showBuildSettings (does the
        //     scheme resolution include the ext target?). Each SPAWNS a blocking xcodebuild against the live
        //     workspace graph (tens of seconds to minutes on the ~46-target MABS Pods workspace). To avoid
        //     adding that cost TWICE to a PAID build, run them ONLY at before_compile — the exact pre-archive
        //     state that decides the outcome. (after_prepare still gets the cheap dumps above + the full
        //     per-phase ios-widget-diag.js timeline.)
        if (hookType === 'before_compile') {
            runXcodebuildList(iosDir, appName, projName, extName, D);
            runShowBuildSettings(iosDir, appName, projName, extName, D);
        } else {
            D('skipping xcodebuild -list/-showBuildSettings at phase=' + hookType + ' (they run at before_compile)');
        }

        D('=========== END (phase=' + hookType + ') ===========');
    } catch (e) {
        console.error('[nos-widgets][diag] diagnostics threw (non-fatal): ' + e.stack);
    }
}

// `xcodebuild -workspace <ws> -list -json` (fallback to -project): the ground truth of what
// xcodebuild resolves as schemes/targets in the live workspace graph.
function runXcodebuildList(iosDir, appName, projName, extName, D) {
    const cp = require('child_process');
    const ws = path.join(iosDir, appName + '.xcworkspace');
    const args = fs.existsSync(ws)
        ? ['-workspace', ws, '-list', '-json']
        : ['-project', path.join(iosDir, projName), '-list', '-json'];
    D('running: xcodebuild ' + args.join(' '));
    let out = '';
    try {
        out = cp.execFileSync('xcodebuild', args, {
            encoding: 'utf8', timeout: 180000, maxBuffer: 64 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: Object.assign({}, process.env, { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' })
        });
    } catch (e) {
        const timedOut = e && (e.code === 'ETIMEDOUT' || /ETIMEDOUT/.test(String(e.message)));
        D('xcodebuild -list ' + (timedOut ? 'TIMED OUT (INCONCLUSIVE — not a NO)' : 'FAILED') + ': ' + (e.message || e) +
          (e.stdout ? ' | stdout=' + String(e.stdout).slice(0, 1000) : '') + (e.stderr ? ' | stderr=' + String(e.stderr).slice(0, 1000) : ''));
        return;
    }
    D('xcodebuild -list -json:');
    out.split('\n').forEach(function (line) { D('  ' + line); });
    let parsed = null;
    try { parsed = JSON.parse(out); } catch (e) { /* keep raw */ }
    if (parsed) {
        const info = parsed.workspace || parsed.project || {};
        const schemes = info.schemes || [];
        const targets = info.targets || [];
        D('ASSERT "' + extName + '" listed as a SCHEME:', schemes.indexOf(extName) !== -1 ? 'YES' : 'no');
        D('ASSERT "' + extName + '" listed as a TARGET:', targets.indexOf(extName) !== -1 ? 'YES' : 'no');
    }
}

// 0.11.0: `xcodebuild -showBuildSettings -scheme <app> -json`. This resolves the SCHEME's build
// graph (the same resolution xcodebuild archive uses). If the ext target appears here (an entry whose
// target/PRODUCT_NAME == <ext>), the scheme resolution INCLUDES it; if not, xcodebuild has dropped it
// from the graph BEFORE compiling — the exact failure we're hunting on MABS. Non-fatal, ~300s timeout.
function runShowBuildSettings(iosDir, appName, projName, extName, D) {
    const cp = require('child_process');
    const ws = path.join(iosDir, appName + '.xcworkspace');
    const baseArgs = fs.existsSync(ws)
        ? ['-workspace', ws, '-scheme', appName]
        : ['-project', path.join(iosDir, projName), '-scheme', appName];
    const args = ['-showBuildSettings'].concat(baseArgs).concat(['-json']);
    D('running: xcodebuild ' + args.join(' '));
    let out = '';
    try {
        out = cp.execFileSync('xcodebuild', args, {
            encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: Object.assign({}, process.env, { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' })
        });
    } catch (e) {
        const timedOut = e && (e.code === 'ETIMEDOUT' || /ETIMEDOUT/.test(String(e.message)));
        D('xcodebuild -showBuildSettings ' + (timedOut
            ? 'TIMED OUT after 300s (INCONCLUSIVE — does NOT mean the ext is absent)'
            : 'FAILED') + ': ' + (e.message || e) +
          (e.stderr ? ' | stderr=' + String(e.stderr).slice(0, 2000) : ''));
        return;
    }
    let parsed = null;
    // -showBuildSettings -json emits a JSON array of { target, action, buildSettings } entries.
    try { parsed = JSON.parse(out); } catch (e) {
        D('xcodebuild -showBuildSettings -json: could not parse JSON (' + e.message + '); raw head:');
        out.split('\n').slice(0, 20).forEach(function (l) { D('  ' + l); });
        return;
    }
    if (!Array.isArray(parsed)) { parsed = [parsed]; }
    const names = parsed.map(function (entry) {
        const bs = (entry && entry.buildSettings) || {};
        return entry.target || bs.PRODUCT_NAME || bs.TARGET_NAME || '?';
    });
    D('showBuildSettings returned ' + parsed.length + ' target entr(y/ies): [' + names.join(', ') + ']');
    const extIncluded = parsed.some(function (entry) {
        const bs = (entry && entry.buildSettings) || {};
        return entry.target === extName || bs.PRODUCT_NAME === extName || bs.TARGET_NAME === extName;
    });
    D('ASSERT scheme resolution (showBuildSettings) includes "' + extName + '":',
      extIncluded ? 'YES' : '*** NO — ext target NOT in the resolved scheme graph ***');
}

// 0.11.0: dump the EXTENSION target's resolved XCBuildConfiguration build settings straight from the
// parsed pbxproj (no xcodebuild needed). Spotlights settings that could exclude it from a build:
// SDKROOT / SUPPORTED_PLATFORMS / PRODUCT_TYPE / SKIP_INSTALL / IPHONEOS_DEPLOYMENT_TARGET /
// CODE_SIGN_STYLE / EXCLUDED_ARCHITECTURES / ONLY_ACTIVE_ARCH.
function dumpExtResolvedBuildSettings(proj, extName, D) {
    const KEYS = ['SDKROOT', 'SUPPORTED_PLATFORMS', 'PRODUCT_TYPE', 'SKIP_INSTALL',
        'IPHONEOS_DEPLOYMENT_TARGET', 'CODE_SIGN_STYLE', 'EXCLUDED_ARCHITECTURES',
        'ONLY_ACTIVE_ARCH', 'PRODUCT_BUNDLE_IDENTIFIER', 'PRODUCT_NAME'];
    try {
        const configs = proj.pbxXCBuildConfigurationSection();
        const quotedExt = '"' + extName + '"';
        let found = 0;
        for (const key in configs) {
            if (key.indexOf('_comment') !== -1) { continue; }
            const c = configs[key];
            if (!c || !c.buildSettings) { continue; }
            if (c.buildSettings.PRODUCT_NAME !== quotedExt && c.buildSettings.PRODUCT_NAME !== extName) { continue; }
            found++;
            D('ext build settings (config name=' + String(c.name || '?').replace(/"/g, '') + '):');
            KEYS.forEach(function (k) {
                D('  ' + k + ' = ' + (typeof c.buildSettings[k] === 'undefined' ? '(unset)' : c.buildSettings[k]));
            });
        }
        if (found > 0) {
            D('  NOTE: cordova-ios build() runs writeCodeSignStyle AFTER this hook and overwrites CODE_SIGN_STYLE');
            D('        on ALL targets — the CODE_SIGN_STYLE above is the PRE-build value; see the after_compile');
            D('        [nos-diag] re-read for what xcodebuild actually used.');
        }
        if (found === 0) { D('ext build settings: NONE found (PRODUCT_NAME=' + extName + ' absent from XCBuildConfiguration)'); }
    } catch (e) {
        D('dumpExtResolvedBuildSettings threw (non-fatal): ' + (e.message || e));
    }
}
