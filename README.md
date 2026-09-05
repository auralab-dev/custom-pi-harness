# Pi content stack

Model-facing tools in the included profile:

```text
find
web_search(query)
download_file(url)
file_content_search(path, query)
```

`read`, `read_file`, `grep`, and `bash` are not enabled by the project profile.

## Install

Requires Node.js 22+ for zvec-grep.

```bash
cd pi-web-access-main && npm install
cd ../pi-zvec-content && npm install
cd ..
./run-pi-local.sh
```

## Flow

1. `web_search` uses configured Exa search.
2. `download_file` downloads/extracts one URL and returns only `.pi/downloads/<id>/content.md`.
3. For PDFs, the actual temporary extracted Markdown is copied into that project-local file; the small pi-web-access PDF receipt is never used as searchable content.
4. `file_content_search` searches any project-relative file/directory using bounded zvec results.
5. Polish retrieval uses `local/potion-multilingual-128m`; hybrid and lexical candidate sets are fused before evidence expansion.
6. zvec is used as a locator/ranker: the wrapper privately reopens only ranked source ranges and keeps the model-visible result under `maxResultChars`.
7. Page-marked PDF Markdown is projected privately into per-page search files; HTML tables become explicit row records for retrieval.
8. Concurrent searches against the same target are serialized.
9. Regex-like queries use zvec managed ripgrep.
10. zvec process failures are real Pi tool errors and include bounded path-redacted diagnostics.

Runtime state stays under `.pi/` except transient upstream extraction work in the OS temp directory; PDF temp Markdown is removed after it is copied into `.pi/downloads/`.
