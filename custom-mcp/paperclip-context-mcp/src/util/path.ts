export function sanitizePathSegment(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return safe.slice(0, 120) || 'unknown';
}

export function timestampPathSegment(date = new Date()): string {
  return date.toISOString().replace(/:/g, '-').replace(/\./g, '-').replace(/Z$/, 'Z');
}
