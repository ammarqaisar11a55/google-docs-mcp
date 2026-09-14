import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUnconfiguredDependencies } from '../../../src/server.js';
import { AppError, ErrorCode } from '../../../src/utils/errors.js';
import { connectTestClient, expectError, expectSuccess } from '../../helpers/harness.js';

type Harness = Awaited<ReturnType<typeof connectTestClient>>;

const CONFIG_MESSAGE = 'Invalid configuration. GOOGLE_DRIVE_FILE_ONLY: Invalid option';

describe('server started with an invalid configuration', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await connectTestClient(
      createUnconfiguredDependencies(new AppError(ErrorCode.CONFIG_ERROR, CONFIG_MESSAGE)),
    );
  });

  afterEach(async () => {
    await h.close();
  });

  it('still registers every tool', async () => {
    const { tools } = await h.client.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(21);
  });

  it('get_auth_status explains the configuration problem', async () => {
    const data = expectSuccess(await h.callTool('get_auth_status'));
    expect(data).toMatchObject({
      authenticated: false,
      credentialsConfigured: false,
      configurationError: CONFIG_MESSAGE,
    });
  });

  it.each([
    ['authenticate', { force: true, openBrowser: false }],
    ['create_document', { title: 'x' }],
    ['list_documents', {}],
    ['search_documents', { query: 'x' }],
    ['sign_out', {}],
  ])('%s fails with CONFIG_ERROR instead of reaching Google', async (tool, args) => {
    const error = expectError(await h.callTool(tool, args));
    expect(error.code).toBe(ErrorCode.CONFIG_ERROR);
    expect(error.message).toBe(CONFIG_MESSAGE);
  });
});
