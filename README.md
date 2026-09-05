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
read
web_search
download_file
file_content_search
paperclip_* (direct MCP tools)
```

Pi built-ins `bash`, `edit`, `write`, `grep`, and `ls` are excluded. A
fail-closed hook restricts built-in `read` and `find` to the current workspace,
including canonical checks that reject symlink escapes.
The launcher discards caller-supplied `--tools` allowlists before applying this
policy so Paperclip cannot accidentally hide extension or MCP tools.

## Tool policy (single source, deny-list only)

- Single var `PI_HARNESS_EXCLUDE_TOOLS`, default `bash,edit,write,grep,ls`.
- No `defaultTools`, no `--tools` anywhere. To change 2 tools edit 1 env value.
- Example: allow only `read,find` built-ins -> keep default. To also block `find`: `PI_HARNESS_EXCLUDE_TOOLS=bash,edit,write,grep,ls,find`.
- Launcher strips stale `defaultTools` from `$PI_CODING_AGENT_DIR/settings.json` on boot.

## Install and run

Requires Node.js 22.19+, pnpm 11, and Python 3.11+.

```bash
cp .env.local.example .env.local
# Add provider credentials to the ignored .env.local file.
./install.sh
./run-pi-local.sh
```

The launcher may be called from another workspace. It preserves that working
directory and uses Pi's global `$HOME/.pi/agent` configuration unless Paperclip
supplies `PI_CODING_AGENT_DIR` for managed providers. Paperclip owns session
isolation; harness-specific mutable state remains under
`PI_HARNESS_STATE_ROOT/<PAPERCLIP_AGENT_ID>`.
Launcher diagnostics are silent by default so model discovery receives plain Pi
output. Set `PI_HARNESS_LOG=true` when debugging the wrapper.

## Paperclip runtime

Paperclip supplies `PAPERCLIP_*` variables when launching the harness. The local
MCP server receives only its explicit environment allowlist. TinyFish and model
provider credentials are not forwarded to the MCP process.

The checked-in configuration uses the TinyFish minimal profile. Secrets belong
only in the ignored `.env.local` file or the deployment secret store; never add
them to JSON configuration or Git history.
