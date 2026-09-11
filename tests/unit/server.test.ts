import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SERVER_NAME, SERVER_VERSION } from '../../src/server.js';
import { createTestDependencies } from '../helpers/fakes.js';
import { connectTestClient } from '../helpers/harness.js';

type Harness = Awaited<ReturnType<typeof connectTestClient>>;
type ListedTool = Awaited<ReturnType<Harness['client']['listTools']>>['tools'][number];

// Only the auth and document tool groups are asserted here; other groups have their own tests.
const AUTH_TOOLS = ['get_auth_status', 'authenticate', 'sign_out'];
const DOCUMENT_TOOLS = [
  'create_document',
  'get_document',
  'list_documents',
  'delete_document',
  'copy_document',
];
const READ_ONLY = ['get_auth_status', 'get_document', 'list_documents'];
const DESTRUCTIVE = ['delete_document', 'sign_out'];
const NON_DESTRUCTIVE_WRITES = ['authenticate', 'create_document', 'copy_document'];

describe('MCP server', () => {
  let h: Harness;
  let tools: Map<string, ListedTool>;

  const tool = (name: string): ListedTool => {
    const found = tools.get(name);
    if (!found) throw new Error(`Tool ${name} is not registered`);
    return found;
  };

  beforeEach(async () => {
    h = await connectTestClient(createTestDependencies().deps);
    const { tools: listed } = await h.client.listTools();
    tools = new Map(listed.map((item) => [item.name, item]));
  });

  afterEach(async () => {
    await h.close();
  });

  it('identifies itself and advertises tools, resources and prompts', () => {
    expect(h.client.getServerVersion()).toMatchObject({
      name: SERVER_NAME,
      version: SERVER_VERSION,
    });
    const capabilities = h.client.getServerCapabilities();
    expect(capabilities?.tools).toBeDefined();
    expect(capabilities?.resources).toBeDefined();
    expect(capabilities?.prompts).toBeDefined();
  });

  it('provides usage instructions for AI agents', () => {
    const instructions = h.client.getInstructions() ?? '';
    expect(instructions).toContain('authenticate');
    expect(instructions).toContain('index');
  });

  it('registers the auth and document tools', () => {
    for (const name of [...AUTH_TOOLS, ...DOCUMENT_TOOLS]) {
      expect(tools.has(name), name).toBe(true);
    }
  });

  it('gives every tool a title, a useful description and an object input schema', () => {
    for (const name of [...AUTH_TOOLS, ...DOCUMENT_TOOLS]) {
      const listed = tool(name);
      expect(listed.title, name).toBeTruthy();
      expect(listed.annotations?.title, name).toBe(listed.title);
      expect(listed.description?.length ?? 0, name).toBeGreaterThan(60);
      expect(listed.inputSchema.type, name).toBe('object');
    }
  });

  it('marks read-only tools with readOnlyHint', () => {
    for (const name of READ_ONLY) {
      expect(tool(name).annotations?.readOnlyHint, name).toBe(true);
    }
  });

  it('marks destructive tools with destructiveHint', () => {
    for (const name of DESTRUCTIVE) {
      const annotations = tool(name).annotations;
      expect(annotations?.readOnlyHint, name).toBe(false);
      expect(annotations?.destructiveHint, name).toBe(true);
    }
  });

  it('marks other write tools as non-destructive', () => {
    for (const name of NON_DESTRUCTIVE_WRITES) {
      const annotations = tool(name).annotations;
      expect(annotations?.readOnlyHint, name).toBe(false);
      expect(annotations?.destructiveHint, name).toBe(false);
    }
  });

  it('describes delete_document as moving to trash', () => {
    expect(tool('delete_document').description).toMatch(/trash/i);
    expect(tool('delete_document').description).toMatch(/not permanently/i);
  });

  it('exposes documentId and required parameters in the input schemas', () => {
    const getDocument = tool('get_document').inputSchema;
    expect(Object.keys(getDocument.properties ?? {})).toEqual(
      expect.arrayContaining(['documentId', 'includeStructure', 'maxTextLength']),
    );
    expect(getDocument.required).toEqual(['documentId']);
    expect(tool('create_document').inputSchema.required).toEqual(['title']);
    expect(tool('copy_document').inputSchema.required).toEqual(
      expect.arrayContaining(['documentId', 'newTitle']),
    );
    expect(Object.keys(tool('list_documents').inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(['limit', 'pageToken', 'search']),
    );
  });
});
