import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import type { HttpMethod, Query } from '../paperclip/client.js';
import { renderGenericMarkdown } from '../render/generic.js';
import { asRecord, pickString } from '../util/unknown.js';
import {
  acknowledgeMutation,
  handleToolError,
  deliverRead,
  type ToolServices,
} from './common.js';

const queryValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
]);

function ackIdentity(data: unknown): string | undefined {
  const object = asRecord(data);
  if (!object) return undefined;
  return pickString(object, 'identifier', 'key', 'id', 'status');
}

export function registerRawTool(server: McpServer, services: ToolServices): void {
  server.registerTool(
    'paperclip_raw',
    {
      title: 'Raw Paperclip API fallback',
      description:
        'Fallback for Paperclip endpoints not covered by dedicated tools. Relative same-origin paths only. GET/HEAD return Markdown inline below the configured token threshold and otherwise only a new immutable snapshot path; mutations return only a compact acknowledgement. Prefer dedicated tools.',
      inputSchema: {
        method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']).optional().default('GET'),
        path: z.string().min(1).describe('Relative Paperclip path such as /api/companies/...; external URLs are rejected.'),
        query: z.record(z.string(), queryValueSchema).optional(),
        body: z.unknown().optional(),
        all_fields: z
          .boolean()
          .optional()
          .default(false)
          .describe('For read responses, keep every returned field in the rendered Markdown. Delivery threshold behavior is unchanged.'),
      },
      annotations: { openWorldHint: true },
    },
    async ({ method, path, query, body, all_fields }) => {
      const operation = `raw.${method.toLowerCase()}`;
      try {
        const response = await services.client.request({
          method: method as HttpMethod,
          path,
          ...(query ? { query: query as Query } : {}),
          ...(body !== undefined ? { body } : {}),
        });

        if (method === 'GET' || method === 'HEAD') {
          const markdown = [
            `# ${method} ${path}`,
            '',
            `**HTTP status:** ${response.status}`,
            '',
            renderGenericMarkdown(response.data, { allFields: all_fields }),
          ].join('\n');
          return deliverRead({
            services,
            operation,
            response,
            markdown,
            allFields: all_fields,
          });
        }

        const identity = ackIdentity(response.data);
        const message = `${method} ${path} succeeded (${response.status})${identity ? `: ${identity}` : ''}.`;
        return acknowledgeMutation({ services, operation, response, message });
      } catch (error) {
        return handleToolError(services, operation, error);
      }
    },
  );
}
