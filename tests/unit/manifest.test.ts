import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  getMcpConfigForManifest,
  hasRequiredConfigMissing,
  MANIFEST_SCHEMAS,
  type McpbManifestAny,
} from '@anthropic-ai/mcpb';
import { describe, expect, it } from 'vitest';
import { DRIVE_SCOPES, isDotenvEnabled, loadConfig } from '../../src/config/config.js';
import { createTestDependencies } from '../helpers/fakes.js';
import { connectTestClient } from '../helpers/harness.js';

const ROOT = path.resolve(import.meta.dirname, '../..');

interface UserConfigOption {
  type: string;
  required?: boolean;
  sensitive?: boolean;
  default?: unknown;
}

interface ManifestShape {
  manifest_version: string;
  name: string;
  version: string;
  icon: string;
  license: string;
  privacy_policies: string[];
  server: {
    type: string;
    entry_point: string;
    mcp_config: { command: string; args: string[]; env: Record<string, string> };
  };
  tools: { name: string; description: string }[];
  user_config: Record<string, UserConfigOption>;
}

const manifest = JSON.parse(
  readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'),
) as ManifestShape;
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
  main: string;
  license: string;
};

const REQUIRED_SETTINGS = {
  google_client_id: '123-abc.apps.googleusercontent.com',
  google_client_secret: 'test-secret',
};

async function hostConfig(userConfig: Record<string, string | number | boolean>) {
  const config = await getMcpConfigForManifest({
    manifest: manifest as unknown as McpbManifestAny,
    extensionPath: '/extensions/google-docs-mcp',
    systemDirs: {
      HOME: '/home/user',
      DESKTOP: '/home/user/Desktop',
      DOCUMENTS: '/home/user/Documents',
      DOWNLOADS: '/home/user/Downloads',
    },
    userConfig,
    pathSeparator: '/',
  });
  if (!config) throw new Error('The host refused to build a server configuration.');
  return config;
}

describe('manifest.json (Claude Desktop extension)', () => {
  it('is a valid MCPB 0.3 manifest', () => {
    const result = MANIFEST_SCHEMAS['0.3'].safeParse(manifest);
    expect(result.error?.issues ?? []).toEqual([]);
    expect(manifest.manifest_version).toBe('0.3');
  });

  it('matches package.json name, version, license and entry point', () => {
    expect(manifest.name).toBe(pkg.name);
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.license).toBe(pkg.license);
    expect(manifest.server.type).toBe('node');
    expect(manifest.server.entry_point).toBe(pkg.main);
    expect(manifest.server.mcp_config.command).toBe('node');
    expect(manifest.server.mcp_config.args).toEqual([`\${__dirname}/${pkg.main}`]);
  });

  it('references an icon that exists and a privacy policy', () => {
    expect(existsSync(path.join(ROOT, manifest.icon))).toBe(true);
    expect(manifest.privacy_policies.length).toBeGreaterThan(0);
  });

  it('declares exactly the tools the server registers', async () => {
    const { deps } = createTestDependencies();
    const h = await connectTestClient(deps);
    try {
      const { tools } = await h.client.listTools();
      expect(manifest.tools.map((tool) => tool.name).sort()).toEqual(
        tools.map((tool) => tool.name).sort(),
      );
      for (const tool of manifest.tools) expect(tool.description.length).toBeGreaterThan(10);
    } finally {
      await h.close();
    }
  });

  it('only references declared settings, and every optional setting has a default', () => {
    const referenced = [
      ...JSON.stringify(manifest.server.mcp_config).matchAll(/\$\{user_config\.([^}]+)\}/g),
    ].map((match) => match[1]);
    for (const key of referenced) expect(manifest.user_config).toHaveProperty(key as string);
    for (const [key, option] of Object.entries(manifest.user_config)) {
      expect(referenced, `setting ${key} is never used`).toContain(key);
      if (!option.required) expect(option.default, `setting ${key} needs a default`).toBeDefined();
    }
  });

  it('requires both OAuth settings and stores the client secret as sensitive', () => {
    expect(manifest.user_config.google_client_id?.required).toBe(true);
    expect(manifest.user_config.google_client_secret).toMatchObject({
      required: true,
      sensitive: true,
    });
    expect(
      hasRequiredConfigMissing({
        manifest: manifest as unknown as McpbManifestAny,
        userConfig: {},
      }),
    ).toBe(true);
    expect(
      hasRequiredConfigMissing({
        manifest: manifest as unknown as McpbManifestAny,
        userConfig: REQUIRED_SETTINGS,
      }),
    ).toBe(false);
  });

  describe('as launched by Claude Desktop', () => {
    it('launches the compiled entry point from the extension directory', async () => {
      const config = await hostConfig(REQUIRED_SETTINGS);
      expect(config.command).toBe('node');
      expect(config.args).toEqual(['/extensions/google-docs-mcp/dist/index.js']);
    });

    it('produces a fully resolved environment that loads with the default settings', async () => {
      const env = (await hostConfig(REQUIRED_SETTINGS)).env ?? {};
      expect(JSON.stringify(env)).not.toContain('${');
      expect(isDotenvEnabled(env)).toBe(false);
      const config = loadConfig(env);
      expect(config.google).toMatchObject({
        clientId: REQUIRED_SETTINGS.google_client_id,
        clientSecret: REQUIRED_SETTINGS.google_client_secret,
        redirectUri: 'http://127.0.0.1:53682/oauth2callback',
        driveScope: 'drive',
      });
      expect(config.logLevel).toBe('info');
    });

    it('maps the optional settings onto the server configuration', async () => {
      const env =
        (
          await hostConfig({
            ...REQUIRED_SETTINGS,
            limit_drive_access: true,
            oauth_callback_port: 54000,
            debug_logging: true,
          })
        ).env ?? {};
      const config = loadConfig(env);
      expect(config.google.driveScope).toBe('drive.file');
      expect(config.google.scopes).toContain(DRIVE_SCOPES['drive.file']);
      expect(config.google.scopes).not.toContain(DRIVE_SCOPES.drive);
      expect(config.google.redirectUri).toBe('http://127.0.0.1:54000/oauth2callback');
      expect(config.logLevel).toBe('debug');
    });
  });
});
