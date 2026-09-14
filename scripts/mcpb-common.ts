import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BUILD_DIR = path.join(ROOT, 'build');
export const STAGE_DIR = path.join(BUILD_DIR, 'bundle');
export const BUNDLE_OUTPUT = path.join(BUILD_DIR, 'google-docs-mcp.mcpb');

export interface PackageJson {
  name: string;
  version: string;
  description?: string;
  license?: string;
  type?: string;
  main: string;
  engines?: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

export interface Manifest {
  name: string;
  version: string;
  icon?: string;
  server: {
    entry_point: string;
    mcp_config: { command: string; args?: string[]; env?: Record<string, string> };
  };
  tools?: { name: string; description?: string }[];
}

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

export function step(message: string): void {
  console.log(`\n> ${message}`);
}

export function fail(message: string): never {
  console.error(`\nERROR: ${message}`);
  process.exit(1);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
