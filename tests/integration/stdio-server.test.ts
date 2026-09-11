import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ToolPayload } from '../helpers/harness.js';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TIMEOUT_MS = 30_000;

const EXPECTED_TOOLS = [
  'get_auth_status',
  'authenticate',
  'sign_out',
  'create_document',
  'get_document',
  'list_documents',
  'delete_document',
  'copy_document',
  'append_text',
  'insert_text',
  'replace_text',
  'delete_text',
  'format_text',
  'set_paragraph_style',
  'set_alignment',
  'insert_page_break',
  'insert_table',
  'insert_link',
  'create_bulleted_list',
  'search_documents',
  'find_text',
];

function parsePayload(result: Awaited<ReturnType<Client['callTool']>>): ToolPayload {
  const first = Array.isArray(result.content) ? result.content[0] : undefined;
  if (!first || first.type !== 'text') throw new Error('Expected a text content block.');
  return JSON.parse(first.text) as ToolPayload;
}

/**
 * Spawns the real server (`node --import tsx src/index.ts`) and talks to it over stdio, exactly
 * like an MCP client would. No Google credentials are configured, so nothing reaches Google.
 */
describe('stdio server (real process)', () => {
  let tempDir: string;
  let client: Client;
  let transport: StdioClientTransport;
  const transportErrors: Error[] = [];
  let stderrOutput = '';

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'google-docs-mcp-stdio-'));
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? tempDir,
      GOOGLE_TOKEN_PATH: path.join(tempDir, 'tokens.json'),
      // Explicitly blank: a developer's local .env must not be able to supply real credentials
      // (process.loadEnvFile never overrides variables that are already set).
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      LOG_LEVEL: 'info',
    };
    transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'src/index.ts'],
      cwd: REPO_ROOT,
      env,
      stderr: 'pipe',
    });
    (transport.stderr as Readable | null)?.on('data', (chunk: Buffer) => {
      stderrOutput += chunk.toString('utf8');
    });
    client = new Client({ name: 'stdio-integration-test', version: '1.0.0' });
    // Any stdout line that is not a JSON-RPC message surfaces here as a parse error.
    client.onerror = (error) => {
      transportErrors.push(error);
    };
    await client.connect(transport, { timeout: TIMEOUT_MS });
  }, TIMEOUT_MS);

  afterAll(async () => {
    await client.close();
    await rm(tempDir, { recursive: true, force: true });
  }, TIMEOUT_MS);

  it('connects and reports the server identity', () => {
    expect(client.getServerVersion()?.name).toBe('google-docs-mcp');
  });

  it(
    'lists exactly the expected tools, each with a description and object schema',
    async () => {
      const { tools } = await client.listTools(undefined, { timeout: TIMEOUT_MS });
      for (const tool of tools) {
        expect(tool.description, tool.name).toBeTruthy();
        expect(tool.inputSchema.type, tool.name).toBe('object');
      }
      expect(tools.map((tool) => tool.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    },
    TIMEOUT_MS,
  );

  it(
    'reports that no credentials are configured',
    async () => {
      const result = await client.callTool(
        { name: 'get_auth_status', arguments: {} },
        { timeout: TIMEOUT_MS },
      );
      const payload = parsePayload(result);
      expect(payload.success).toBe(true);
      expect(payload.success && payload.data).toMatchObject({
        authenticated: false,
        credentialsConfigured: false,
      });
    },
    TIMEOUT_MS,
  );

  it(
    'returns a structured INVALID_CREDENTIALS error from Google-backed tools',
    async () => {
      const result = await client.callTool(
        { name: 'create_document', arguments: { title: 'Should not be created' } },
        { timeout: TIMEOUT_MS },
      );
      expect(result.isError).toBe(true);
      const payload = parsePayload(result);
      expect(payload.success).toBe(false);
      if (!payload.success) expect(payload.error.code).toBe('INVALID_CREDENTIALS');
    },
    TIMEOUT_MS,
  );

  it(
    'lists prompts and the document resource template',
    async () => {
      const { prompts } = await client.listPrompts(undefined, { timeout: TIMEOUT_MS });
      expect(prompts.map((prompt) => prompt.name).sort()).toEqual([
        'create_meeting_notes',
        'format_document',
        'rewrite_document',
        'summarize_document',
      ]);
      const { resourceTemplates } = await client.listResourceTemplates(undefined, {
        timeout: TIMEOUT_MS,
      });
      expect(resourceTemplates.map((template) => template.uriTemplate)).toContain(
        'google-docs://document/{documentId}',
      );
      // Listing needs Google access; without credentials it degrades to an empty list.
      const { resources } = await client.listResources(undefined, { timeout: TIMEOUT_MS });
      expect(resources).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it('writes nothing but JSON-RPC to stdout and logs to stderr', () => {
    expect(transportErrors).toEqual([]);
    expect(stderrOutput).toContain('running on stdio');
  });
});
