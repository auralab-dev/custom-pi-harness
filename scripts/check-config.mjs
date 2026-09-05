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

const packageJson = JSON.parse(readFileSync(rootPath("package.json"), "utf8"));
if (packageJson.packageManager !== "pnpm@11.24.0") {
  throw new Error("package.json must pin the supported pnpm version");
}
if (!/^github:auralab-dev\/paperclip-mcp#[0-9a-f]{40}$/.test(packageJson.dependencies?.["paperclip-mcp-server"] ?? "")) {
  throw new Error("paperclip-mcp-server must be pinned to a full Git commit SHA");
}

console.log("Harness configuration checks passed");
