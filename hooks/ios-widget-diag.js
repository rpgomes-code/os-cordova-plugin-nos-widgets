'use strict';

/**
 * 0.11.0 MAXIMUM INSTRUMENTATION — PURE-DIAGNOSTIC iOS hook (NO injection).
 *
 * Registered for EVERY iOS hook phase (before_prepare, after_prepare, before_compile,
 * after_compile, before_build, after_build). It NEVER modifies anything: it only reads the
 * generated Xcode project / schemes / workspace / Podfile with RAW fs + regex (deliberately NOT
 * node-xcode, so it is robust even if the pbxproj is in a state node-xcode can't parse) and dumps
 * a "[nos-diag] " block. The goal is to reveal, on a MABS build, EXACTLY when/where the injected
 * NosWidgetExtension wiring is lost between hook phases (e.g. a stage that rewrites the pbxproj or
 * regenerates the shared scheme after our injection).
 *
 * Everything is wrapped in try/catch and this hook NEVER throws out of the hook — a diagnostic
 * must never break a build.
 */

const fs = require('fs');
const path = require('path');

const EXT_NAME = 'NosWidgetExtension';
const APPEX = EXT_NAME + '.appex';

module.exports = function (context) {
    const L = function () {
        try { console.log('[nos-diag] ' + Array.prototype.join.call(arguments, ' ')); } catch (e) { /* ignore */ }
    };
    try {
        const hookType = (context && context.hook) || 'unknown';
        const projectRoot = (context && context.opts && context.opts.projectRoot) || process.cwd();
        L('=========== BEGIN phase=' + hookType + ' @ ' + new Date().toISOString() + ' ===========');

        const iosDir = path.join(projectRoot, 'platforms', 'ios');
        if (!fs.existsSync(iosDir)) {
            L('phase=' + hookType + ' project not present yet (no platforms/ios)');
            L('=========== END phase=' + hookType + ' ===========');
            return;
        }

        const projName = safeReaddir(iosDir).find(function (f) { return f.endsWith('.xcodeproj'); });
        if (!projName) {
            L('phase=' + hookType + ' project not present yet (no .xcodeproj under platforms/ios)');
            L('=========== END phase=' + hookType + ' ===========');
            return;
        }
        const appName = projName.replace('.xcodeproj', '');
        const pbxPath = path.join(iosDir, projName, 'project.pbxproj');
        if (!fs.existsSync(pbxPath)) {
            L('phase=' + hookType + ' project not present yet (no project.pbxproj)');
            L('=========== END phase=' + hookType + ' ===========');
            return;
        }

        L('app=' + appName + ' proj=' + projName);

        // ------------------------------------------------------------------ project.pbxproj (raw)
        let pbx = '';
        try { pbx = fs.readFileSync(pbxPath, 'utf8'); } catch (e) { L('pbxproj NOT readable: ' + e.message); }
        if (pbx) {
            const pbxMtime = safeMtime(pbxPath);
            L('project.pbxproj mtime=' + pbxMtime + ' size=' + pbx.length);

            // count of "NosWidgetExtension" occurrences
            const occ = (pbx.match(new RegExp(EXT_NAME, 'g')) || []).length;
            L('pbxproj "' + EXT_NAME + '" occurrences=' + occ);

            // PBXNativeTarget with productType app-extension named NosWidgetExtension?
            // Native target entries look like:  ... isa = PBXNativeTarget; ... name = NosWidgetExtension; ... productType = "com.apple.product-type.app-extension"; ...
            const nativeTargetBlocks = pbx.match(/isa = PBXNativeTarget;[\s\S]*?productType = [^;]+;/g) || [];
            let extTargetFound = false;
            nativeTargetBlocks.forEach(function (b) {
                if (/name = ("?)NosWidgetExtension\1;/.test(b) && /productType = "com\.apple\.product-type\.app-extension"/.test(b)) {
                    extTargetFound = true;
                }
            });
            L('pbxproj PBXNativeTarget(app-extension) named ' + EXT_NAME + ': ' + (extTargetFound ? 'PRESENT' : '*** ABSENT ***'));

            // dstSubfolderSpec = 13 (embed app extensions copy-files phase)
            L('pbxproj "dstSubfolderSpec = 13" present: ' + (/dstSubfolderSpec = 13/.test(pbx) ? 'YES' : 'no'));

            // PBXBuildFile referencing NosWidgetExtension.appex
            const appexBuildFile = new RegExp('PBXBuildFile[^\\n]*' + APPEX.replace('.', '\\.')).test(pbx) ||
                new RegExp(APPEX.replace('.', '\\.') + '[^\\n]*PBXBuildFile').test(pbx) ||
                new RegExp('/\\* ' + APPEX.replace('.', '\\.') + ' in [^*]*\\*/ = \\{isa = PBXBuildFile').test(pbx);
            L('pbxproj PBXBuildFile referencing ' + APPEX + ': ' + (appexBuildFile ? 'YES' : 'no'));

            // count PBXTargetDependency / PBXContainerItemProxy entries
            L('pbxproj PBXTargetDependency entries=' + countIsa(pbx, 'PBXTargetDependency') +
              ' | PBXContainerItemProxy entries=' + countIsa(pbx, 'PBXContainerItemProxy'));

            // ext target's resolved build settings dump (best-effort raw scan)
            dumpExtBuildSettings(pbx, L);
        }

        // ------------------------------------------------------------------ schemes (raw walk)
        const schemes = walkSchemes(iosDir);
        L('xcscheme files found under platforms/ios: ' + schemes.length);
        schemes.forEach(function (sf) {
            let xml = '';
            try { xml = fs.readFileSync(sf, 'utf8'); } catch (e) { L('  scheme NOT readable: ' + sf + ' (' + e.message + ')'); return; }
            const mtime = safeMtime(sf);
            L('  scheme ' + sf + ' mtime=' + mtime);

            // does it contain a BuildActionEntry whose BuildableName="NosWidgetExtension.appex"?
            const hasAppexEntry = xml.indexOf('BuildableName = "' + APPEX + '"') !== -1;
            L('    contains ' + APPEX + ' BuildActionEntry: ' + (hasAppexEntry ? 'YES' : 'no'));
            if (hasAppexEntry) {
                const blockRe = /<BuildActionEntry\b[\s\S]*?<\/BuildActionEntry>/g;
                let m;
                while ((m = blockRe.exec(xml)) !== null) {
                    const block = m[0];
                    if (block.indexOf('BuildableName = "' + APPEX + '"') === -1) { continue; }
                    const ref = (block.match(/ReferencedContainer = "([^"]*)"/) || [])[1];
                    const bp = (block.match(/BlueprintIdentifier = "([^"]*)"/) || [])[1];
                    L('    ext entry ReferencedContainer=' + ref + ' BlueprintIdentifier=' + bp);
                }
            }
            const bid = (xml.match(/buildImplicitDependencies = "([^"]*)"/) || [])[1];
            L('    BuildAction buildImplicitDependencies=' + (bid || '(absent)'));

            // Dump the FULL raw <BuildAction>...</BuildAction> block verbatim.
            const baMatch = xml.match(/<BuildAction\b[\s\S]*?<\/BuildAction>/);
            if (baMatch) {
                L('    ---- RAW <BuildAction> BEGIN (' + sf + ') ----');
                baMatch[0].split('\n').forEach(function (ln) { L('    | ' + ln); });
                L('    ---- RAW <BuildAction> END ----');
            } else {
                L('    (no <BuildAction> block found in this scheme)');
            }
        });

        // ------------------------------------------------------------------ workspace contents
        const wsData = path.join(iosDir, appName + '.xcworkspace', 'contents.xcworkspacedata');
        try {
            const ws = fs.readFileSync(wsData, 'utf8');
            const refs = ws.match(/location = "[^"]*"/g) || [];
            L('contents.xcworkspacedata FileRefs (' + refs.length + '):');
            refs.forEach(function (r) { L('  ' + r); });
        } catch (e) { L('contents.xcworkspacedata NOT readable at ' + wsData); }

        // ------------------------------------------------------------------ Podfile / Pods support files
        const podfile = path.join(iosDir, 'Podfile');
        try {
            const pf = fs.readFileSync(podfile, 'utf8');
            L('Podfile mentions ' + EXT_NAME + ' target: ' +
              (new RegExp("target\\s+['\"]" + EXT_NAME + "['\"]").test(pf) ? 'YES' : 'no'));
        } catch (e) { L('Podfile NOT readable at ' + podfile); }

        const podsSupport = path.join(iosDir, 'Pods', 'Target Support Files', 'Pods-' + EXT_NAME);
        L('Pods/Target Support Files/Pods-' + EXT_NAME + ' exists: ' +
          (fs.existsSync(podsSupport) ? 'YES' : 'no'));

        // ---------------------------------------------------- built products (ground-truth archive outcome)
        inspectBuiltProducts(iosDir, L);

        L('=========== END phase=' + hookType + ' ===========');
    } catch (e) {
        try { console.error('[nos-diag] diagnostics threw (non-fatal): ' + (e && e.stack ? e.stack : e)); } catch (e2) { /* ignore */ }
    }
};

// ---------------------------------------------------------------------------- helpers

function safeReaddir(dir) {
    try { return fs.readdirSync(dir); } catch (e) { return []; }
}

function safeMtime(p) {
    try { return fs.statSync(p).mtime.toISOString(); } catch (e) { return '(unknown)'; }
}

// Count "isa = <name>;" occurrences (number of objects of that section type) in raw pbxproj text.
function countIsa(pbx, name) {
    return (pbx.match(new RegExp('isa = ' + name + ';', 'g')) || []).length;
}

// Walk platforms/ios for *.xcscheme, skipping heavy/irrelevant dirs.
function walkSchemes(iosDir) {
    const SKIP = new Set(['Pods', 'build', 'CordovaLib', 'DerivedData', 'node_modules', '.git']);
    const out = [];
    (function walk(dir, depth) {
        if (depth > 8) { return; }
        let ents;
        try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
        for (const ent of ents) {
            const p = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                if (!SKIP.has(ent.name)) { walk(p, depth + 1); }
            } else if (ent.name.endsWith('.xcscheme')) {
                out.push(p);
            }
        }
    })(iosDir, 0);
    return out;
}

