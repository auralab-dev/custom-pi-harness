import { appendFile } from 'node:fs/promises';

export interface TelemetryEvent {
  operation: string;
  method?: string;
  path?: string;
  status?: number;
  duration_ms?: number;
  upstream_bytes?: number;
  rendered_bytes?: number;
  inline_bytes?: number;
  all_fields?: boolean;
  artifact_path?: string;
  error?: string;
  [key: string]: unknown;
}

export class Telemetry {
  constructor(
    private readonly enabled: boolean,
    private readonly file?: string,
  ) {}

  async emit(event: TelemetryEvent): Promise<void> {
    if (!this.enabled) return;

    const payload = JSON.stringify({
      kind: 'paperclip_mcp',
      at: new Date().toISOString(),
      ...event,
    });

    // stdout is the MCP protocol channel; diagnostics must stay on stderr.
    process.stderr.write(`${payload}\n`);

    if (this.file) {
      try {
        await appendFile(this.file, `${payload}\n`, { encoding: 'utf8' });
      } catch (error) {
        process.stderr.write(
          `${JSON.stringify({
            kind: 'paperclip_mcp_telemetry_error',
            at: new Date().toISOString(),
            error: error instanceof Error ? error.message : String(error),
          })}\n`,
        );
      }
    }
  }
}
