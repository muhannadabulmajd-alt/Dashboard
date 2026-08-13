import 'server-only';
import { createHash, randomUUID } from 'node:crypto';

function stable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stable(entry)]),
    );
  }
  return value;
}

export function preconditionHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export function aiDebugId(prefix = 'ai'): string {
  return `${prefix}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}
