/* Serve packaged analyzer assets inside Electron, retaining the existing
 * localhost storage origin without opening a port or depending on a server. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };
function create(root, origin) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'bundle.json'), 'utf8'));
  const files = new Set([...Object.keys(manifest.files), 'bundle.json']);
  async function handle(request) {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
    let name;
    try {
      const url = new URL(request.url);
      if (url.origin !== origin) return new Response(null, { status: 404 });
      name = decodeURIComponent(url.pathname).slice(1) || 'analyze.html';
    } catch { return new Response(null, { status: 400 }); }
    if (!files.has(name) || name.includes('\\') || name.split('/').includes('..')) return new Response(null, { status: 404 });
    try {
      const bytes = await fs.promises.readFile(path.join(root, name));
      return new Response(request.method === 'HEAD' ? null : bytes, { headers: {
        'Content-Type': TYPES[path.extname(name)] || 'application/octet-stream', 'Content-Length': String(bytes.length),
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      } });
    } catch { return new Response(null, { status: 404 }); }
  }
  return { manifest, handle };
}
module.exports = { create };
