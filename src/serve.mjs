import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.js': 'text/javascript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

export function serve({ dir, port = 8787, host = '127.0.0.1' }) {
  const root = path.resolve(dir);

  const server = http.createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');

    try {
      const requestUrl = new URL(req.url || '/', 'http://localhost');
      let pathname;

      try {
        pathname = decodeURIComponent(requestUrl.pathname);
      } catch {
        res.statusCode = 404;
        res.end('not found');
        return;
      }

      const target = path.resolve(root, `.${pathname}`);
      if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
        res.statusCode = 404;
        res.end('not found');
        return;
      }

      let file = target;
      let stat;

      try {
        stat = await fs.stat(file);
        if (stat.isDirectory()) file = path.join(file, 'index.html');
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
          res.statusCode = 404;
          res.end('not found');
          return;
        }
        throw error;
      }

      try {
        stat = await fs.stat(file);
        if (!stat.isFile()) {
          res.statusCode = 404;
          res.end('not found');
          return;
        }
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
          res.statusCode = 404;
          res.end('not found');
          return;
        }
        throw error;
      }

      res.setHeader(
        'content-type',
        TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      );
      res.statusCode = 200;
      res.end(await fs.readFile(file));
    } catch {
      res.statusCode = 500;
      res.end('error');
    }
  });

  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}
