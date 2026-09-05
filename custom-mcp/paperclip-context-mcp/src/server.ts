import { McpServer } from '@modelcontextprotocol/server';

import type { AppConfig } from './config.js';
import { SnapshotStore } from './artifacts/snapshots.js';
import { PaperclipClient } from './paperclip/client.js';
import { Telemetry } from './telemetry/telemetry.js';
import { registerAgentTools } from './tools/agents.js';
import { registerCommentTools } from './tools/comments.js';
import { registerContextTool } from './tools/context.js';
import { registerDocumentTools } from './tools/documents.js';
import { registerIssueTools } from './tools/issues.js';
import { registerRawTool } from './tools/raw.js';
import type { ToolServices } from './tools/common.js';

const SERVER_INSTRUCTIONS = `Paperclip tools operate on authoritative remote Paperclip state.
Read tools render LLM-friendly Markdown. Results at or below the configured inline token threshold are returned directly; larger results return only a path to a new immutable Markdown snapshot. Snapshots may become stale. Call the corresponding Paperclip tool again whenever current state matters. Editing a snapshot never modifies Paperclip.
Compact snapshots intentionally omit uncommon fields. On tools that expose all_fields, all_fields=true only expands the fields rendered from the SAME endpoint response; it never changes endpoint or collection scope.
Use Paperclip mutation tools for creates, updates, comments, checkout, release, and document writes; mutation results are compact acknowledgements.
Use paperclip_raw only when no dedicated tool covers the required Paperclip API operation.`;

export function createServer(config: AppConfig): McpServer {
  const client = new PaperclipClient(config.runtime, config.timeoutMs, config.customHeaders);
  const snapshots = new SnapshotStore(config.artifactRoot, config.runtime.runId);
  const telemetry = new Telemetry(config.telemetryEnabled, config.telemetryFile);
  const services: ToolServices = {
    client,
    snapshots,
    telemetry,
    inlineTokenThreshold: config.inlineTokenThreshold,
  };

  const server = new McpServer(
    {
      name: 'paperclip-context-mcp',
      title: 'Paperclip Context MCP',
      version: '0.6.0',
      description: 'Token-efficient local Paperclip facade with compact Markdown, thresholded inline delivery, and immutable overflow snapshots.',
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  registerContextTool(server, services);
  registerIssueTools(server, services);
  registerCommentTools(server, services);
  registerDocumentTools(server, services);
  registerAgentTools(server, services);
  registerRawTool(server, services);

  return server;
}
