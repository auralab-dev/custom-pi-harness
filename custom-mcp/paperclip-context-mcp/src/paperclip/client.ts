import type { RuntimeContext } from '../config.js';
import { isRecord } from '../util/unknown.js';

export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type QueryValue = string | number | boolean | Array<string | number | boolean> | undefined;
export type Query = Record<string, QueryValue>;

export interface PaperclipRequestOptions {
  method?: HttpMethod;
  path: string;
  query?: Query;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface PaperclipResponse {
  method: HttpMethod;
  path: string;
  url: string;
  status: number;
  ok: boolean;
  headers: Headers;
  data: unknown;
  text: string;
  bytes: number;
  durationMs: number;
  fetchedAt: Date;
}

export class PaperclipHttpError extends Error {
  readonly status: number;
  readonly method: HttpMethod;
  readonly path: string;
  readonly data: unknown;
  readonly responseText: string;
  readonly responseBytes: number;
  readonly durationMs: number;

  constructor(response: PaperclipResponse) {
    const humanMessage = extractErrorMessage(response.data, response.text);
    super(`${response.method} ${response.path} failed with ${response.status}: ${humanMessage}`);
    this.name = 'PaperclipHttpError';
    this.status = response.status;
    this.method = response.method;
    this.path = response.path;
    this.data = response.data;
    this.responseText = response.text;
    this.responseBytes = response.bytes;
    this.durationMs = response.durationMs;
  }
}

function extractErrorMessage(data: unknown, fallback: string): string {
  if (isRecord(data)) {
    for (const key of ['error', 'message', 'detail']) {
      const value = data[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }

  const compact = fallback.replace(/\s+/g, ' ').trim();
  if (!compact) return 'empty error response';
  return compact.length > 500 ? `${compact.slice(0, 499)}…` : compact;
}

function normalizeRelativePath(path: string): string {
  if (!path.startsWith('/')) return `/${path}`;
  return path;
}

function validateRelativePath(path: string): void {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    throw new Error('paperclip_raw only accepts relative Paperclip paths, not external URLs.');
  }

  const normalized = normalizeRelativePath(path);
  if (normalized.includes('\\')) {
    throw new Error('Paperclip paths may not contain backslashes.');
  }

  const segments = normalized.split('/');
  for (const segment of segments) {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new Error('Paperclip path contains invalid percent-encoding.');
    }
    if (decoded === '..') {
      throw new Error('Paperclip paths may not contain ".." traversal segments.');
    }
  }
}

function buildUrl(baseUrl: string, path: string, query?: Query): URL {
  validateRelativePath(path);

  const base = new URL(baseUrl);
  const relative = normalizeRelativePath(path);
  const basePath = base.pathname.replace(/\/+$/, '');

  let joinedPath: string;
  if (basePath.endsWith('/api') && (relative === '/api' || relative.startsWith('/api/'))) {
    joinedPath = `${basePath}${relative.slice('/api'.length)}`;
  } else {
    joinedPath = `${basePath}${relative}`;
  }

  base.pathname = joinedPath.replace(/\/{2,}/g, '/');
  base.search = '';
  base.hash = '';

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) base.searchParams.append(key, String(item));
      } else {
        base.searchParams.set(key, String(value));
      }
    }
  }

  return base;
}

function parseBody(text: string, contentType: string | null): unknown {
  if (!text) return null;

  const looksJson = contentType?.toLowerCase().includes('json') || /^[\s]*[\[{]/.test(text);
  if (!looksJson) return text;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export class PaperclipClient {
  constructor(
    private readonly runtime: RuntimeContext,
    private readonly timeoutMs: number,
    private readonly customHeaders: Readonly<Record<string, string>> = {},
  ) {}

  getRuntime(): RuntimeContext {
    return this.runtime;
  }

  requireCompanyId(): string {
    if (!this.runtime.companyId) {
      throw new Error('PAPERCLIP_COMPANY_ID is required for this operation.');
    }
    return this.runtime.companyId;
  }

  requireAgentId(): string {
    if (!this.runtime.agentId) {
      throw new Error('PAPERCLIP_AGENT_ID is required for this operation.');
    }
    return this.runtime.agentId;
  }

  async request(options: PaperclipRequestOptions): Promise<PaperclipResponse> {
    const method = options.method ?? 'GET';
    const apiUrl = this.runtime.apiUrl;
    if (!apiUrl) throw new Error('PAPERCLIP_API_URL is required.');

    const url = buildUrl(apiUrl, options.path, options.query);
    const headers = new Headers(this.customHeaders);
    if (options.headers) {
      for (const [name, value] of Object.entries(options.headers)) headers.set(name, value);
    }

    // Adapter-owned defaults/credentials are applied last. Custom headers can
    // add proxy/routing metadata to every request, but cannot silently replace
    // the Paperclip run/auth identity when those values are available.
    if (!headers.has('Accept')) headers.set('Accept', 'application/json, text/plain;q=0.9, */*;q=0.1');
    if (!headers.has('User-Agent')) headers.set('User-Agent', 'paperclip-context-mcp/0.3.0');

    if (this.runtime.apiKey) {
      headers.set('Authorization', `Bearer ${this.runtime.apiKey}`);
    }

    if (!['GET', 'HEAD'].includes(method) && this.runtime.runId) {
      headers.set('X-Paperclip-Run-Id', this.runtime.runId);
    }

    let body: string | undefined;
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(options.body);
    }

    const startedAt = performance.now();
    const fetchedAt = new Date();

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${method} ${options.path} failed before receiving a response after ${durationMs} ms: ${message}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const text = buffer.toString('utf8');
    const durationMs = Math.round(performance.now() - startedAt);
    const data = parseBody(text, response.headers.get('content-type'));

    const result: PaperclipResponse = {
      method,
      path: options.path,
      url: url.toString(),
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      data,
      text,
      bytes: buffer.byteLength,
      durationMs,
      fetchedAt,
    };

    if (!response.ok) throw new PaperclipHttpError(result);
    return result;
  }
}
