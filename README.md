# Pi harness for Paperclip

A reproducible [Pi coding agent](https://github.com/badlogic/pi-mono) runtime
profile used by Paperclip. It keeps Paperclip skills enabled, adds web and
content-retrieval tools, and exposes Paperclip through MCP while disabling Pi's
direct file and shell tools.

## Included packages

- `pi-web-access` — `web_search` and `download_file`, adapted from
  [nicobailon/pi-web-access](https://github.com/nicobailon/pi-web-access) by
  Nico Bailon.
- `pi-zvec-content` — bounded `file_content_search` powered by
  [zvec-ai/zvec-grep](https://github.com/zvec-ai/zvec-grep/).
- `pi-document-convert` — local PDF and document conversion used by downloads.
- [`paperclip-mcp-server`](https://github.com/auralab-dev/paperclip-mcp) —
  compact Paperclip API tools exposed through `pi-mcp-adapter`.
- `pi-session-trace` — session diagnostics.

The resulting model-facing content tools are:

```text
find
web_search
download_file
file_content_search
paperclip_* (direct MCP tools)
```

Pi built-ins `read`, `bash`, `edit`, `write`, `grep`, and `ls` are excluded.

## Install and run

Requires Node.js 22.19+, pnpm 11, and Python 3.11+.

```bash
cp .env.local.example .env.local
# Add provider credentials to the ignored .env.local file.
./install.sh
./run-pi-local.sh
```

The launcher may be called from another workspace. It preserves that working
directory and stores mutable Pi state under
`PI_HARNESS_STATE_ROOT/<PAPERCLIP_AGENT_ID>`.

## Paperclip runtime

Paperclip supplies `PAPERCLIP_*` variables when launching the harness. The local
MCP server receives only its explicit environment allowlist. TinyFish and model
provider credentials are not forwarded to the MCP process.

The checked-in configuration uses the TinyFish minimal profile. Secrets belong
only in the ignored `.env.local` file or the deployment secret store; never add
them to JSON configuration or Git history.
