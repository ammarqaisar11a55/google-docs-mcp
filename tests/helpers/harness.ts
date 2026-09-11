import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer, type ServerDependencies } from '../../src/server.js';
import type { ToolErrorPayload, ToolSuccessPayload } from '../../src/tools/define-tool.js';

export type ToolPayload = ToolSuccessPayload | ToolErrorPayload;

export interface ToolCallOutcome {
  isError: boolean;
  payload: ToolPayload;
  /** Raw text of the first content block (for assertions on formatting/secrets). */
  text: string;
}

/** Connects a real MCP client to a real server instance over an in-memory transport. */
export async function connectTestClient(deps: ServerDependencies) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(deps);
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);

  async function callTool(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<ToolCallOutcome> {
    const result = await client.callTool({ name, arguments: args });
    const first = Array.isArray(result.content) ? result.content[0] : undefined;
    const text = first && first.type === 'text' ? first.text : '';
    let payload: ToolPayload;
    try {
      payload = JSON.parse(text) as ToolPayload;
    } catch {
      // SDK-level failures (e.g. schema validation) are plain text, not our JSON envelope.
      payload = {
        success: false,
        error: { code: 'INVALID_ARGUMENT', message: text, retryable: false },
      };
    }
    return { isError: result.isError === true, payload, text };
  }

  return {
    client,
    server,
    callTool,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** Narrowing helper: asserts a successful payload and returns its data. */
export function expectSuccess<T = Record<string, unknown>>(outcome: ToolCallOutcome): T {
  if (!outcome.payload.success) {
    throw new Error(
      `Expected success but got ${outcome.payload.error.code}: ${outcome.payload.error.message}`,
    );
  }
  return outcome.payload.data as T;
}

/** Narrowing helper: asserts an error payload and returns its error body. */
export function expectError(outcome: ToolCallOutcome): ToolErrorPayload['error'] {
  if (outcome.payload.success) throw new Error('Expected an error result but the tool succeeded.');
  return outcome.payload.error;
}
