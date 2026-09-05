#!/usr/bin/env node

import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { loadConfig } from './config.js';
import { createServer } from './server.js';

const config = loadConfig();

void serveStdio(() => createServer(config));

process.stderr.write(
  `${JSON.stringify({
    kind: 'paperclip_mcp_server',
    at: new Date().toISOString(),
    status: 'started',
    artifact_root: config.artifactRoot,
    telemetry: config.telemetryEnabled,
    inline_token_threshold: config.inlineTokenThreshold,
    custom_header_count: Object.keys(config.customHeaders).length,
  })}\n`,
);
