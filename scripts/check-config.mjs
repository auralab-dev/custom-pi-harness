import { existsSync, readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const rootPath = (relativePath) => new URL(relativePath, root);

const requiredFiles = [
  "README.md",
  ".env.local.example",
  ".mcp.json",
  "pi-web-access/LICENSE",
  "scripts/prepare-playpen-config.mjs",
  "scripts/prepare-playpen-config.test.mjs",
  "scripts/pi-playpen-scoped.ts",
];

for (const relativePath of requiredFiles) {
  if (!existsSync(rootPath(relativePath))) {
    throw new Error(`Missing required public-runtime file: ${relativePath}`);
  }
}
if (existsSync(rootPath("pi-workspace-boundary"))) {
  throw new Error("Legacy pi-workspace-boundary must be removed");
}

const webConfig = JSON.parse(readFileSync(rootPath(".pi/web-search.json"), "utf8"));
if (
  webConfig.provider !== "tinyfish"
  || webConfig.workflow !== "none"
  || webConfig.toolSchemaMode !== "minimal"
) {
  throw new Error(".pi/web-search.json must keep the TinyFish minimal profile");
}
for (const [key, value] of Object.entries(webConfig)) {
  if (/(?:apiKey|token|password|secret)$/i.test(key) && value !== undefined && value !== "") {
    throw new Error(`Credential-like value must not be committed in .pi/web-search.json: ${key}`);
  }
}

const allBuiltins = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const repoSettings = JSON.parse(readFileSync(rootPath(".pi/settings.json"), "utf8"));
if (JSON.stringify(repoSettings.defaultTools) !== JSON.stringify(allBuiltins)) {
  throw new Error(`.pi/settings.json defaultTools must be ${JSON.stringify(allBuiltins)}`);
}

const mcpConfig = JSON.parse(readFileSync(rootPath(".mcp.json"), "utf8"));
const paperclip = mcpConfig?.mcpServers?.paperclip;
if (!paperclip || paperclip.directTools !== true) {
  throw new Error(".mcp.json must keep Paperclip MCP directTools enabled");
}
if (paperclip.command !== "/usr/bin/env" || paperclip.args?.[0] !== "-i") {
  throw new Error(".mcp.json must clear the inherited environment before starting Paperclip MCP");
}
if (JSON.stringify(paperclip).includes("PAPERCLIP_TEST_ALLOW_WRITES")) {
  throw new Error(".mcp.json must not enable PAPERCLIP_TEST_ALLOW_WRITES");
}

const launcher = readFileSync(rootPath("run-pi-local.sh"), "utf8");
if (!launcher.includes('materialize_config "$PI_HARNESS_MCP_CONFIG" "$pi_config_dir/mcp.json"')) {
  throw new Error("run-pi-local.sh must materialize the exclusive effective MCP config");
}
if (!launcher.includes('${PI_HARNESS_LOG:-false}')) {
  throw new Error("run-pi-local.sh must keep wrapper diagnostics opt-in");
}
if (launcher.includes('export PI_CODING_AGENT_DIR=') || launcher.includes('PI_CODING_AGENT_SESSION_DIR')) {
  throw new Error("run-pi-local.sh must preserve Paperclip's Pi config and session topology");
}
if (!launcher.includes('--extension "$ROOT/scripts/pi-playpen-scoped.ts"')) {
  throw new Error("run-pi-local.sh must load the scoped pi-playpen adapter");
}
if (launcher.includes("pi-workspace-boundary")) {
  throw new Error("run-pi-local.sh must not load the legacy workspace boundary");
}
if (launcher.includes("--exclude-tools") || launcher.includes("PI_HARNESS_EXCLUDE_TOOLS")) {
  throw new Error("run-pi-local.sh must not use the legacy built-in deny-list");
}
if (!launcher.includes('filter_pi_tool_allowlists "$@"')) {
  throw new Error("run-pi-local.sh must remove Paperclip's caller --tools allowlist");
}
if (!launcher.includes('prepare-playpen-config.mjs')) {
  throw new Error("run-pi-local.sh must materialize a per-run Playpen config");
}
if (!launcher.includes('PI_HARNESS_PLAYPEN_HOME="$run_state_dir/playpen-home"')) {
  throw new Error("Playpen config HOME must be scoped per Paperclip run");
}
if (!launcher.includes('PAPERCLIP_RUN_ID:-local-$$')) {
  throw new Error("run-pi-local.sh must isolate Playpen state between concurrent runs");
}
if (!allBuiltins.every((tool) => launcher.includes(`\\"${tool}\\"`) || launcher.includes(`"${tool}"`))) {
  throw new Error("run-pi-local.sh must normalize all seven built-in tools");
}
if (!launcher.includes('--extension "$ROOT/node_modules/@agnishc/edb-context-viewer/src/index.ts"')) {
  throw new Error("run-pi-local.sh must load the edb context viewer extension");
}

const codeLines = launcher.split("\n").filter((line) => !line.trim().startsWith("#"));
const codeOnly = codeLines.join("\n");
if (/(?<!exclude-)--tools(\s|=|$)/.test(codeOnly.replaceAll("filter_pi_tool_allowlists", ""))) {
  throw new Error("run-pi-local.sh must not pass a --tools allowlist");
}

const scopeBuilder = readFileSync(rootPath("scripts/prepare-playpen-config.mjs"), "utf8");
if (!scopeBuilder.includes('access: "read-write"') || !scopeBuilder.includes('access: "read-only"')) {
  throw new Error("Playpen scope must support workspace RW plus instructions RO");
}
if (!scopeBuilder.includes("lastIndexOf(PAPERCLIP_INSTRUCTIONS_MARKER)")) {
  throw new Error("Paperclip instruction inference must use the final trusted marker");
}
if (scopeBuilder.includes('root: "/paperclip"')) {
  throw new Error("Playpen scope must never expose all of /paperclip");
}

const scopedLoader = readFileSync(rootPath("scripts/pi-playpen-scoped.ts"), "utf8");
if (!scopedLoader.includes("process.env.HOME = scopedHome") || !scopedLoader.includes("previousHome")) {
  throw new Error("Scoped Playpen loader must isolate config discovery without permanently replacing HOME");
}
if (!scopedLoader.includes("createJiti")) {
  throw new Error("Scoped Playpen loader must use jiti for the TypeScript package entrypoint");
}

const packageJson = JSON.parse(readFileSync(rootPath("package.json"), "utf8"));
if (packageJson.packageManager !== "pnpm@11.24.0") {
  throw new Error("package.json must pin the supported pnpm version");
}
if (packageJson.dependencies?.["pi-playpen"] !== "0.1.3") {
  throw new Error("pi-playpen must be pinned to exactly 0.1.3");
}
if (packageJson.dependencies?.jiti !== "2.7.0") {
  throw new Error("jiti must be pinned to exactly 2.7.0 for scoped TS extension loading");
}
if (!/^github:auralab-dev\/paperclip-mcp#[0-9a-f]{40}$/.test(packageJson.dependencies?.["paperclip-mcp-server"] ?? "")) {
  throw new Error("paperclip-mcp-server must be pinned to a full Git commit SHA");
}
if (packageJson.dependencies?.["@agnishc/edb-context-viewer"] !== "0.21.1") {
  throw new Error("@agnishc/edb-context-viewer must be pinned to exactly 0.21.1");
}
if (!repoSettings.packages?.includes("../node_modules/@agnishc/edb-context-viewer")) {
  throw new Error(".pi/settings.json packages must include ../node_modules/@agnishc/edb-context-viewer");
}

const workspaceConfig = readFileSync(rootPath("pnpm-workspace.yaml"), "utf8");
if (workspaceConfig.includes("pi-workspace-boundary")) {
  throw new Error("pnpm-workspace.yaml must not include pi-workspace-boundary");
}

console.log("Harness configuration checks passed");
