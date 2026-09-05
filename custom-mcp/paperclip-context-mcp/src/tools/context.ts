import type { McpServer } from '@modelcontextprotocol/server';
import { renderRuntimeContext } from '../render/context.js';
import { deliverMarkdown, handleToolError, type ToolServices } from './common.js';

export function registerContextTool(server: McpServer, services: ToolServices): void {
  server.registerTool(
    'paperclip_context',
    {
      title: 'Paperclip runtime context',
      description:
        'Read the current Paperclip run/wake environment without an API call. Returns LLM-friendly Markdown inline when it fits the configured token threshold; otherwise returns only a new immutable snapshot path.',
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const operation = 'context.get';
      try {
        const rendered = renderRuntimeContext(services.client.getRuntime());
        const markdown = rendered.wakePayloadMarkdown
          ? `${rendered.inline}\n\n${rendered.wakePayloadMarkdown}`
          : rendered.inline;

        return deliverMarkdown({
          services,
          operation,
          markdown,
          source: rendered.wakePayloadMarkdown ? 'Paperclip runtime + PAPERCLIP_WAKE_PAYLOAD_JSON' : 'Paperclip runtime',
        });
      } catch (error) {
        return handleToolError(services, operation, error);
      }
    },
  );
}
