/**
 * Builds build/google-docs-mcp.mcpb, a self-contained Claude Desktop extension (MCP Bundle).
 *
 * 1. Compiles the server into a clean staging directory (no source maps, tests or sources).
 * 2. Installs exactly the production dependencies from package-lock.json (`npm ci --omit=dev`).
 * 3. Validates manifest.json and packs the directory with the official @anthropic-ai/mcpb packer.
 *
 * Usage: npm run package   (then: npm run package:check)
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { packExtension, validateManifest } from '@anthropic-ai/mcpb';
import {
  BUNDLE_OUTPUT,
  fail,
  formatBytes,
  type Manifest,
  type PackageJson,
  readJson,
  ROOT,
  sha256,
  STAGE_DIR,
  step,
} from './mcpb-common.js';

function run(command: string, args: string[], cwd: string, shell = false): void {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell });
  if (result.error) fail(`Could not run ${path.basename(command)}: ${result.error.message}`);
  if (result.status !== 0) {
    fail(
      `"${path.basename(command)} ${args.join(' ')}" exited with code ${String(result.status)}.`,
    );
  }
}

function runNpm(args: string[], cwd: string): void {
  // When started through `npm run`, npm_execpath points at npm's JavaScript entry point, which
  // runs the same npm on every platform without needing a shell.
  const npmCli = process.env.npm_execpath;
  if (npmCli && /\.[cm]?js$/.test(npmCli)) {
    run(process.execPath, [npmCli, ...args], cwd);
  } else if (process.platform === 'win32') {
    run('npm.cmd', args, cwd, true);
  } else {
    run('npm', args, cwd);
  }
}

function copyIntoStage(relativePath: string): void {
  const source = path.join(ROOT, relativePath);
  if (!existsSync(source)) fail(`Required bundle file is missing: ${relativePath}`);
  const target = path.join(STAGE_DIR, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(source, target);
}

const pkg = readJson<PackageJson>(path.join(ROOT, 'package.json'));
const manifest = readJson<Manifest>(path.join(ROOT, 'manifest.json'));

step('Checking manifest.json against package.json');
if (manifest.name !== pkg.name) {
  fail(`manifest.json name "${manifest.name}" differs from package.json name "${pkg.name}".`);
}
if (manifest.version !== pkg.version) {
  fail(
    `manifest.json version ${manifest.version} differs from package.json version ${pkg.version}.`,
  );
}
if (manifest.server.entry_point !== pkg.main) {
  fail(
    `manifest.json server.entry_point "${manifest.server.entry_point}" differs from package.json main "${pkg.main}".`,
  );
}

step('Preparing a clean staging directory (build/bundle)');
rmSync(STAGE_DIR, { recursive: true, force: true });
rmSync(BUNDLE_OUTPUT, { force: true });
mkdirSync(STAGE_DIR, { recursive: true });

step('Compiling TypeScript');
const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
if (!existsSync(tsc)) fail('TypeScript is not installed. Run "npm ci" first.');
run(
  process.execPath,
  [
    tsc,
    '-p',
    path.join(ROOT, 'tsconfig.build.json'),
    '--outDir',
    path.join(STAGE_DIR, 'dist'),
    '--sourceMap',
    'false',
  ],
  ROOT,
);
if (!existsSync(path.join(STAGE_DIR, manifest.server.entry_point))) {
  fail(`The compiled entry point ${manifest.server.entry_point} was not produced.`);
}

step('Copying manifest, icon and license');
for (const file of ['manifest.json', 'LICENSE', manifest.icon]) {
  if (file) copyIntoStage(file);
}

step('Installing production dependencies from package-lock.json');
// npm ci requires package.json to match the lockfile, so the full package.json is used here and
// reduced to its runtime fields afterwards.
copyIntoStage('package-lock.json');
writeFileSync(path.join(STAGE_DIR, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
runNpm(['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], STAGE_DIR);

const runtimePackage = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  license: pkg.license,
  type: pkg.type,
  main: pkg.main,
  engines: pkg.engines,
  dependencies: pkg.dependencies,
};
writeFileSync(path.join(STAGE_DIR, 'package.json'), `${JSON.stringify(runtimePackage, null, 2)}\n`);
rmSync(path.join(STAGE_DIR, 'package-lock.json'), { force: true });

step('Validating the manifest');
if (!validateManifest(path.join(STAGE_DIR, 'manifest.json'))) {
  fail('manifest.json is not a valid MCPB manifest (see the errors above).');
}

step('Packing the extension with @anthropic-ai/mcpb');
const packed = await packExtension({
  extensionPath: STAGE_DIR,
  outputPath: BUNDLE_OUTPUT,
  silent: true,
});
if (!packed || !existsSync(BUNDLE_OUTPUT)) fail('mcpb pack failed.');

console.log(`\nCreated ${path.relative(ROOT, BUNDLE_OUTPUT)}`);
console.log(`  version: ${manifest.version}`);
console.log(`  size:    ${formatBytes(statSync(BUNDLE_OUTPUT).size)}`);
console.log(`  sha256:  ${sha256(BUNDLE_OUTPUT)}`);
console.log('\nNext: npm run package:check');
