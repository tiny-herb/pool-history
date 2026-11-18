import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function request(server, requestPath) {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return new Promise((resolve, reject) => {
    const req = http.get({
      host: '127.0.0.1',
      port,
      path: requestPath,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString(),
      }));
    });
    req.on('error', reject);
  });
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test('serves files, folders, content types, and cache headers', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'serve-test-'));

  await fs.mkdir(path.join(dir, 'nested'));
  await fs.writeFile(path.join(dir, 'index.html'), '<h1>home</h1>');
  await fs.writeFile(path.join(dir, 'nested', 'index.html'), '<h1>nested</h1>');
  await fs.writeFile(path.join(dir, 'data.json'), '{"ok":true}');
  await fs.writeFile(path.join(dir, 'style.css'), 'body{}');
  await fs.writeFile(path.join(dir, 'image.svg'), '<svg></svg>');
  await fs.writeFile(path.join(dir, 'app.js'), 'console.log(1)');
  await fs.writeFile(path.join(dir, 'readme.txt'), 'hello');
  await fs.writeFile(path.join(dir, 'archive.bin'), Buffer.from([0, 1, 2, 3]));
  await fs.writeFile(path.join(dir, 'secret.txt'), 'secret');

  const { serve } = await import('../src/serve.mjs');
  const server = await serve({ dir, port: 0, host: '127.0.0.1' });

  try {
    const cases = [
      ['/', 200, 'text/html; charset=utf-8', '<h1>home</h1>'],
      ['/index.html', 200, 'text/html; charset=utf-8', '<h1>home</h1>'],
      ['/nested/', 200, 'text/html; charset=utf-8', '<h1>nested</h1>'],
      ['/nested', 200, 'text/html; charset=utf-8', '<h1>nested</h1>'],
      ['/data.json', 200, 'application/json; charset=utf-8', '{"ok":true}'],
      ['/style.css', 200, 'text/css; charset=utf-8', 'body{}'],
      ['/image.svg', 200, 'image/svg+xml', '<svg></svg>'],
      ['/app.js', 200, 'text/javascript; charset=utf-8', 'console.log(1)'],
      ['/readme.txt', 200, 'text/plain; charset=utf-8', 'hello'],
      ['/archive.bin', 200, 'application/octet-stream', '\u0000\u0001\u0002\u0003'],
    ];

    for (const [requestPath, status, contentType, body] of cases) {
      const response = await request(server, requestPath);
      assert.equal(response.status, status, requestPath);
      assert.equal(response.headers['content-type'], contentType, requestPath);
      assert.equal(response.headers['cache-control'], 'no-store', requestPath);
      assert.equal(response.body, body, requestPath);
    }
  } finally {
    await close(server);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('returns 404 for missing and outside-site paths', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'serve-test-'));
  await fs.writeFile(path.join(dir, 'index.html'), 'home');

  const outside = path.join(path.dirname(dir), 'serve-outside-secret.txt');
  await fs.writeFile(outside, 'outside');

  const { serve } = await import('../src/serve.mjs');
  const server = await serve({ dir, port: 0, host: '127.0.0.1' });

  try {
    for (const requestPath of [
      '/missing.html',
      '/does-not-exist/',
      '/%2e%2e/serve-outside-secret.txt',
      '/..%2Fserve-outside-secret.txt',
    ]) {
      const response = await request(server, requestPath);
      assert.equal(response.status, 404, requestPath);
      assert.equal(response.body, 'not found', requestPath);
      assert.equal(response.headers['cache-control'], 'no-store', requestPath);
    }
  } finally {
    await close(server);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(outside, { force: true });
  }
});
