import crypto from 'node:crypto';
import { once } from 'node:events';

const maxTransferBytes = 64 * 1024 * 1024;
const downloadChunk = crypto.randomBytes(64 * 1024);

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload), 'Cache-Control': 'no-store' });
  res.end(payload);
}

function parseTransferSize(value) {
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 1024 || size > maxTransferBytes) {
    throw Object.assign(new Error('单次测速数据必须在 1 KB 到 64 MB 之间'), { status: 400 });
  }
  return size;
}

async function download(res, size) {
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': size, 'Cache-Control': 'no-store, no-transform', 'Content-Encoding': 'identity', 'X-Content-Type-Options': 'nosniff' });
  let remaining = size;
  while (remaining > 0 && !res.destroyed) {
    const chunk = remaining >= downloadChunk.length ? downloadChunk : downloadChunk.subarray(0, remaining);
    remaining -= chunk.length;
    if (!res.write(chunk)) await once(res, 'drain');
  }
  if (!res.destroyed) res.end();
}

async function upload(req, res) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxTransferBytes) throw Object.assign(new Error('单次上传测速不能超过 64 MB'), { status: 413 });
  let received = 0;
  for await (const chunk of req) {
    received += chunk.length;
    if (received > maxTransferBytes) throw Object.assign(new Error('单次上传测速不能超过 64 MB'), { status: 413 });
  }
  if (received < 1024) throw Object.assign(new Error('上传测速数据不能少于 1 KB'), { status: 400 });
  json(res, 200, { received });
}

export async function handleSpeedTest(req, res, url) {
  if (url.pathname === '/api/modules/speed-test/download' && req.method === 'GET') {
    await download(res, parseTransferSize(url.searchParams.get('bytes')));
    return true;
  }
  if (url.pathname === '/api/modules/speed-test/upload' && req.method === 'POST') {
    await upload(req, res);
    return true;
  }
  return false;
}
