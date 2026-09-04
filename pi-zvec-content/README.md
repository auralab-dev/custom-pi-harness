# pi-zvec-content

One bounded Pi content tool:

```text
file_content_search(path, query)
```

Use it for a project-relative file/directory discovered by `find` or returned by `download_file`. It returns short bounded excerpts rather than whole files.

Behavior:
- resolves symlinks and rejects paths outside the current project;
- serializes operations per target so parallel agent calls cannot race the same zvec index;
- normal queries use zvec hybrid indexed retrieval;
- intentional regex-like queries automatically use managed `zg query --rg`;
- zvec stdout returned to the model is capped by `maxResultChars`;
- zvec failures are thrown as real Pi tool errors with bounded, path-redacted diagnostics;
- private indexes/models/state live under the Pi config directory.

`.pi/zvec-content.json`:

```json
{
  "embedding": "local/potion-retrieval-32m",
  "limit": 4,
  "maxResultChars": 4000
}
```

Requires Node.js 22+ and `npm install` in this package.

## Runtime mode

Indexed operations use zvec `auto` mode. The first search creates the per-target index; later searches query it with `--refresh wait` instead of invoking `zg index` again. This avoids daemon write-lease conflicts while still picking up file changes.
