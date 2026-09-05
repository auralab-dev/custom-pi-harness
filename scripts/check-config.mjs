import { existsSync, readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const rootPath = (relativePath) => new URL(relativePath, root);

const requiredFiles = [
  "README.md",
  ".env.local.example",
  ".mcp.json",
  "pi-web-access/LICENSE",
];

for (const relativePath of requiredFiles) {
  if (!existsSync(rootPath(relativePath))) {
    throw new Error(`Missing required public-runtime file: ${relativePath}`);
  }
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
if (!launcher.includes('--extension "$ROOT/pi-workspace-boundary/index.ts"')) {
  throw new Error("run-pi-local.sh must load the read/find workspace boundary");
}
if (launcher.includes('PI_HARNESS_EXCLUDE_TOOLS:-read,')) {
  throw new Error("run-pi-local.sh must keep bounded read enabled by default");
}
if (!launcher.includes('filter_pi_tool_allowlists "$@"')) {
  throw new Error("run-pi-local.sh must remove caller tool allowlists");
}

const packageJson = JSON.parse(readFileSync(rootPath("package.json"), "utf8"));
if (packageJson.packageManager !== "pnpm@11.24.0") {
  throw new Error("package.json must pin the supported pnpm version");
}
if (!/^github:auralab-dev\/paperclip-mcp#[0-9a-f]{40}$/.test(packageJson.dependencies?.["paperclip-mcp-server"] ?? "")) {
  throw new Error("paperclip-mcp-server must be pinned to a full Git commit SHA");
}

console.log("Harness configuration checks passed");
