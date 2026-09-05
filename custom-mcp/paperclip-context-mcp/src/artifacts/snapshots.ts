import { randomBytes } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ensureTrailingNewline } from '../util/text.js';
import { sanitizePathSegment, timestampPathSegment } from '../util/path.js';

export interface SnapshotMeta {
  source: string;
  fetchedAt?: Date;
}

export interface SnapshotResult {
  path: string;
  bytes: number;
}

export class SnapshotStore {
  private readonly runDirectory: string;

  constructor(root: string, runId?: string) {
    const runSegment = runId ? `run_${sanitizePathSegment(runId)}` : `manual_${process.pid}`;
    this.runDirectory = join(root, runSegment);
  }

  async init(): Promise<void> {
    await mkdir(this.runDirectory, { recursive: true, mode: 0o700 });
    // mkdir honors umask. Tighten in case the directory already existed with broader permissions.
    await chmod(this.runDirectory, 0o700);
  }

  async writeMarkdown(markdown: string, meta: SnapshotMeta): Promise<SnapshotResult> {
    await this.init();

    const now = new Date();
    const requestId = randomBytes(4).toString('hex');
    const directory = join(this.runDirectory, `${timestampPathSegment(now)}_${requestId}`);
    await mkdir(directory, { mode: 0o700 });

    const path = join(directory, 'response.md');
    const fetchedAt = meta.fetchedAt ?? now;
    const header = [
      `> Paperclip snapshot @ ${fetchedAt.toISOString()}. Read-only; call MCP again to refresh or modify.`,
      `> Source: ${meta.source}`,
      '',
    ].join('\n');
    const content = ensureTrailingNewline(`${header}${markdown.trimStart()}`);

    await writeFile(path, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await chmod(path, 0o444);

    return {
      path,
      bytes: Buffer.byteLength(content, 'utf8'),
    };
  }
}
