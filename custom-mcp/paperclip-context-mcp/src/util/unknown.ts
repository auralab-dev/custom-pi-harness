export type JsonObject = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): JsonObject | undefined {
  return isRecord(value) ? value : undefined;
}

export function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function pickString(object: JsonObject | undefined, ...keys: string[]): string | undefined {
  if (!object) return undefined;
  for (const key of keys) {
    const value = asString(object[key]);
    if (value !== undefined && value.length > 0) return value;
  }
  return undefined;
}

export function pickNumber(object: JsonObject | undefined, ...keys: string[]): number | undefined {
  if (!object) return undefined;
  for (const key of keys) {
    const value = asNumber(object[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function pickBoolean(object: JsonObject | undefined, ...keys: string[]): boolean | undefined {
  if (!object) return undefined;
  for (const key of keys) {
    const value = asBoolean(object[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function pickRecord(object: JsonObject | undefined, ...keys: string[]): JsonObject | undefined {
  if (!object) return undefined;
  for (const key of keys) {
    const value = asRecord(object[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function pickArray(object: JsonObject | undefined, ...keys: string[]): unknown[] | undefined {
  if (!object) return undefined;
  for (const key of keys) {
    const value = asArray(object[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function compactObject<T extends Record<string, unknown>>(object: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  );
}

export function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  return values.find((value): value is T => value !== undefined);
}

export function displayName(value: unknown): string | undefined {
  const object = asRecord(value);
  if (!object) return asString(value);
  return firstDefined(
    pickString(object, 'name', 'title', 'identifier', 'shortname', 'key'),
    pickString(object, 'id'),
  );
}

export function summarizeIdentity(value: unknown): string | undefined {
  const object = asRecord(value);
  if (!object) return asString(value);

  const identifier = pickString(object, 'identifier', 'shortname', 'key');
  const title = pickString(object, 'title', 'name');

  if (identifier && title && identifier !== title) return `${identifier} — ${title}`;
  return identifier ?? title ?? pickString(object, 'id');
}
