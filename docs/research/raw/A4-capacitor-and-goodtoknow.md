# OutSystems Capacitor Adoption + Good-to-Know Repos
(agent A4)

## STRATEGIC FINDING — Cordova → Capacitor migration (gated on MABS 12)
- OutSystems is migrating ODC mobile from Apache Cordova to **Capacitor**. Official: *"With MABS 12, you can already start building mobile apps using the Capacitor stack… For new apps, OutSystems recommends using the Capacitor stack."*
  - Blog: https://www.outsystems.com/blog/posts/mobile-app-development-capacitor-odc/
  - MABS Capacitor/Cordova support doc: https://success.outsystems.com/documentation/outsystems_developer_cloud/building_apps/mobile_apps/create_mobile_app_package/capacitor_and_cordova_support_in_mabs/
  - Migrate-Cordova-to-Capacitor guide: https://success.outsystems.com/documentation/outsystems_developer_cloud/integration_with_external_systems/mobile_plugins/migrate_cordova_plugin_to_capacitor_plugin/
- Both stacks run in parallel during transition; a plugin's "mobile frameworks" extensibility field marks Capacitor vs Cordova. Cordova = legacy but still the OS11 path.
- **MABS 11.2+ build infra runs on Ionic Appflow** → cross-corroborates agent 3: Appflow has supported app-extension multi-profile signing since Dec 2020. STRONG lead for our extension-signing blocker.
- ODC Capacitor uses JSON **build-actions** applied post-`capacitor sync` (NOT Cordova config.xml/hooks) for build-time config injection (manifest/Info.plist/entitlements). A widget plugin's edits would use this.

### Implications for our plugin strategy
1. Only ONE public Capacitor repo exists today: **capacitor-outsystems-sslpinning** — the canonical ODC Capacitor plugin TEMPLATE: Swift Package + podspec (iOS), Gradle module (Android), TS `dist/` bridge, semantic-release CI, `build-actions/*.json` for build-time injection. https://github.com/OutSystems/capacitor-outsystems-sslpinning  (peerDep `@capacitor/core >=8.0.0`)
2. Our Cordova plugin still works (OS11 + ODC Cordova stack), but **new investment should target Capacitor** (MABS 12+). Budget a migration following the official guide.
3. Build-time edits on ODC Capacitor = build-actions JSON, not hooks — different mechanism than our current after_prepare hook.

## outsystems-mcp — official agentic tooling (good-to-know, possibly useful to US)
- https://github.com/OutSystems/outsystems-mcp — distribution repo for OutSystems' **remote MCP server**: *"Edit, publish, deploy OutSystems apps from your AI assistant."* Ships a **Claude Code plugin** (+ Kiro Power). Install: `claude plugin marketplace add OutSystems/outsystems-mcp`. Early Alpha, no SLA.
- Streamable-HTTP MCP endpoint at `https://<tenant>/mcp` w/ OAuth + Dynamic Client Registration. Tool surface: Apps (`app_list/info/refs`), Context Service (entities/actions/screens/structures/roles/themes/connections), **Mentor** (server-side OML editing: `mentor_start`→`mentor_get_run`), Publish (`publish_*`), Deployments (`deploy_*` incl rollback/impact), External Libraries (`extlib_upload/publish/download_source`, 50MB cap), Environments.
- Constraint: OML stays server-side (no `app_download`). Server itself NOT open-source (only the install package). `mcp-python-sdk` fork signals the server is Python.

## secure-sqlite-bundle — Cordova META-PLUGIN pattern (worth copying)
- https://github.com/OutSystems/cordova-outsystems-secure-sqlite-bundle — a thin meta-plugin: plugin.xml is almost pure glue = several `<dependency>` entries on **org-owned forks pinned to `#<version>-OS<n>` tags** + one `<js-module>` that `<clobbers>` a clean global facade + manifest tweaks (`allowBackup=false`). Composes SQLCipher + SecureStorage + disable-backup into a "one plugin add" experience. Pattern for shipping our widget plugin as a curated bundle.

## Good-to-know OutSystems repos (curated; excludes the ~100 cordova-plugin mirrors)
**ODC / platform dev tools:**
- OutSystems.ExternalLibraries.SDK-templates — C# starters for ODC External Libraries (custom .NET server logic). https://github.com/OutSystems/OutSystems.ExternalLibraries.SDK-templates
- mcp-python-sdk (fork) — signals MCP server is Python. https://github.com/OutSystems/mcp-python-sdk
- UltimatePDF-ExternalLogic, vanguard-xml-to-json — worked ODC External Library examples.

**CI/CD & ops:**
- outsystems-pipeline (~46★, Python) — integrate OS11 with Jenkins/Azure DevOps via LifeTime Deployment API. https://github.com/OutSystems/outsystems-pipeline
- odc-jenkins-pipeline (Groovy, ODC deploys), OutSystems.SetupTools (~21★ PowerShell), techsupp-osdiagtool (~13★ C# diag), cloud-connector (Go, on-prem↔cloud), outsystems-hybrid-provision (self-hosted ODC), AzureARMTemplates/outsystems-chef/kud (IaC), outsystems-elastic-integration.

**Web/runtime (OutSystems UI stack):**
- outsystems-ui (~70★ TS — the UI framework source), outsystems-datagrid, outsystems-maps, os-rds (Reactive Design System), outsystems-ui-kit. Plus deliberately fork-and-tracked UI primitives: floating-ui, popper, flatpickr, virtual-select, react-select.

**Desktop/native-shell (Service Studio internals, high-star OSS):**
- WebView (591★, Avalonia/WPF CefGlue webview — most-starred org repo), CefGlue (446★ .NET CEF binding), ReactView (37★), ts2lang.

**Networking/infra forks:** chisel (Go HTTP tunnel), ios-webkit-debug-proxy (debug iOS WebView), os-plugins-base-interface (shared plugin contract), httpmock/wiremock/pact-python (test infra), monaco/vscode/ace/prism (editor forks).

**Docs (open-source, grep-able):** docs-product (OS11 ~52★), docs-odc (ODC), docs-support (~19★), docs-howtos (~18★) — sources behind success.outsystems.com.
