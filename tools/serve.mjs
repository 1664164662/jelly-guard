#!/usr/bin/env node
/**
 * 零依赖静态服务器。用于本地预览和 CDP 冒烟测试。
 * 用法：node tools/serve.mjs [--port 4173]
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const PORT = Number(portIndex >= 0 ? args[portIndex + 1] : process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function send(response, status, body, type = 'text/plain; charset=utf-8') {
  response.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Access-Control-Allow-Origin': '*',
  });
  response.end(body);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const target = path.resolve(ROOT, `.${pathname}`);
    if (!target.startsWith(ROOT + path.sep) && target !== ROOT) {
      send(response, 403, 'Forbidden');
      return;
    }
    let stat;
    try {
      stat = await fs.stat(target);
    } catch (_) {
      send(response, 404, `Not found: ${pathname}`);
      return;
    }
    if (stat.isDirectory()) {
      const index = path.join(target, 'index.html');
      const body = await fs.readFile(index);
      send(response, 200, body, MIME['.html']);
      return;
    }
    const body = await fs.readFile(target);
    const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
    send(response, 200, body, type);
  } catch (error) {
    send(response, 500, `Server error: ${error.message}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Jelly Guard preview: http://${HOST}:${PORT}/`);
  console.log(`Playable:            http://${HOST}:${PORT}/play/?debug=1`);
  console.log(`Portfolio:           http://${HOST}:${PORT}/`);
});
