import type { CallToolResult, McpServer, ToolAnnotations } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { type AppError, toAppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/** Declarative description of one MCP tool. Handlers return plain data or throw. */
export interface ToolDefinition<Schema extends z.ZodObject> {
  name: string;
  title: string;
  /** Written for an AI agent: what the tool does, when to use it, and any side effects. */
  description: string;
  inputSchema: Schema;
  annotations: ToolAnnotations;
  handler: (args: z.output<Schema>) => Promise<unknown>;
}

export type RegisterTool = <Schema extends z.ZodObject>(definition: ToolDefinition<Schema>) => void;

export interface ToolRegistrarOptions {
  /** Called for every failed tool call (after conversion to a safe AppError). */
  onError?: (error: AppError, toolName: string) => void;
}

export interface ToolSuccessPayload {
  success: true;
  data: unknown;
}

export interface ToolErrorPayload {
  success: false;
  error: ReturnType<AppError['toBody']>;
}

function toResult(
  payload: ToolSuccessPayload | ToolErrorPayload,
  isError: boolean,
): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: { ...payload },
    ...(isError ? { isError: true } : {}),
  };
}

export function successResult(data: unknown): CallToolResult {
  return toResult({ success: true, data }, false);
}

export function errorResult(error: AppError): CallToolResult {
  return toResult({ success: false, error: error.toBody() }, true);
}

/**
 * Returns a function that registers tools on the server with uniform behaviour: the SDK
 * validates arguments against the Zod schema, results are wrapped as `{ success, data }`, and
 * every failure is converted into a safe `{ success: false, error: { code, message } }` payload.
 */
export function createToolRegistrar(
  server: McpServer,
  options: ToolRegistrarOptions = {},
): RegisterTool {
  return <Schema extends z.ZodObject>(definition: ToolDefinition<Schema>) => {
    // Widen to the concrete ZodObject type so the SDK's conditional callback type resolves.
    const inputSchema: z.ZodObject = definition.inputSchema;
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema,
        annotations: { title: definition.title, ...definition.annotations },
      },
      async (args) => {
        const startedAt = Date.now();
        // Arguments are never logged: they can contain document content.
        logger.debug(`Tool "${definition.name}" called.`);
        try {
          // The SDK has already validated `args` against `inputSchema` (defaults applied).
          const result = successResult(await definition.handler(args as z.output<Schema>));
          logger.debug(`Tool "${definition.name}" succeeded.`, {
            durationMs: Date.now() - startedAt,
          });
          return result;
        } catch (err) {
          const appError = toAppError(err);
          logger.warn(`Tool "${definition.name}" failed.`, {
            errorCode: appError.code,
            durationMs: Date.now() - startedAt,
            cause: appError.cause,
          });
          options.onError?.(appError, definition.name);
          return errorResult(appError);
        }
      },
    );
  };
}
