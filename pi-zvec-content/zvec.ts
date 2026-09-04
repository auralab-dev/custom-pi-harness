import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

const DEFAULT_EMBEDDING = "local/potion-retrieval-32m";
const DEFAULT_RESULT_LIMIT = 4;
const DEFAULT_MAX_RESULT_CHARS = 4000;
const PROCESS_OUTPUT_LIMIT = 64_000;
const DIAGNOSTIC_TAIL_CHARS = 4000;

export interface ZvecContentConfig {
  embedding: string;
  limit: number;
  maxResultChars: number;
}

export class ZgProcessError extends Error {
  readonly stage: "index" | "query" | "rg";
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdoutTail: string;
  readonly stderrTail: string;

  constructor(args: {
    stage: "index" | "query" | "rg";
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stdoutTail: string;
    stderrTail: string;
  }) {
    const diagnostic = args.stderrTail || args.stdoutTail;
    super(`zvec-grep ${args.stage} failed with exit ${args.exitCode ?? "unknown"}${diagnostic ? `\n${diagnostic}` : ""}`);
    this.name = "ZgProcessError";
    this.stage = args.stage;
    this.exitCode = args.exitCode;
    this.signal = args.signal;
    this.stdoutTail = args.stdoutTail;
    this.stderrTail = args.stderrTail;
  }
}

function configDir(): string {
  const explicit = process.env.PI_CODING_AGENT_DIR?.trim();
  if (explicit) return resolve(explicit);
  return resolve(process.cwd(), ".pi");
}

function configPath(): string {
  return join(configDir(), "zvec-content.json");
}

function positiveInt(value: unknown, fallback: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? Math.min(value, max)
    : fallback;
}

