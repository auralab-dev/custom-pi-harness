import { tmpdir } from 'node:os';
import { join } from 'node:path';

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return !['0', 'false', 'off', 'no'].includes(value.trim().toLowerCase());
}

function parsePositiveInteger(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function parseNonNegativeInteger(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
}

function parseCustomHeaders(value: string | undefined): Record<string, string> {
  if (!value) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`PAPERCLIP_MCP_HEADERS_JSON must be valid JSON: ${message}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('PAPERCLIP_MCP_HEADERS_JSON must be a JSON object of header names to string values.');
  }

  const headers: Record<string, string> = {};
  for (const [name, rawValue] of Object.entries(parsed)) {
    if (typeof rawValue !== 'string') {
      throw new Error(`PAPERCLIP_MCP_HEADERS_JSON header ${JSON.stringify(name)} must have a string value.`);
    }
    if (!name.trim()) {
      throw new Error('PAPERCLIP_MCP_HEADERS_JSON may not contain an empty header name.');
    }
    if (/[\r\n]/.test(rawValue)) {
      throw new Error(`PAPERCLIP_MCP_HEADERS_JSON header ${JSON.stringify(name)} may not contain CR/LF characters.`);
    }
    headers[name] = rawValue;
  }

  // Validate names/values using the same Web Headers implementation used by fetch.
  // This throws early at server startup instead of on the first API call.
  void new Headers(headers);
  return headers;
}

export interface RuntimeContext {
  apiUrl: string | undefined;
  apiKey: string | undefined;
  agentId: string | undefined;
  companyId: string | undefined;
  runId: string | undefined;
  taskId: string | undefined;
  wakeReason: string | undefined;
  wakeCommentId: string | undefined;
  approvalId: string | undefined;
  approvalStatus: string | undefined;
  linkedIssueIds: string[];
  wakePayloadJson: string | undefined;
}

export interface AppConfig {
  runtime: RuntimeContext;
  artifactRoot: string;
  timeoutMs: number;
  inlineTokenThreshold: number;
  customHeaders: Record<string, string>;
  telemetryEnabled: boolean;
  telemetryFile: string | undefined;
}

export function loadConfig(): AppConfig {
  const linkedIssueIds = (env('PAPERCLIP_LINKED_ISSUE_IDS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    runtime: {
      apiUrl: env('PAPERCLIP_API_URL'),
      apiKey: env('PAPERCLIP_API_KEY'),
      agentId: env('PAPERCLIP_AGENT_ID'),
      companyId: env('PAPERCLIP_COMPANY_ID'),
      runId: env('PAPERCLIP_RUN_ID'),
      taskId: env('PAPERCLIP_TASK_ID'),
      wakeReason: env('PAPERCLIP_WAKE_REASON'),
      wakeCommentId: env('PAPERCLIP_WAKE_COMMENT_ID'),
      approvalId: env('PAPERCLIP_APPROVAL_ID'),
      approvalStatus: env('PAPERCLIP_APPROVAL_STATUS'),
      linkedIssueIds,
      wakePayloadJson: env('PAPERCLIP_WAKE_PAYLOAD_JSON'),
    },
    artifactRoot: env('PAPERCLIP_MCP_ARTIFACT_DIR') ?? join(tmpdir(), 'paperclip-mcp-artifacts'),
    timeoutMs: parsePositiveInteger(env('PAPERCLIP_MCP_TIMEOUT_MS'), 30_000),
    inlineTokenThreshold: parseNonNegativeInteger(env('PAPERCLIP_MCP_INLINE_TOKEN_THRESHOLD'), 30_000),
    customHeaders: parseCustomHeaders(env('PAPERCLIP_MCP_HEADERS_JSON')),
    telemetryEnabled: parseBoolean(env('PAPERCLIP_MCP_TELEMETRY'), true),
    telemetryFile: env('PAPERCLIP_MCP_TELEMETRY_FILE'),
  };
}
