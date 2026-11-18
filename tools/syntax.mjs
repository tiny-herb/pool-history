import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const usage = 'Usage: node tools/syntax.mjs [--root <dir>]';

function filesUnder(root, folder, result) {
  const directory = path.join(root, folder);
  if (!fs.existsSync(directory)) return;

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) filesUnder(full, path.join(folder, entry.name), result);
    else if (entry.isFile() && /\.(m?js)$/.test(entry.name)) result.push(full);
  }
}

export function checkSyntax(root) {
  const files = [];
  filesUnder(root, 'src', files);
  filesUnder(root, 'scripts', files);
  filesUnder(root, 'tools', files);

  const product = path.join(root, 'pool-history.mjs');
  if (fs.existsSync(product)) files.push(product);

  files.sort((a, b) => a.localeCompare(b));
  const checked = files.map((file) =>
    path.relative(root, file).split(path.sep).join('/'),
  );
  const failed = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const result = spawnSync(process.execPath, ['--check', file], {
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      failed.push({
        file: checked[index],
        message: result.error?.message || result.stderr || 'syntax check failed',
      });
    }
  }

  return { checked, failed };
}

export function main(args = process.argv.slice(2), io = console) {
  let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  if (args.length === 2 && args[0] === '--root' && args[1]) {
    root = path.resolve(args[1]);
  } else if (args.length !== 0) {
    io.error(usage);
    return 2;
  }

  const result = checkSyntax(root);
  for (const failure of result.failed) {
    io.error(`FAIL ${failure.file}`);
    for (const line of failure.message.trimEnd().split(/\r?\n/).slice(0, 5)) {
      io.error(line);
    }
  }
  io.log(`syntax: ${result.checked.length} files checked, ${result.failed.length} failed`);
  return result.failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