export function loadZvecContentConfig(): ZvecContentConfig {
  let raw: Record<string, unknown> = {};
  const path = configPath();
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
    } catch (err) {
      throw new Error(`Failed to parse ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return {
    embedding: typeof raw.embedding === "string" && raw.embedding.trim() ? raw.embedding.trim() : DEFAULT_EMBEDDING,
    limit: positiveInt(raw.limit, DEFAULT_RESULT_LIMIT, 20),
    maxResultChars: positiveInt(raw.maxResultChars, DEFAULT_MAX_RESULT_CHARS, 20_000),
  };
}

function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe private zvec directory");
}

function zvecHome(): string {
  return join(configDir(), "zvec-grep");
}

function projectIndexesDir(): string {
  return join(configDir(), "zvec-project-indexes");
}

function resolveZgCli(): string {
  let entry: string;
  try {
    entry = fileURLToPath(import.meta.resolve("@zvec/zvec-grep"));
  } catch {
    throw new Error("zvec-grep is not installed; run npm install in pi-zvec-content");
  }
  const cli = join(dirname(entry), "cli", "index.js");
  if (!existsSync(cli)) throw new Error("zvec-grep CLI not found");
  return cli;
}

function localEnv(config: ZvecContentConfig): NodeJS.ProcessEnv {
  const home = zvecHome();
  const models = join(home, "models");
  ensurePrivateDirectory(home);
  ensurePrivateDirectory(models);
  return {
    ...process.env,
    ZVEC_GREP_HOME: home,
    ZVEC_GREP_MODEL_CACHE: models,
    ZVEC_GREP_MODE: "auto",
    ZVEC_GREP_EMBEDDING: config.embedding,
  };
}

function tail(text: string, max = DIAGNOSTIC_TAIL_CHARS): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `[...truncated...]\n${trimmed.slice(-max)}`;
}

function redactDiagnostic(text: string, cwd: string): string {
  if (!text) return "";
  const config = configDir();
  const home = zvecHome();
  const indexes = projectIndexesDir();
  const replacements: Array<[string, string]> = [
    [cwd, "<zvec-workspace>"],
    [cwd.replaceAll("\\", "/"), "<zvec-workspace>"],
    [indexes, "<zvec-indexes>"],
    [indexes.replaceAll("\\", "/"), "<zvec-indexes>"],
    [home, "<zvec-home>"],
    [home.replaceAll("\\", "/"), "<zvec-home>"],
    [config, "<pi-config>"],
    [config.replaceAll("\\", "/"), "<pi-config>"],
  ];
  let result = text;
  for (const [from, to] of replacements) {
    if (from) result = result.replaceAll(from, to);
  }
  return tail(result);
}

async function runZg(
  stage: "index" | "query" | "rg",
  args: string[],
  cwd: string,
  config: ZvecContentConfig,
  signal?: AbortSignal,
): Promise<string> {
  const cli = resolveZgCli();
  return await new Promise<string>((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd,
      env: localEnv(config),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    const capture = (current: string, chunk: Buffer | string): string => {
      if (current.length >= PROCESS_OUTPUT_LIMIT) return current;
      const text = String(chunk);
      const room = PROCESS_OUTPUT_LIMIT - current.length;
      return current + text.slice(0, room);
    };

    child.stdout?.on("data", (chunk) => { stdout = capture(stdout, chunk); });
    child.stderr?.on("data", (chunk) => { stderr = capture(stderr, chunk); });

    const abort = () => child.kill("SIGTERM");
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    }

    child.on("error", reject);
    child.on("close", (code, killedSignal) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) return reject(new Error("zvec-grep operation aborted"));
      if (code !== 0) {
        return reject(new ZgProcessError({
          stage,
          exitCode: code,
          signal: killedSignal,
          stdoutTail: redactDiagnostic(stdout, cwd),
          stderrTail: redactDiagnostic(stderr, cwd),
        }));
      }
      resolvePromise(stdout);
    });
  });
}

const targetLocks = new Map<string, Promise<void>>();

async function withTargetLock<T>(key: string, signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
  const previous = targetLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
  const queued = previous.catch(() => {}).then(() => gate);
  targetLocks.set(key, queued);
  await previous.catch(() => {});
  signal?.throwIfAborted();
  try {
    return await fn();
  } finally {
    release();
    if (targetLocks.get(key) === queued) targetLocks.delete(key);
  }
}

function looksLikeRegex(query: string): boolean {
  return /(^|[^\\])(?:\.\*|\.\+|\[[^\]]+\]|\([^)]*\)|\{\d|\^|\$)|\\[dDsSwWbB]/.test(query);
}

interface Target {
  projectRoot: string;
  targetPath: string;
  displayPath: string;
  indexDir: string;
}

function inside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + sep);
}

function resolveTarget(cwd: string, pathValue: string): Target {
  const requested = pathValue.trim();
  if (!requested) throw new Error("path must not be empty");
  if (isAbsolute(requested) || requested.startsWith("~")) throw new Error("path must be project-relative");

  const projectRoot = realpathSync(cwd);
  let targetPath: string;
  try {
    targetPath = realpathSync(resolve(projectRoot, requested));
  } catch {
    throw new Error("path does not exist");
  }
  if (!inside(projectRoot, targetPath)) throw new Error("path resolves outside the project");

  const stat = statSync(targetPath);
  if (!stat.isFile() && !stat.isDirectory()) throw new Error("path must resolve to a regular file or directory");

  const indexes = resolve(projectIndexesDir());
  const zhome = resolve(zvecHome());
  if (inside(indexes, targetPath) || inside(zhome, targetPath)) throw new Error("cannot search private zvec state");

  const displayPath = relative(projectRoot, targetPath).replaceAll("\\", "/") || ".";
  const key = createHash("sha256")
    .update(projectRoot)
    .update("\0")
    .update(targetPath)
    .digest("hex")
    .slice(0, 24);
  return { projectRoot, targetPath, displayPath, indexDir: join(projectIndexesDir(), key) };
}

function prepareIndex(target: Target): void {
  ensurePrivateDirectory(projectIndexesDir());
  ensurePrivateDirectory(target.indexDir);
  const sourceRoot = join(target.indexDir, "source");
  const name = basename(target.targetPath) || "target";
  const link = join(sourceRoot, name);

  // The target path is part of the index key, so once this staging symlink is
  // correct there is no reason to tear it down before every query. Leaving it
  // stable also avoids needless watcher/refresh churn in zvec server mode.
  try {
    if (existsSync(link) && realpathSync(link) === target.targetPath) return;
  } catch {}

  rmSync(sourceRoot, { recursive: true, force: true });
  ensurePrivateDirectory(sourceRoot);
  const stat = statSync(target.targetPath);
  symlinkSync(target.targetPath, link, stat.isDirectory() ? "dir" : "file");
}

function redactResult(text: string, target: Target): string {
  const slashRoot = target.projectRoot.replaceAll("\\", "/");
  const slashIndex = target.indexDir.replaceAll("\\", "/");
  return text
    .replaceAll(target.indexDir, "<project-index>")
    .replaceAll(slashIndex, "<project-index>")
    .replaceAll(target.projectRoot, "<project>")
    .replaceAll(slashRoot, "<project>");
}

async function ensureIndex(target: Target, config: ZvecContentConfig, signal?: AbortSignal): Promise<void> {
  prepareIndex(target);
  if (existsSync(join(target.indexDir, ".zvec-grep"))) return;

  await runZg("index", [
    "index",
    "--debug",
    "--embedding", config.embedding,
    "-L",
    "--no-ignore",
    "-g", "source",
    "-g", "source/**",
    "-g", "!source/.pi/zvec-project-indexes/**",
    "-g", "!source/.pi/zvec-grep/**",
    "--mode", "auto",
  ], target.indexDir, config, signal);
}

async function searchRegex(target: Target, query: string, config: ZvecContentConfig, signal?: AbortSignal): Promise<string> {
  // Managed ripgrep does not require an embedding index. This is useful both for
  // intentional regex queries and as an exact-text route for agent follow-ups.
  prepareIndex(target);
  return runZg("rg", [
    "query",
    "--rg",
    "-i",
    "-C", "2",
    query,
    "source",
  ], target.indexDir, config, signal);
}

export async function searchProjectPath(
  cwd: string,
  pathValue: string,
  query: string,
  config: ZvecContentConfig,
  signal?: AbortSignal,
): Promise<string> {
  const trimmed = query.trim();
  if (!trimmed) throw new Error("query must not be empty");
  const target = resolveTarget(cwd, pathValue);

  return withTargetLock(target.indexDir, signal, async () => {
    let stdout: string;
    if (looksLikeRegex(trimmed)) {
      stdout = await searchRegex(target, trimmed, config, signal);
    } else {
      await ensureIndex(target, config, signal);
      stdout = await runZg("query", [
        "query",
        "--debug",
        "--hybrid", trimmed,
        "--limit", String(config.limit),
        "--preview", "short",
        "--refresh", "wait",
        "--mode", "auto",
      ], target.indexDir, config, signal);
    }

    const body = redactResult(stdout.trim(), target);
    const route = looksLikeRegex(trimmed) ? "regex" : "hybrid";
    const combined = body
      ? `Target: ${target.displayPath}\nroute: ${route}\n${body}`
      : `Target: ${target.displayPath}\nroute: ${route}\nNo matching content.`;
    if (combined.length <= config.maxResultChars) return combined;
    return `${combined.slice(0, config.maxResultChars)}\n[results truncated]`;
  });
}
