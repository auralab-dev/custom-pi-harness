#!/usr/bin/env node
import {
  mkdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

export const PAPERCLIP_INSTRUCTIONS_MARKER =
  "The above agent instructions were loaded from ";
export const PAPERCLIP_INSTRUCTIONS_SEPARATOR =
  ". Resolve any relative file references from ";

function canonicalDirectory(path, label) {
  const absolute = resolve(path);
  const canonical = realpathSync(absolute);
  if (!statSync(canonical).isDirectory()) {
    throw new Error(`${label} is not a directory: ${canonical}`);
  }
  return canonical;
}

function canonicalFile(path, label) {
  const absolute = resolve(path);
  const canonical = realpathSync(absolute);
  if (!statSync(canonical).isFile()) {
    throw new Error(`${label} is not a file: ${canonical}`);
  }
  return canonical;
}

function optionValues(args, longName) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === longName) {
      if (index + 1 < args.length) values.push(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith(`${longName}=`)) {
      values.push(arg.slice(longName.length + 1));
    }
  }
  return values;
}

export function extractPaperclipInstructionsFile(args) {
  // Paperclip appends this sentence after the agent-authored instruction text.
  // Search from the end so a copied/fake marker inside the instructions cannot
  // widen the filesystem scope.
  const prompts = optionValues(args, "--append-system-prompt");
  for (let promptIndex = prompts.length - 1; promptIndex >= 0; promptIndex -= 1) {
    const prompt = prompts[promptIndex];
    const markerIndex = prompt.lastIndexOf(PAPERCLIP_INSTRUCTIONS_MARKER);
    if (markerIndex === -1) continue;

    const pathStart = markerIndex + PAPERCLIP_INSTRUCTIONS_MARKER.length;
    const separatorIndex = prompt.indexOf(PAPERCLIP_INSTRUCTIONS_SEPARATOR, pathStart);
    if (separatorIndex === -1) continue;

    const candidate = prompt.slice(pathStart, separatorIndex).trim();
    if (!candidate || !isAbsolute(candidate)) continue;
    return candidate;
  }
  return null;
}

export function resolveScope({ workspace, args = [], env = process.env }) {
  const workspaceRoot = canonicalDirectory(workspace, "Workspace root");

  const explicitRoot = env.PI_HARNESS_INSTRUCTIONS_ROOT?.trim();
  const explicitFile = env.PI_HARNESS_INSTRUCTIONS_FILE?.trim();
  if (explicitRoot && explicitFile) {
    throw new Error(
      "Set only one of PI_HARNESS_INSTRUCTIONS_ROOT or PI_HARNESS_INSTRUCTIONS_FILE",
    );
  }

  let instructionsRoot = null;
  let instructionsSource = "none";

  if (explicitRoot) {
    instructionsRoot = canonicalDirectory(explicitRoot, "Instructions root");
    instructionsSource = "PI_HARNESS_INSTRUCTIONS_ROOT";
  } else {
    const instructionsFile = explicitFile || extractPaperclipInstructionsFile(args);
    if (instructionsFile) {
      const canonical = canonicalFile(instructionsFile, "Instructions file");
      instructionsRoot = canonicalDirectory(dirname(canonical), "Instructions root");
      instructionsSource = explicitFile
        ? "PI_HARNESS_INSTRUCTIONS_FILE"
        : "Paperclip --append-system-prompt";
    }
  }

  return { workspaceRoot, instructionsRoot, instructionsSource };
}

export function buildPlaypenConfig(scope) {
  const projects = [
    {
      root: scope.workspaceRoot,
      access: "read-write",
    },
  ];

  if (scope.instructionsRoot && scope.instructionsRoot !== scope.workspaceRoot) {
    projects.push({
      root: scope.instructionsRoot,
      access: "read-only",
    });
  }

  return {
    version: 1,
    enabled: true,
    defaultSandbox: "paperclip-run",
    sandboxes: {
      "paperclip-run": {
        projects,
        sandboxRuntime: {
          network: {
            allowedDomains: [],
            deniedDomains: [],
          },
          filesystem: {
            allowRead: [],
            denyRead: [],
            allowWrite: [],
            denyWrite: [],
          },
        },
      },
    },
  };
}

export function writePlaypenConfig({ workspace, output, args = [], env = process.env }) {
  const scope = resolveScope({ workspace, args, env });
  const config = buildPlaypenConfig(scope);
  const outputPath = resolve(output);
  mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 });
  const temporary = `${outputPath}.tmp.${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, outputPath);
  return { ...scope, outputPath };
}

function parseCli(argv) {
  const separator = argv.indexOf("--");
  const ownArgs = separator === -1 ? argv : argv.slice(0, separator);
  const forwardedArgs = separator === -1 ? [] : argv.slice(separator + 1);
  let workspace = null;
  let output = null;

  for (let index = 0; index < ownArgs.length; index += 1) {
    const arg = ownArgs[index];
    if (arg === "--workspace") {
      workspace = ownArgs[++index];
    } else if (arg === "--output") {
      output = ownArgs[++index];
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!workspace) throw new Error("Missing --workspace");
  if (!output) throw new Error("Missing --output");
  return { workspace, output, forwardedArgs };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { workspace, output, forwardedArgs } = parseCli(process.argv.slice(2));
    const scope = writePlaypenConfig({
      workspace,
      output,
      args: forwardedArgs,
      env: process.env,
    });
    if (/^(?:1|true|yes|on)$/i.test(process.env.PI_HARNESS_LOG ?? "")) {
      console.error(`[pi-harness] Playpen workspace (RW): ${scope.workspaceRoot}`);
      if (scope.instructionsRoot) {
        console.error(
          `[pi-harness] Playpen instructions (RO): ${scope.instructionsRoot} (${scope.instructionsSource})`,
        );
      } else {
        console.error("[pi-harness] Playpen instructions: none detected; workspace-only scope");
      }
    }
  } catch (error) {
    console.error(`[pi-harness] Failed to prepare Playpen config: ${error.message}`);
    process.exitCode = 1;
  }
}
