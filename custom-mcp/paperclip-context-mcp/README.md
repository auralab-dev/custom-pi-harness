# paperclip-context-mcp

Prototype local MCP facade for [Paperclip](https://docs.paperclip.ing/) focused on reducing model-context waste.

The contract is intentionally different from Paperclip's REST representation:

- **Reads produce compact Markdown.** If the rendered Markdown is at or below the inline token threshold (30,000 estimated tokens by default), MCP returns it directly. Larger results are written to a new immutable snapshot and MCP returns only the path.
- **Writes produce tiny acknowledgements.** Full Paperclip mutation responses are parsed locally and never injected into model context.
- **Overflow snapshots are observations, not state.** Every materialized read gets a unique timestamped request directory. Editing a snapshot never updates Paperclip; call MCP again for fresh state.
- **Default renderers expose only likely-useful fields.** On tools that support it, `all_fields=true` expands the fields rendered from that same API response; it never changes the endpoint or list scope.
- **`paperclip_raw` is the escape hatch.** Reads use the same Markdown + inline-threshold behavior; mutations still return compact acknowledgements.

This prototype targets the MCP TypeScript SDK v2 and pins `@modelcontextprotocol/server` to `2.0.0` for a stable tool-registration contract. The v2.0.0 package accepts Zod **raw shapes** for `inputSchema` (`{ id: z.string() }`); this repo deliberately uses that form rather than wrapping them in `z.object(...)`.

## Install / build

```bash
npm install
npm run check
npm run build
```

Run directly:

```bash
node dist/index.js
```

Or register the `paperclip-context-mcp` binary as a local stdio MCP server.

The process expects Paperclip's normal agent runtime environment:

```text
PAPERCLIP_API_URL
PAPERCLIP_API_KEY
PAPERCLIP_AGENT_ID
PAPERCLIP_COMPANY_ID
PAPERCLIP_RUN_ID
```

Optional wake context is read when present:

```text
PAPERCLIP_TASK_ID
PAPERCLIP_WAKE_REASON
PAPERCLIP_WAKE_COMMENT_ID
PAPERCLIP_APPROVAL_ID
PAPERCLIP_APPROVAL_STATUS
PAPERCLIP_LINKED_ISSUE_IDS
PAPERCLIP_WAKE_PAYLOAD_JSON
```

Useful server-specific options:

```text
PAPERCLIP_MCP_ARTIFACT_DIR      # default: OS temp dir / paperclip-mcp-artifacts
PAPERCLIP_MCP_TIMEOUT_MS        # default: 30000
PAPERCLIP_MCP_INLINE_TOKEN_THRESHOLD # default: 30000; 0 forces all read Markdown to disk
PAPERCLIP_MCP_HEADERS_JSON      # optional JSON object of custom headers added to every API request
PAPERCLIP_MCP_TELEMETRY         # default: 1; set 0/false/off to disable stderr JSONL
PAPERCLIP_MCP_TELEMETRY_FILE    # optional JSONL file in addition to stderr
```


## Custom request headers

Set `PAPERCLIP_MCP_HEADERS_JSON` to a JSON object. These headers are added to **every** Paperclip HTTP request, including dedicated tools and `paperclip_raw`:

```bash
export PAPERCLIP_MCP_HEADERS_JSON='{"X-Proxy-Tenant":"acme","CF-Access-Client-Id":"..."}'
```

Typical MCP host configuration:

```json
{
  "mcpServers": {
    "paperclip": {
      "command": "paperclip-context-mcp",
      "env": {
        "PAPERCLIP_MCP_HEADERS_JSON": "{\"X-Proxy-Tenant\":\"acme\"}"
      }
    }
  }
}
```

Paperclip-owned identity headers still win when configured: `Authorization` is set from `PAPERCLIP_API_KEY`, and mutating requests set `X-Paperclip-Run-Id` from `PAPERCLIP_RUN_ID`. Custom headers are never written to snapshots or telemetry.


## MCP SDK result typing

Tool callbacks return the SDK's public `CallToolResult` type directly:

```ts
import type { CallToolResult } from '@modelcontextprotocol/server';
```

This matters with `@modelcontextprotocol/server@2.0.0`: its tool callback result includes the MCP result metadata/index-signature contract. Avoid defining a narrower local result interface even when it only contains `content` and `isError`; doing so can fail structurally against `registerTool`.

## Model contract

The MCP server publishes short server-level instructions and repeats only critical invariants in tool descriptions:

1. Read tools return compact Markdown directly when it fits the configured inline threshold; only oversized reads return a snapshot path.
2. Returned files are immutable snapshots and may become stale.
3. Call a Paperclip read tool again when current state matters.
4. Never edit snapshot files to mutate Paperclip.
5. Use mutation tools for writes.
6. `all_fields=true` means “render more fields from this same endpoint response.” It never switches endpoints or changes how many collection items are requested.
7. Use `paperclip_raw` only when the dedicated tools cannot perform the operation.

## Inline threshold and snapshot layout

The threshold is applied to the **rendered Markdown**, not the raw REST payload. Token count is estimated locally with a dependency-free conservative heuristic; it is a context-delivery guard, not an exact tokenizer. Configure it with `PAPERCLIP_MCP_INLINE_TOKEN_THRESHOLD`.

At or below the threshold, the Markdown is returned directly and no snapshot is needed. Above the threshold, the Markdown is written to disk and only the path is returned. Model-visible paths deliberately do **not** use stable resource paths such as `issues/PAP-123/latest.md`.

Example:

```text
/tmp/paperclip-mcp-artifacts/
  run_abcd/
    2026-09-05T10-22-31-481Z_4f8a0d3c/
      response.md
    2026-09-05T10-23-02-008Z_18b71c22/
      response.md
```

Every **materialized** read creates a fresh immutable `response.md`. This prevents an agent from treating the filesystem as authoritative Paperclip state or assuming an earlier path refreshed itself.

## Tools

### `paperclip_context`

Returns runtime/wake context as compact Markdown. It is inline below the configured token threshold and becomes an immutable snapshot only when oversized.

### `paperclip_inbox`

Uses `GET /api/agents/me/inbox-lite` and renders a compact issue table. It has no `all_fields` mode; if one assignment needs more detail, read that issue explicitly. Delivery follows the inline threshold.

### `paperclip_issue`

Always uses `GET /api/issues/:id`. The default renderer keeps likely-useful issue fields; `all_fields=true` renders the complete response from that **same endpoint**. The rendered Markdown is inline unless it crosses the threshold.

### `paperclip_heartbeat_context`

Always uses `GET /api/issues/:id/heartbeat-context`. This is an explicit separate tool for Paperclip's smaller wake/execution payload. `all_fields=true` only expands the heartbeat-context response; it does not fetch the full issue endpoint. The rendered Markdown is inline unless it crosses the threshold.

### `paperclip_issues`

Uses `GET /api/companies/:companyId/issues` and renders a compact Markdown table. With no filters and no `limit`, the Paperclip API returns all visible company issues. Optional filters narrow the collection and optional `limit` caps it. There is deliberately no `all_fields` argument; use `paperclip_issue` when detailed fields for one issue are needed.

### `paperclip_issue_create`, `paperclip_issue_update`

Common issue mutation fields plus `extra` for uncommon Paperclip fields. Full mutation responses are not returned to the model.

### `paperclip_issue_checkout`, `paperclip_issue_release`

Checkout/release semantics. `X-Paperclip-Run-Id` is attached automatically on mutating requests when available. Checkout defaults to Paperclip's normal expected statuses; set `reclaim_stale=true` to also allow `in_progress` for stale-lock adoption.

### `paperclip_comments`, `paperclip_comment_add`

Comment reads become compact Markdown and use the inline threshold. Adds return a compact acknowledgement.

### `paperclip_documents`, `paperclip_document`, `paperclip_document_put`

Document list/get reads become Markdown and use the inline threshold. Default list rendering omits document bodies. Single-document reads control annotation loading explicitly with `include_annotations` and `include_annotation_comments`; `all_fields` only changes rendering. Writes return a compact acknowledgement.

### `paperclip_agents`

List company agents or fetch one agent by id/shortname. Default fields are compact; `all_fields=true` expands the complete returned payload. Delivery follows the inline threshold.

### `paperclip_raw`

Relative same-origin Paperclip fallback. External URLs and `..` traversal are rejected. GET/HEAD responses use the same compact Markdown + inline-threshold behavior. Mutations return a compact acknowledgement.

## Telemetry

By default the server emits one JSON object per Paperclip operation to **stderr** (stdout is reserved for MCP):

```json
{
  "kind": "paperclip_mcp",
  "operation": "issue.get",
  "method": "GET",
  "path": "/api/issues/PAP-123",
  "status": 200,
  "duration_ms": 21,
  "upstream_bytes": 38122,
  "rendered_bytes": 1841,
  "rendered_tokens_estimate": 492,
  "inline_token_threshold": 30000,
  "delivery": "inline",
  "inline_bytes": 1841,
  "all_fields": false
}
```

This is intended to answer questions such as:

- How many reads were returned inline vs materialized to disk?
- How many API bytes were prevented from entering model context?
- Which single-resource reads frequently escalate to `all_fields=true`?
- Which raw endpoints are common enough to promote into dedicated tools?
- Which renderers omit fields models repeatedly need?

## Design notes

The implementation deliberately keeps three layers separate:

```text
Paperclip REST JSON
      ↓
PaperclipClient
      ↓
resource-specific renderer
      ↓
compact Markdown renderer
      ↓
≤ threshold → inline model result
> threshold → immutable snapshot path
```

Mutation flow:

```text
model mutation request
      ↓
Paperclip REST mutation
      ↓
full response parsed locally
      ↓
small acknowledgement only
```

The MCP server is only the transport layer. `PaperclipClient`, renderers, artifact storage and telemetry do not depend on model prompts and can later be reused by a CLI if desired.

## Current prototype limitations

- No multipart attachment upload helper yet; use `paperclip_raw` only for JSON endpoints. Multipart should become a dedicated tool rather than being forced through the raw JSON fallback.
- No automatic disk retention/cleanup beyond the OS temp directory lifecycle.
- Schemas focus on the hot Paperclip coordination paths, not every control-plane endpoint.
- Response renderers are defensive against shape drift, but field naming should be tuned using real traces/tests from your Paperclip version.

## MCP SDK schema compatibility

The tool schemas intentionally use the SDK v2.0.0 raw-shape registration form:

```ts
server.registerTool(
  'paperclip_issue',
  {
    inputSchema: {
      id: z.string().min(1),
      all_fields: z.boolean().optional().default(false),
    },
  },
  async ({ id, all_fields }) => { /* ... */ },
);
```

Do not mechanically change these outer schemas to `z.object({...})` without also upgrading and validating the MCP SDK version. Nested Zod objects used as individual field schemas are still fine.

## pnpm workspace isolation

This repository ships its own `pnpm-workspace.yaml` with `packages: ['.']` on purpose.
That makes the checkout its own pnpm workspace boundary even when you place it inside a
larger repository that also has a `pnpm-workspace.yaml`.

Without this file, running `pnpm install` from a nested checkout can resolve the parent
workspace instead of installing this package. A common symptom is:

```text
Scope: all <N> workspace projects
...
Local package.json exists, but node_modules missing
```

After extracting this repository, these commands should operate on this package itself:

```bash
pnpm install
pnpm run build
```

`@types/node` is a declared dev dependency because the TypeScript sources use Node built-ins
and `tsconfig.json` explicitly loads the `node` type library.
