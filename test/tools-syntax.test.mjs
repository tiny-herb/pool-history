import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkSyntax } from '../tools/syntax.mjs';

const tool = fileURLToPath(new URL('../tools/syntax.mjs', import.meta.url));

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function write(root, file, content) {
  const full = path.join(root, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

test('checks supported files and reports failures', () => {
  const root = tempRoot('syntax');
  write(root, 'src/a.mjs', 'export const a = 1;\n');
  write(root, 'tools/b.mjs', 'const = ;\n');
  write(root, 'scripts/c.js', 'const c = 1;\n');

  const result = checkSyntax(root);
  assert.deepEqual(result.checked, ['scripts/c.js', 'src/a.mjs', 'tools/b.mjs']);
  assert.deepEqual(result.failed.map(({ file }) => file), ['tools/b.mjs']);
});

test('CLI returns failure and summary', () => {
  const root = tempRoot('syntax-cli');
  write(root, 'src/a.mjs', 'export const a = 1;\n');
  write(root, 'tools/b.mjs', 'const = ;\n');
  write(root, 'scripts/c.js', 'const c = 1;\n');

  const result = spawnSync(process.execPath, [tool, '--root', root], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout.trim().split(/\r?\n/).at(-1), 'syntax: 3 files checked, 1 failed');
});

test('CLI succeeds when all files are valid', () => {
  const root = tempRoot('syntax-good');
  write(root, 'src/a.mjs', 'export const a = 1;\n');

  const result = spawnSync(process.execPath, [tool, '--root', root], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'syntax: 1 files checked, 0 failed');
});

test('package metadata and scripts match the contract', () => {
  const packageFile = new URL('../package.json', import.meta.url);
  const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  const names = ['snapshot', 'build', 'diff', 'serve', 'watch', 'post', 'seeds', 'test', 'check'];

  assert.equal(packageJson.type, 'module');
  assert.equal(packageJson.engines.node, '>=24');
  assert.equal(packageJson.dependencies, undefined);
  assert.deepEqual(Object.keys(packageJson.scripts), names);
  assert.equal(packageJson.scripts.test, 'node --test');
  assert.match(packageJson.scripts.watch, /--env-file-if-exists=\.env/);
  assert.match(packageJson.scripts.post, /--env-file-if-exists=\.env/);
  for (const [name, command] of Object.entries(packageJson.scripts)) {
    if (name !== 'watch' && name !== 'post') assert.doesNotMatch(command, /\.env/);
  }
});