// Best-effort raw dump of the EXTENSION target's XCBuildConfiguration build settings. We find every
// XCBuildConfiguration block whose buildSettings mention PRODUCT_NAME = NosWidgetExtension and report
// the exclusion-relevant keys.
function dumpExtBuildSettings(pbx, L) {
    const KEYS = ['SDKROOT', 'SUPPORTED_PLATFORMS', 'PRODUCT_TYPE', 'SKIP_INSTALL',
        'IPHONEOS_DEPLOYMENT_TARGET', 'CODE_SIGN_STYLE', 'EXCLUDED_ARCHITECTURES',
        'ONLY_ACTIVE_ARCH', 'PRODUCT_BUNDLE_IDENTIFIER'];
    // Match the config name + isa + buildSettings together. node-xcode writes `name = Debug;` immediately
    // BEFORE `isa = XCBuildConfiguration;`, so anchoring the block at `isa = ...` (as before) dropped the
    // name and always printed name=?. Capturing from `name = ...;` keeps Debug/Release distinguishable.
    const blocks = pbx.match(/name = [^;]+;\s*isa = XCBuildConfiguration;[\s\S]*?buildSettings = \{[\s\S]*?\};/g) || [];
    let dumped = 0;
    blocks.forEach(function (b) {
        if (!/PRODUCT_NAME = ("?)NosWidgetExtension\1;/.test(b)) { return; }
        dumped++;
        const name = (b.match(/name = ([^;]+);/) || [])[1] || '?';
        L('  ext XCBuildConfiguration name=' + String(name).replace(/"/g, '') + ' settings:');
        KEYS.forEach(function (k) {
            const m = b.match(new RegExp('\\b' + k + ' = ([^;]+);'));
            L('    ' + k + ' = ' + (m ? m[1].trim() : '(unset)'));
        });
    });
    if (dumped === 0) { L('  ext XCBuildConfiguration: none found (PRODUCT_NAME=' + EXT_NAME + ' absent from build settings)'); }
}

// 0.11.0: GROUND-TRUTH OUTCOME. After the archive exists (after_compile/after_build run AFTER the
// `xcodebuild ... archive` step), find the produced .xcarchive / .app / .ipa under platforms/ios and report
// whether <ext>.appex actually landed in the app's PlugIns. This is the single most decisive datum — the
// in-build [nos-rs] markers tell us whether the ext target BUILT; this tells us whether it SHIPPED.
// Self-gating: at earlier phases nothing is built yet, so it just reports "no built products yet". Read-only.
function inspectBuiltProducts(iosDir, L) {
    try {
        const archives = [], apps = [], ipas = [];
        (function walk(dir, depth) {
            if (depth > 6) { return; }
            let ents;
            try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
            for (const ent of ents) {
                const p = path.join(dir, ent.name);
                if (ent.isDirectory()) {
                    if (ent.name === 'Pods' || ent.name === 'node_modules' || ent.name === '.git' ||
                        ent.name === 'DerivedData' || ent.name.endsWith('.xcodeproj') ||
                        ent.name.endsWith('.xcworkspace')) { continue; }
                    if (ent.name.endsWith('.xcarchive')) { archives.push(p); continue; } // don't recurse in
                    if (ent.name.endsWith('.app')) { apps.push(p); continue; }            // don't recurse in
                    walk(p, depth + 1);
                } else if (ent.name.endsWith('.ipa')) {
                    ipas.push(p);
                }
            }
        })(iosDir, 0);

        if (!archives.length && !apps.length && !ipas.length) {
            L('ARCHIVE OUTCOME: no built products yet (.xcarchive/.app/.ipa) under platforms/ios');
            return;
        }
        L('ARCHIVE OUTCOME: found ' + archives.length + ' .xcarchive, ' + apps.length + ' .app, ' + ipas.length + ' .ipa');
        ipas.forEach(function (f) { L('  .ipa (zip — unpack to confirm PlugIns/' + APPEX + '): ' + f); });

        const checkApp = function (appPath, origin) {
            const plugins = path.join(appPath, 'PlugIns');
            let entries = null;
            try { entries = fs.readdirSync(plugins); } catch (e) { entries = null; }
            if (entries === null) {
                L('  ' + origin + ' ' + appPath + ' -> NO PlugIns dir (' + APPEX + ' *** ABSENT ***)');
            } else {
                const has = entries.indexOf(APPEX) !== -1;
                L('  ' + origin + ' ' + appPath + ' -> PlugIns=[' + entries.join(', ') + '] | ' +
                  APPEX + ': ' + (has ? '*** PRESENT ***' : '*** ABSENT ***'));
            }
        };

        archives.forEach(function (arch) {
            const appsDir = path.join(arch, 'Products', 'Applications');
            let appNames = [];
            try { appNames = fs.readdirSync(appsDir).filter(function (n) { return n.endsWith('.app'); }); } catch (e) { appNames = []; }
            if (!appNames.length) { L('  archive ' + arch + ' -> no .app under Products/Applications'); return; }
            appNames.forEach(function (n) { checkApp(path.join(appsDir, n), 'archive-app'); });
        });
        apps.forEach(function (a) { checkApp(a, 'app'); });
    } catch (e) {
        L('inspectBuiltProducts threw (non-fatal): ' + (e && e.message ? e.message : e));
    }
}
