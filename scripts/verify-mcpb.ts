/**
 * Verifies build/google-docs-mcp.mcpb the way Claude Desktop uses it:
 *
 * - unpacks it into a temporary directory and validates manifest.json;
 * - checks that the entry point, icon and every runtime dependency are present;
 * - rejects development artifacts (sources, tests, source maps, dev dependencies) and secrets;
 * - resolves the launch command with Claude Desktop's own configuration logic
 *   (@anthropic-ai/mcpb `getMcpConfigForManifest`), starts the bundled server outside the
 *   repository, and checks its tools, prompts and resources over MCP stdio.
 *
 * Usage: npm run package:check
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getMcpConfigForManifest,
  type McpbManifestAny,
  unpackExtension,
  validateManifest,
} from '@anthropic-ai/mcpb';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import {
  BUNDLE_OUTPUT,
  fail,
  formatBytes,
  type Manifest,
  type PackageJson,
  readJson,
  ROOT,
  sha256,
  step,
} from './mcpb-common.js';

const FORBIDDEN_FILES: readonly RegExp[] = [
  /(^|\/)\.env/,
  /(^|\/)tokens?\.json$/i,
  /(^|\/)credentials\.json$/i,
  /(^|\/)client_secret[^/]*\.json$/i,
  /\.secret$/i,
  /\.map$/,
  /\.mcpb$/i,
  /\.tsbuildinfo$/,
];

const SECRET_PATTERNS: readonly RegExp[] = [
  /GOCSPX-[A-Za-z0-9_-]{10,}/,
  /ya29\.[A-Za-z0-9_-]{20,}/,
  /"refresh_token"\s*:\s*"1\/\//,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
];

const SMOKE_TEST_TIMEOUT_MS = 60_000;

function listFiles(directory: string, base = directory): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory()
      ? listFiles(fullPath, base)
      : [path.relative(base, fullPath).split(path.sep).join('/')];
  });
}

interface ToolEnvelope {
  success: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
}

function parseToolText(result: { content?: unknown }): ToolEnvelope {
  const blocks = Array.isArray(result.content) ? (result.content as unknown[]) : [];
  const first = blocks[0] as { type?: string; text?: string } | undefined;
  if (first?.type !== 'text' || typeof first.text !== 'string') {
    return { success: false, error: { code: 'NO_TEXT', message: 'Tool returned no text.' } };
  }
  return JSON.parse(first.text) as ToolEnvelope;
}

if (!existsSync(BUNDLE_OUTPUT)) {
  fail(`${path.relative(ROOT, BUNDLE_OUTPUT)} does not exist. Run "npm run package" first.`);
}

const rootPackage = readJson<PackageJson>(path.join(ROOT, 'package.json'));
const problems: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) problems.push(message);
};

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'google-docs-mcpb-check-'));
const extensionDir = path.join(tempDir, 'extension');

try {
  step(`Unpacking ${path.relative(ROOT, BUNDLE_OUTPUT)}`);
  const unpacked = await unpackExtension({
    mcpbPath: BUNDLE_OUTPUT,
    outputDir: extensionDir,
    silent: true,
  });
  if (!unpacked) fail('The bundle could not be unpacked.');

  step('Validating manifest.json');
  const manifestPath = path.join(extensionDir, 'manifest.json');
  if (!existsSync(manifestPath)) fail('manifest.json is missing from the bundle.');
  if (!validateManifest(manifestPath)) fail('The bundled manifest.json is invalid.');
  const manifest = readJson<Manifest>(manifestPath);
  const bundledPackage = readJson<PackageJson>(path.join(extensionDir, 'package.json'));
  check(
    manifest.version === rootPackage.version && bundledPackage.version === rootPackage.version,
    `Version mismatch: manifest ${manifest.version}, bundled package.json ${bundledPackage.version}, package.json ${rootPackage.version}.`,
  );
  check(manifest.name === rootPackage.name, 'manifest.json name differs from package.json.');

  step('Checking bundle contents');
  const files = listFiles(extensionDir);
  const fileSet = new Set(files);
  check(
    fileSet.has(manifest.server.entry_point),
    `Entry point ${manifest.server.entry_point} is missing.`,
  );
  if (manifest.icon) check(fileSet.has(manifest.icon), `Icon ${manifest.icon} is missing.`);
  check(fileSet.has('LICENSE'), 'LICENSE is missing.');

  for (const dependency of Object.keys(rootPackage.dependencies)) {
    check(
      fileSet.has(`node_modules/${dependency}/package.json`),
      `Runtime dependency ${dependency} is missing from node_modules.`,
    );
  }
  for (const devDependency of Object.keys(rootPackage.devDependencies)) {
    check(
      !existsSync(path.join(extensionDir, 'node_modules', devDependency)),
      `Development dependency ${devDependency} must not be bundled.`,
    );
  }

  const allowedOwnFiles = new Set(['manifest.json', 'package.json', 'LICENSE', manifest.icon]);
  let unpackedBytes = 0;
  for (const file of files) {
    unpackedBytes += statSync(path.join(extensionDir, file)).size;
    for (const pattern of FORBIDDEN_FILES) {
      check(!pattern.test(file), `Forbidden file in bundle: ${file}`);
    }
    if (file.startsWith('node_modules/')) continue;
    const isCompiledServerFile = file.startsWith('dist/') && file.endsWith('.js');
    check(
      isCompiledServerFile || allowedOwnFiles.has(file),
      `Unexpected non-runtime file in bundle: ${file}`,
    );
    if (file.endsWith('.png')) continue;
    const text = readFileSync(path.join(extensionDir, file), 'utf8');
    for (const pattern of SECRET_PATTERNS) {
      check(!pattern.test(text), `Possible secret (${pattern.source}) found in ${file}`);
    }
  }

  step('Launching the bundled server with Claude Desktop configuration logic');
  const home = os.homedir();
  const mcpConfig = await getMcpConfigForManifest({
    manifest: manifest as unknown as McpbManifestAny,
    extensionPath: extensionDir,
    systemDirs: {
      HOME: home,
      DESKTOP: path.join(home, 'Desktop'),
      DOCUMENTS: path.join(home, 'Documents'),
      DOWNLOADS: path.join(home, 'Downloads'),
    },
    userConfig: {
      google_client_id: 'package-check.apps.googleusercontent.com',
      google_client_secret: 'package-check-secret',
    },
    pathSeparator: path.sep,
  });
  if (!mcpConfig)
    fail('Claude Desktop would refuse to start the extension with this configuration.');
  const unresolved = JSON.stringify(mcpConfig).match(/\$\{[^}]+\}/g);
  check(!unresolved, `Unresolved manifest variables: ${unresolved?.join(', ') ?? ''}`);

  // Inherit the system environment (PATH, SystemRoot, ...) but none of this project's settings.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !/^(GOOGLE_|LOG_LEVEL$|npm_)/.test(entry[0]),
    ),
  );
  const transport = new StdioClientTransport({
    // Claude Desktop runs "node" with its built-in Node.js; the check uses the current one.
    command: mcpConfig.command === 'node' ? process.execPath : mcpConfig.command,
    args: mcpConfig.args ?? [],
    env: {
      ...inherited,
      ...mcpConfig.env,
      // Never touch the developer's real tokens.
      GOOGLE_TOKEN_PATH: path.join(tempDir, 'tokens.json'),
    },
    cwd: tempDir,
    stderr: 'pipe',
  });
  let serverLog = '';
  transport.stderr?.on('data', (chunk: Buffer) => {
    serverLog += chunk.toString();
  });

  const client = new Client({ name: 'mcpb-package-check', version: rootPackage.version });
  const timeout = setTimeout(() => {
    fail(
      `The bundled server did not respond within ${SMOKE_TEST_TIMEOUT_MS / 1000}s.\n${serverLog}`,
    );
  }, SMOKE_TEST_TIMEOUT_MS);
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const served = tools.map((tool) => tool.name).sort();
    const declared = (manifest.tools ?? []).map((tool) => tool.name).sort();
    check(
      JSON.stringify(served) === JSON.stringify(declared),
      `manifest.json tools (${declared.join(', ')}) differ from the server's tools (${served.join(', ')}).`,
    );
    for (const tool of tools) {
      check(Boolean(tool.description), `Tool ${tool.name} has no description.`);
    }

    const status = parseToolText(await client.callTool({ name: 'get_auth_status', arguments: {} }));
    check(
      status.success && status.data?.credentialsConfigured === true,
      `get_auth_status did not see the configured OAuth client: ${JSON.stringify(status)}`,
    );
    check(status.data?.authenticated === false, 'A fresh install must not report being signed in.');

    const created = parseToolText(
      await client.callTool({ name: 'create_document', arguments: { title: 'package check' } }),
    );
    check(
      !created.success && created.error?.code === 'NOT_AUTHENTICATED',
      `create_document should require sign-in, got: ${JSON.stringify(created)}`,
    );

    const { prompts } = await client.listPrompts();
    check(prompts.length === 4, `Expected 4 prompts, found ${prompts.length}.`);
    const { resourceTemplates } = await client.listResourceTemplates();
    check(
      resourceTemplates.some((t) => t.uriTemplate === 'google-docs://document/{documentId}'),
      'The google-docs://document/{documentId} resource template is missing.',
    );
    console.log(
      `  server started; ${tools.length} tools, ${prompts.length} prompts, ${resourceTemplates.length} resource template(s)`,
    );
  } finally {
    clearTimeout(timeout);
    await client.close();
  }

  if (problems.length > 0) {
    fail(`Package check failed:\n  - ${problems.join('\n  - ')}`);
  }

  console.log(`\nPackage check passed: ${path.relative(ROOT, BUNDLE_OUTPUT)}`);
  console.log(`  files:         ${files.length}`);
  console.log(`  unpacked size: ${formatBytes(unpackedBytes)}`);
  console.log(`  package size:  ${formatBytes(statSync(BUNDLE_OUTPUT).size)}`);
  console.log(`  sha256:        ${sha256(BUNDLE_OUTPUT)}`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
