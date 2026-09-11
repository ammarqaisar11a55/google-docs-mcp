import type { LogLevel } from '../config/config.js';
import { redact } from './errors.js';

const LEVEL_ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };
const SENSITIVE_KEY = /token|secret|password|authorization|credential|verifier/i;
const MAX_DEPTH = 5;

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function sanitize(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redact(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[Truncated]';
  if (value instanceof Error) {
    // Never log stack traces of third-party errors: they can embed request URLs and headers.
    return { name: value.name, message: redact(value.message) };
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitize(item, depth + 1),
    ]),
  );
}

function write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] > LEVEL_ORDER[currentLevel]) return;
  const entry = {
    time: new Date().toISOString(),
    level,
    message: redact(message),
    ...(meta ? { meta: sanitize(meta) } : {}),
  };
  // stdout is reserved for the MCP stdio protocol; all logs go to stderr.
  process.stderr.write(`${JSON.stringify(entry)}\n`);
}

export const logger = {
  error: (message: string, meta?: Record<string, unknown>) => {
    write('error', message, meta);
  },
  warn: (message: string, meta?: Record<string, unknown>) => {
    write('warn', message, meta);
  },
  info: (message: string, meta?: Record<string, unknown>) => {
    write('info', message, meta);
  },
  debug: (message: string, meta?: Record<string, unknown>) => {
    write('debug', message, meta);
  },
};
