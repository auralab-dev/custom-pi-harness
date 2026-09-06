# Pi harness for Paperclip

A reproducible Pi coding-agent runtime profile used by Paperclip. It keeps the
full Pi built-in toolset enabled, adds web/content retrieval and Paperclip MCP,
and isolates each Paperclip run from other projects and agents with
[`pi-playpen`](https://pi.dev/packages/pi-playpen).

## Filesystem model

Each Pi run receives two intentional filesystem scopes:

- **current Paperclip workspace — read/write**: the launcher's original `$PWD`;
- **current agent instruction directory — read-only**: detected from
  Paperclip's `--append-system-prompt`, or supplied explicitly with
  `PI_HARNESS_INSTRUCTIONS_ROOT` / `PI_HARNESS_INSTRUCTIONS_FILE`.

Everything else under shared paths such as `/paperclip` is outside the Playpen
project list. This prevents built-in `find`, `grep`, `ls`, `read`, `write`,
`edit`, and subprocesses launched through `bash` from walking other projects or
other agents' workspaces.

The old custom `pi-workspace-boundary` hook has been removed. Filesystem/tool
enforcement is delegated to the public `pi-playpen@0.1.3` package. The only
custom glue left is:

1. `scripts/prepare-playpen-config.mjs` — resolves the scope for the current
   Paperclip run and writes a private Playpen config;
2. `scripts/pi-playpen-scoped.ts` — loads Playpen against that per-run config
   without changing the real `HOME` seen by git and other commands.

Playpen's security boundary covers Pi's seven managed built-ins. MCP and other
extension tools remain trusted host code and must enforce their own scoping.

## Included packages

- `pi-playpen@0.1.3` — policy-aware built-ins plus OS-level Bash sandboxing.
- `pi-web-access` — `web_search` and `download_file`, adapted from
  [nicobailon/pi-web-access](https://github.com/nicobailon/pi-web-access).
- `pi-zvec-content` — bounded `file_content_search` powered by
  [zvec-ai/zvec-grep](https://github.com/zvec-ai/zvec-grep/).
- `pi-document-convert` — local PDF/document conversion used by downloads.
- [`paperclip-mcp-server`](https://github.com/auralab-dev/paperclip-mcp) —
  compact Paperclip API tools exposed through `pi-mcp-adapter`.
- `pi-session-trace` — session diagnostics.
- `@agnishc/edb-context-viewer@0.21.1` — `/context` TUI overlay.

The seven Pi built-ins are enabled:

```text
read
bash
edit
write
grep
find
ls
```

Caller-supplied `--tools` allowlists are still discarded because Paperclip's
built-in-only list would otherwise hide extension/MCP tools. `defaultTools` is
fixed to all seven built-ins; Playpen controls where those tools may operate.

## Install and run

Requires Node.js 22.19+, pnpm 11, and Python 3.11+.

On Linux, Playpen additionally requires `bwrap`, `socat`, and `rg`. In Docker,
install those binaries in the image and ensure the container permits the user
namespace / mount operations required by Bubblewrap. Run `/playpen-doctor` in a
Pi session when validating a new image.

```bash
cp .env.local.example .env.local
# Add provider credentials to the ignored .env.local file.
./install.sh
./run-pi-local.sh
```

`pi-playpen` was added after the original frozen lockfile in this snapshot. The
installer detects that one-time mismatch and runs `pnpm install
--no-frozen-lockfile`; after the lock contains Playpen, subsequent installs go
back to `--frozen-lockfile`. Commit the refreshed `pnpm-lock.yaml` in your normal
networked development environment.

The launcher may be called from another workspace. It preserves that working
directory and uses Pi's global `$HOME/.pi/agent` configuration unless Paperclip
supplies `PI_CODING_AGENT_DIR`. Harness state remains under
`PI_HARNESS_STATE_ROOT/<PAPERCLIP_AGENT_ID>`.

### Agent instructions outside the workspace

Current Paperclip embeds the resolved instruction-file path in
`--append-system-prompt`. The launcher extracts the **last** Paperclip marker
from that prompt and exposes only the containing directory as read-only. Using
the final marker prevents instruction text that happens to contain a copied
marker from widening the scope.

For an explicit/stable integration contract, set one of:

```bash
PI_HARNESS_INSTRUCTIONS_ROOT=/paperclip/.../agent-a/instructions
# or
PI_HARNESS_INSTRUCTIONS_FILE=/paperclip/.../agent-a/AGENTS.md
```

If no instruction path can be determined, the configuration fails narrow: only
the current workspace is exposed. It never falls back to `/paperclip`.

## Paperclip runtime

Paperclip supplies `PAPERCLIP_*` variables when launching the harness. The local
MCP server receives only its explicit environment allowlist. TinyFish and model
provider credentials are not forwarded to the MCP process.

The checked-in configuration uses the TinyFish minimal profile. Secrets belong
only in the ignored `.env.local` file or the deployment secret store; never add
them to JSON configuration or Git history.
