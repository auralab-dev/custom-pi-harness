export function normalizeLineBreaks(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

export function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

export function sanitizeSingleLine(value: string): string {
  return normalizeLineBreaks(value).replace(/\s*\n\s*/g, ' ').trim();
}

export function escapeTableCell(value: string): string {
  return sanitizeSingleLine(value).replace(/\|/g, '\\|');
}

export function truncate(value: string, max = 180): string {
  const clean = sanitizeSingleLine(value);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1))}…`;
}

export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
