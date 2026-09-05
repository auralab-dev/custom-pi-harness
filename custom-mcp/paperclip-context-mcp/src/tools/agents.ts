import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { renderAgents } from '../render/agents.js';
import { handleToolError, deliverRead, type ToolServices } from './common.js';

export function registerAgentTools(server: McpServer, services: ToolServices): void {
  server.registerTool(
    'paperclip_agents',
    {
      title: 'Read Paperclip agents',
      description:
        'List company agents, or fetch one agent when id is supplied. Returns Markdown inline below the configured token threshold and otherwise only a new immutable snapshot path. Use all_fields=true only when compact agent fields are insufficient.',
      inputSchema: {
        id: z.string().min(1).optional().describe('Agent UUID or company shortname. Omit to list the company roster.'),
        all_fields: z.boolean().optional().default(false),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ id, all_fields }) => {
      const operation = id ? 'agent.get' : 'agents.list';
      try {
        const companyId = services.client.requireCompanyId();
        const response = id
          ? await services.client.request({
              path: `/api/agents/${encodeURIComponent(id)}`,
              query: { companyId },
            })
          : await services.client.request({
              path: `/api/companies/${encodeURIComponent(companyId)}/agents`,
            });

        return deliverRead({
          services,
          operation,
          response,
          markdown: renderAgents(response.data, all_fields),
          allFields: all_fields,
        });
      } catch (error) {
        return handleToolError(services, operation, error);
      }
    },
  );
}
