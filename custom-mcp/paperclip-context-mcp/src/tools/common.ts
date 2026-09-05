import type { CallToolResult } from '@modelcontextprotocol/server';

import type { SnapshotStore } from '../artifacts/snapshots.js';
import type { PaperclipClient, PaperclipResponse } from '../paperclip/client.js';
import { PaperclipHttpError } from '../paperclip/client.js';
import { renderGenericMarkdown } from '../render/generic.js';
import type { Telemetry } from '../telemetry/telemetry.js';
import { estimateTokens } from '../util/tokens.js';

export interface ToolServices {
  client: PaperclipClient;
  snapshots: SnapshotStore;
  telemetry: Telemetry;
  inlineTokenThreshold: number;
}

export function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

export function errorResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * Deliver rendered Markdown inline when it fits the configured token budget.
 * Larger results are written to a fresh immutable snapshot and only that path
 * is returned to the model.
 */
export async function deliverMarkdown(params: {
  services: ToolServices;
  operation: string;
  markdown: string;
  source: string;
  response?: PaperclipResponse;
  fetchedAt?: Date;
  allFields?: boolean;
}): Promise<CallToolResult> {
  const { services, operation, markdown, source, response, fetchedAt, allFields } = params;
  const renderedBytes = Buffer.byteLength(markdown, 'utf8');
  const estimatedTokens = estimateTokens(markdown);

  if (estimatedTokens <= services.inlineTokenThreshold) {
    await services.telemetry.emit({
      operation,
      ...(response
        ? {
            method: response.method,
            path: response.path,
            status: response.status,
            duration_ms: response.durationMs,
            upstream_bytes: response.bytes,
          }
        : {}),
      rendered_bytes: renderedBytes,
      rendered_tokens_estimate: estimatedTokens,
      inline_token_threshold: services.inlineTokenThreshold,
      delivery: 'inline',
      inline_bytes: renderedBytes,
      ...(allFields !== undefined ? { all_fields: allFields } : {}),
    });
    return textResult(markdown);
  }

  const resolvedFetchedAt = fetchedAt ?? response?.fetchedAt;
  const snapshot = await services.snapshots.writeMarkdown(markdown, {
    source,
    ...(resolvedFetchedAt ? { fetchedAt: resolvedFetchedAt } : {}),
  });
  const message = snapshot.path;

  await services.telemetry.emit({
    operation,
    ...(response
      ? {
          method: response.method,
          path: response.path,
          status: response.status,
          duration_ms: response.durationMs,
          upstream_bytes: response.bytes,
        }
      : {}),
    rendered_bytes: renderedBytes,
    rendered_tokens_estimate: estimatedTokens,
    inline_token_threshold: services.inlineTokenThreshold,
    delivery: 'snapshot',
    inline_bytes: Buffer.byteLength(message, 'utf8'),
    ...(allFields !== undefined ? { all_fields: allFields } : {}),
    artifact_path: snapshot.path,
  });

  return textResult(message);
}

export async function deliverRead(params: {
  services: ToolServices;
  operation: string;
  response: PaperclipResponse;
  markdown: string;
  allFields?: boolean;
  source?: string;
}): Promise<CallToolResult> {
  const { services, operation, response, markdown, allFields, source } = params;
  return deliverMarkdown({
    services,
    operation,
    response,
    markdown,
    source: source ?? `${response.method} ${response.path}`,
    ...(allFields !== undefined ? { allFields } : {}),
  });
}

export async function acknowledgeMutation(params: {
  services: ToolServices;
  operation: string;
  response: PaperclipResponse;
  message: string;
}): Promise<CallToolResult> {
  const { services, operation, response, message } = params;
  await services.telemetry.emit({
    operation,
    method: response.method,
    path: response.path,
    status: response.status,
    duration_ms: response.durationMs,
    upstream_bytes: response.bytes,
    rendered_bytes: 0,
    inline_bytes: Buffer.byteLength(message, 'utf8'),
    delivery: 'ack',
  });
  return textResult(message);
}

export async function handleToolError(
  services: ToolServices,
  operation: string,
  error: unknown,
): Promise<CallToolResult> {
  if (error instanceof PaperclipHttpError) {
    let message = error.message;
    let renderedBytes = 0;
    let renderedTokensEstimate = 0;
    let artifactPath: string | undefined;

    // Keep routine API errors actionable inline, but never inject a very large
    // error body. Errors use the same configured threshold as normal reads.
    const markdown = renderGenericMarkdown(error.data, {
      title: `Paperclip error ${error.status}`,
      allFields: true,
    });
    renderedBytes = Buffer.byteLength(markdown, 'utf8');
    renderedTokensEstimate = estimateTokens(markdown);

    if (renderedTokensEstimate > services.inlineTokenThreshold) {
      const snapshot = await services.snapshots.writeMarkdown(markdown, {
        source: `${error.method} ${error.path} — error ${error.status}`,
      });
      artifactPath = snapshot.path;
      message = `${error.message}\nError details: ${snapshot.path}`;
    } else if (renderedBytes > 0) {
      message = `${error.message}\n\n${markdown}`;
    }

    await services.telemetry.emit({
      operation,
      method: error.method,
      path: error.path,
      status: error.status,
      duration_ms: error.durationMs,
      upstream_bytes: error.responseBytes,
      rendered_bytes: renderedBytes,
      rendered_tokens_estimate: renderedTokensEstimate,
      inline_token_threshold: services.inlineTokenThreshold,
      delivery: artifactPath ? 'error_snapshot' : 'error_inline',
      inline_bytes: Buffer.byteLength(message, 'utf8'),
      ...(artifactPath ? { artifact_path: artifactPath } : {}),
      error: error.message,
    });
    return errorResult(message);
  }

  const message = error instanceof Error ? error.message : String(error);
  await services.telemetry.emit({
    operation,
    inline_bytes: Buffer.byteLength(message, 'utf8'),
    delivery: 'error_inline',
    error: message,
  });
  return errorResult(message);
}

export function mergeExtra(
  extra: Record<string, unknown> | undefined,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...(extra ?? {}) };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) body[key] = value;
  }
  return body;
}
