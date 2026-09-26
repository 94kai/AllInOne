import http from 'node:http';
import { readFile, readdir, stat, lstat, realpath, mkdir, writeFile, rename, rm, statfs, link, unlink } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { handleSpeedTest } from './modules/speed-test/index.mjs';
import { XiaoAiMusicModule } from './modules/xiaoai-music/index.mjs';
import { XiaoAiAssistantModule } from './modules/xiaoai-assistant/index.mjs';
import { MusicDownloadModule } from './modules/music-download/index.mjs';
import { ChecklistModule } from './modules/checklist/index.mjs';
import { TerminalModule } from './modules/terminal/index.mjs';
import { BeijingPassModule } from './modules/beijing-pass/index.mjs';
import { ShellCrashModule } from './modules/shellcrash/index.mjs';
import { BillManagerModule } from './modules/bill-manager/index.mjs';

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(projectDir, 'public');
const dataDir = path.join(projectDir, 'data');

// 仅在变量尚未由运行环境设置时读取项目根目录 .env。
try {
  const envContent = await readFile(path.join(projectDir, '.env'), 'utf8');
  for (const line of envContent.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
} catch (cause) {
  if (cause.code !== 'ENOENT') throw cause;
}

const bookmarkFile = path.join(dataDir, 'bookmarks.json');
const favoriteFile = path.join(dataDir, 'favorites.json');
const port = Number(process.env.PORT || 2006);
const host = process.env.HOST || '0.0.0.0';
const textPreviewLimit = Math.max(1024, Number(process.env.TEXT_PREVIEW_LIMIT || 524288));
const configuredFileUploadLimit = Number(process.env.FILE_UPLOAD_LIMIT || 10 * 1024 * 1024 * 1024);
const fileUploadLimit = Number.isFinite(configuredFileUploadLimit) ? Math.max(1024, configuredFileUploadLimit) : 10 * 1024 * 1024 * 1024;
const previewOrigins = new Set((process.env.PREVIEW_ORIGINS || 'https://devstudio.xuekai.top:8888')
  .split(',').map(value => value.trim()).filter(Boolean));
const accessToken = process.env.DEVSTUDIO_TOKEN?.trim() || '';
const authCookieName = 'allinone_auth';
const authCookieValue = accessToken ? crypto.createHash('sha256').update(accessToken).digest('hex') : '';
const execFileAsync = promisify(execFile);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.wav': 'audio/wav',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime'
};

const textExtensions = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonc', '.json5', '.ndjson', '.yaml', '.yml', '.toml', '.xml', '.csv', '.tsv',
  '.log', '.ini', '.conf', '.cfg', '.properties', '.env', '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.py', '.pyw', '.rb', '.php', '.java', '.kt', '.kts',
  '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.cs', '.go', '.rs', '.swift', '.dart', '.lua', '.pl', '.r', '.sql',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd', '.graphql', '.gql', '.proto', '.diff', '.patch', '.srt', '.vtt'
]);
const textFileNames = new Set([
  'dockerfile', 'composefile', 'makefile', 'rakefile', 'gemfile', 'procfile', 'license', 'readme', 'changelog',
  '.env', '.gitignore', '.gitattributes', '.gitmodules', '.editorconfig', '.npmrc', '.yarnrc', '.dockerignore',
  '.prettierignore', '.eslintignore', '.stylelintignore', 'hosts', 'crontab'
]);

const defaultBookmarks = [
  { id: 'allinone', title: 'All in One', url: 'http://127.0.0.1:2006/', description: '当前控制台', color: '#5b8def' },
  { id: 'router', title: '路由器', url: 'http://192.168.1.1/', description: '局域网管理入口', color: '#8b6ee8' }
];

function parseRoots() {
  const raw = process.env.FILE_ROOTS?.trim();
  const values = raw ? raw.split(',') : [`Home:${os.homedir()}`];
  return values.map((item, index) => {
    const separator = item.indexOf(':');
    const label = separator > 0 ? item.slice(0, separator).trim() : `目录 ${index + 1}`;
    const rootPath = path.resolve(separator > 0 ? item.slice(separator + 1).trim() : item.trim());
    return { id: crypto.createHash('sha1').update(rootPath).digest('hex').slice(0, 10), label, path: rootPath };
  });
}

const roots = parseRoots();
const xiaoAiMusic = new XiaoAiMusicModule({ projectDir, dataDir });
const xiaoAiAssistant = new XiaoAiAssistantModule({ dataDir, xiaoAiMusic });
const musicDownload = new MusicDownloadModule({ projectDir, dataDir, fileRoots: roots });
const checklist = new ChecklistModule({ dataDir });
const beijingPass = new BeijingPassModule({ dataDir });
const shellCrash = new ShellCrashModule({ dataDir });
const billManager = new BillManagerModule({ dataDir });

function isAllowedWebSocketOrigin(req) {
  const origin = String(req.headers.origin || '');
  if (!origin) return false;
  try {
    const originUrl = new URL(origin);
    const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    return originUrl.host === forwardedHost || previewOrigins.has(originUrl.origin);
  } catch { return false; }
}

const terminal = new TerminalModule({ roots, isAuthenticated, isAllowedOrigin: isAllowedWebSocketOrigin });

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload), 'Cache-Control': 'no-store' });
  res.end(payload);
}

function error(res, status, message) {
  json(res, status, { error: message });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function safeRedirect(value, fallback = '/') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback;
  try {
    const target = new URL(value, 'http://localhost');
    return target.origin === 'http://localhost' ? `${target.pathname}${target.search}${target.hash}` : fallback;
  } catch { return fallback; }
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(item => {
    const separator = item.indexOf('=');
    if (separator < 0) return ['', ''];
    return [item.slice(0, separator).trim(), item.slice(separator + 1).trim()];
  }).filter(([name]) => name));
}

function tokenMatches(value, hashed = false) {
  if (!accessToken || !value) return false;
  const candidate = hashed ? value : crypto.createHash('sha256').update(value).digest('hex');
  const actual = Buffer.from(candidate);
  const expected = Buffer.from(authCookieValue);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function isAuthenticated(req, url) {
  if (!accessToken) return true;
  if (tokenMatches(parseCookies(req)[authCookieName], true)) return true;
  const bearer = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1];
  return tokenMatches(bearer) || tokenMatches(url.searchParams.get('token'));
}

function isSecureRequest(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return Boolean(req.socket.encrypted) || forwardedProto === 'https';
}

function authCookie(req) {
  return `${authCookieName}=${authCookieValue}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 24 * 60 * 60}${isSecureRequest(req) ? '; Secure' : ''}`;
}

function clearedAuthCookie(req) {
  return `${authCookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${isSecureRequest(req) ? '; Secure' : ''}`;
}

function loginPage(res, { status = 200, next = '/', message = '' } = {}) {
  const safeNext = safeRedirect(next);
  const body = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>登录 Allinone</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:#f3f5f8;color:#172033;font:16px/1.5 system-ui,-apple-system,sans-serif}.card{width:min(100%,420px);padding:32px;border:1px solid #dfe4ec;border-radius:20px;background:#fff;box-shadow:0 18px 50px #26334d18}h1{margin:0 0 8px;font-size:26px}p{margin:0 0 24px;color:#687386}.error{padding:11px 13px;border-radius:10px;background:#fff0f0;color:#b42318}label{display:block;margin-bottom:8px;font-weight:650}input{width:100%;min-height:48px;padding:11px 13px;border:1px solid #cbd3df;border-radius:11px;font:inherit}input:focus{outline:3px solid #5b8def30;border-color:#5b8def}button{width:100%;min-height:48px;margin-top:16px;border:0;border-radius:11px;background:#315fce;color:#fff;font:700 16px inherit;cursor:pointer}@media(max-width:520px){body{padding:16px}.card{padding:24px 20px;border-radius:16px}}
</style></head><body><main class="card"><h1>Allinone</h1><p>请输入访问令牌继续。</p>${message ? `<p class="error">${escapeHtml(message)}</p>` : ''}<form method="post" action="/login"><input type="hidden" name="next" value="${escapeHtml(safeNext)}"><label for="token">访问令牌</label><input id="token" name="token" type="password" autocomplete="current-password" required autofocus><button type="submit">登录</button></form></main></body></html>`;
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}

async function readForm(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024) throw Object.assign(new Error('请求内容过大'), { status: 413 });
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function allowPreviewRequest(req, res) {
  const origin = req.headers.origin;
  if (!origin || !req.headers.host) return false;
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(`http://${req.headers.host}`);
    const isLocalPreview = originUrl.port === '8787' && originUrl.hostname === requestUrl.hostname;
    if (!isLocalPreview && !previewOrigins.has(originUrl.origin)) return false;
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Vary', 'Origin');
    return true;
  } catch {
    return false;
  }
}

async function resolveSafePath(rootId, relativePath = '') {
  const root = roots.find(item => item.id === rootId);
  if (!root) throw Object.assign(new Error('目录入口不存在'), { status: 404 });
  const base = await realpath(root.path);
  const target = path.resolve(base, relativePath.replace(/^[/\\]+/, ''));
  const resolved = await realpath(target);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw Object.assign(new Error('目标路径超出允许范围'), { status: 403 });
  }
  return { root, base, target: resolved, relative: path.relative(base, resolved).split(path.sep).join('/') };
}

async function resolveSafeDeletePath(rootId, relativePath = '') {
  const root = roots.find(item => item.id === rootId);
  if (!root) throw Object.assign(new Error('目录入口不存在'), { status: 404 });
  const base = await realpath(root.path);
  const requested = String(relativePath || '').replace(/^[/\\]+/, '');
  if (!requested) throw Object.assign(new Error('不能删除文件入口根目录'), { status: 400 });
  const lexicalTarget = path.resolve(base, requested);
  if (!lexicalTarget.startsWith(`${base}${path.sep}`)) throw Object.assign(new Error('目标路径超出允许范围'), { status: 403 });
  const parent = await realpath(path.dirname(lexicalTarget));
  if (parent !== base && !parent.startsWith(`${base}${path.sep}`)) throw Object.assign(new Error('目标路径超出允许范围'), { status: 403 });
  const target = path.join(parent, path.basename(lexicalTarget));
  const info = await lstat(target).catch(cause => {
    if (cause.code === 'ENOENT') throw Object.assign(new Error('文件或目录不存在'), { status: 404 });
    throw cause;
  });
  return { root, base, target, info, relative: path.relative(base, target).split(path.sep).join('/') };
}

function validateFileEntryName(value) {
  const name = String(value || '').normalize('NFC');
  if (!name || name === '.' || name === '..' || name !== path.basename(name) || /[\\/\0-\x1f\x7f]/.test(name)) {
    throw Object.assign(new Error('文件名不合法'), { status: 400 });
  }
  if (Buffer.byteLength(name) > 255) throw Object.assign(new Error('文件名过长'), { status: 400 });
  return name;
}

async function receiveUpload(req, directory, fileName) {
  const declaredSize = Number(req.headers['content-length']);
  if (Number.isFinite(declaredSize) && declaredSize > fileUploadLimit) {
    throw Object.assign(new Error(`文件超过上传上限（${Math.round(fileUploadLimit / 1024 / 1024)} MB）`), { status: 413 });
  }
  const target = path.join(directory.target, fileName);
  if (await lstat(target).then(() => true, cause => cause.code === 'ENOENT' ? false : Promise.reject(cause))) {
    throw Object.assign(new Error('当前目录已存在同名文件'), { status: 409 });
  }
  const temporary = path.join(directory.target, `.${fileName}.upload-${crypto.randomUUID()}`);
  let received = 0;
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      received += chunk.length;
      if (received > fileUploadLimit) callback(Object.assign(new Error(`文件超过上传上限（${Math.round(fileUploadLimit / 1024 / 1024)} MB）`), { status: 413 }));
      else callback(null, chunk);
    }
  });
  try {
    await pipeline(req, limiter, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    await link(temporary, target).catch(cause => {
      if (cause.code === 'EEXIST') throw Object.assign(new Error('当前目录已存在同名文件'), { status: 409 });
      throw cause;
    });
    await unlink(temporary).catch(() => {});
    return { name: fileName, path: [directory.relative, fileName].filter(Boolean).join('/'), size: received };
  } catch (cause) {
    await rm(temporary, { force: true }).catch(() => {});
    if (cause.code === 'ENOSPC') throw Object.assign(new Error('目标磁盘空间不足'), { status: 507 });
    if (['EACCES', 'EPERM', 'EROFS'].includes(cause.code)) throw Object.assign(new Error('当前目录没有写入权限'), { status: 403 });
    if (cause.code === 'EMLINK' || cause.code === 'ENOTSUP') throw Object.assign(new Error('目标文件系统不支持安全上传'), { status: 500 });
    throw cause;
  }
}

function classify(name, isDirectory) {
  if (isDirectory) return 'folder';
  const ext = path.extname(name).toLowerCase();
  const mime = mimeTypes[ext] || 'application/octet-stream';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('text/') || textExtensions.has(ext) || textFileNames.has(name.toLowerCase())) return 'text';
  if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) return 'archive';
  return 'file';
}

async function readBookmarks() {
  try {
    const data = JSON.parse(await readFile(bookmarkFile, 'utf8'));
    return Array.isArray(data) ? data : defaultBookmarks;
  } catch {
    return defaultBookmarks;
  }
}

async function saveBookmarks(items) {
  await mkdir(dataDir, { recursive: true });
  const temporary = `${bookmarkFile}.tmp`;
  await writeFile(temporary, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
  await rename(temporary, bookmarkFile);
}

async function readFavorites() {
  try {
    const data = JSON.parse(await readFile(favoriteFile, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function saveFavorites(items) {
  await mkdir(dataDir, { recursive: true });
  const temporary = `${favoriteFile}.tmp`;
  await writeFile(temporary, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
  await rename(temporary, favoriteFile);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw Object.assign(new Error('请求内容过大'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('请求内容不是有效 JSON'), { status: 400 }); }
}

function validateBookmark(input, existingId) {
  const title = String(input.title || '').trim().slice(0, 40);
  let url;
  try { url = new URL(String(input.url || '').trim()); } catch { throw Object.assign(new Error('请输入有效地址'), { status: 400 }); }
  if (!['http:', 'https:'].includes(url.protocol)) throw Object.assign(new Error('地址仅支持 HTTP 或 HTTPS'), { status: 400 });
  if (!title) throw Object.assign(new Error('名称不能为空'), { status: 400 });
  let iconUrl = '';
  if (String(input.iconUrl || '').trim()) {
    const rawIcon = String(input.iconUrl).trim();
    if (rawIcon.startsWith('/') && !rawIcon.startsWith('//')) iconUrl = rawIcon.slice(0, 1000);
    else {
      try {
        const parsedIcon = new URL(rawIcon);
        if (!['http:', 'https:'].includes(parsedIcon.protocol)) throw new Error();
        iconUrl = parsedIcon.href.slice(0, 1000);
      } catch { throw Object.assign(new Error('图标地址仅支持站内路径或有效的 HTTP/HTTPS URL'), { status: 400 }); }
    }
  }
  return {
    id: existingId || crypto.randomUUID(), title, url: url.href,
    description: String(input.description || '').trim().slice(0, 80),
    notes: String(input.notes || '').trim().slice(0, 2000),
    iconUrl,
    color: /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : '#5b8def'
  };
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function cpuTimes() {
  return os.cpus().reduce((total, cpu) => {
    const times = cpu.times;
    total.idle += times.idle;
    total.all += times.user + times.nice + times.sys + times.idle + times.irq;
    return total;
  }, { idle: 0, all: 0 });
}

async function memorySnapshot() {
  const fallbackTotal = os.totalmem();
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('memory_pressure', ['-Q'], { timeout: 1500, maxBuffer: 64 * 1024 });
      const match = stdout.match(/free percentage:\s*(\d+)%/i);
      if (match) {
        const availableRatio = Number(match[1]) / 100;
        return { total: fallbackTotal, used: Math.round(fallbackTotal * (1 - availableRatio)), available: Math.round(fallbackTotal * availableRatio), source: 'pressure' };
      }
    } catch {
      // 系统命令不可用时回退到 Node.js 通用口径
    }
  }
  if (process.platform === 'linux') {
    try {
      const content = await readFile('/proc/meminfo', 'utf8');
      const total = Number(content.match(/^MemTotal:\s+(\d+)/m)?.[1]) * 1024;
      const available = Number(content.match(/^MemAvailable:\s+(\d+)/m)?.[1]) * 1024;
      if (Number.isFinite(total) && Number.isFinite(available)) return { total, used: total - available, available, source: 'available' };
    } catch {
      // 非标准 Linux 环境回退到 Node.js 通用口径
    }
  }
  const available = os.freemem();
  return { total: fallbackTotal, used: fallbackTotal - available, available, source: 'free' };
}

async function systemSnapshot() {
  const before = cpuTimes();
  await wait(180);
  const after = cpuTimes();
  const delta = after.all - before.all;
  const cpu = delta > 0 ? Math.max(0, Math.min(100, (1 - (after.idle - before.idle) / delta) * 100)) : 0;
  const sensors = await temperatureSnapshot();
  const [memory, disks] = await Promise.all([memorySnapshot(), diskSnapshots(sensors)]);
  return { cpu: Number(cpu.toFixed(1)), cpuTemperature: sensors.cpu, cores: os.cpus().length, memory, disks, uptime: os.uptime(), hostname: os.hostname(), platform: os.platform() };
}

async function temperatureSnapshot() {
  const result = { cpu: null, nvme: null };
  if (process.platform !== 'linux') return result;
  try {
    const { stdout } = await execFileAsync('sensors', ['-j'], { timeout: 1500, maxBuffer: 256 * 1024 });
    const sensors = JSON.parse(stdout);
    const cpu = Object.entries(sensors).find(([name]) => name.startsWith('coretemp'))?.[1];
    const cpuValue = cpu?.['Package id 0']?.temp1_input;
    const nvme = Object.entries(sensors).find(([name]) => name.startsWith('nvme-'))?.[1];
    const nvmeValue = nvme?.Composite?.temp1_input;
    if (Number.isFinite(cpuValue)) result.cpu = Number(cpuValue.toFixed(1));
    if (Number.isFinite(nvmeValue)) result.nvme = Number(nvmeValue.toFixed(1));
  } catch {
    // 温度传感器不可用时保持 null，不伪造数据。
  }
  return result;
}

async function smartTemperature(devicePath) {
  try {
    const smartctlPath = process.env.SMARTCTL_PATH || '/usr/sbin/smartctl';
    const { stdout } = await execFileAsync(smartctlPath, ['-A', '-j', devicePath], { timeout: 2500, maxBuffer: 512 * 1024 });
    const data = JSON.parse(stdout);
    const direct = data.temperature?.current;
    if (Number.isFinite(direct)) return direct;
    const attribute = data.ata_smart_attributes?.table?.find(item => [190, 194].includes(item.id));
    return Number.isFinite(attribute?.raw?.value) ? attribute.raw.value : null;
  } catch { return null; }
}

async function diskSnapshots(sensors = {}) {
  if (process.platform === 'linux') {
    try {
      const [{ stdout: dfOutput }, { stdout: blockOutput }] = await Promise.all([
        execFileAsync('df', ['-B1', '--output=source,target,size,used,avail,fstype'], { timeout: 2000, maxBuffer: 512 * 1024 }),
        execFileAsync('lsblk', ['-J', '-b', '-o', 'NAME,PATH,TYPE,SIZE,MOUNTPOINTS,MODEL,TRAN,HOTPLUG'], { timeout: 2000, maxBuffer: 1024 * 1024 })
      ]);
      const mounted = dfOutput.trim().split('\n').slice(1).map(line => {
        const fields = line.trim().split(/\s+/);
        if (fields.length < 6) return null;
        const [source, target, total, used, free, fsType] = fields;
        return { source, target, total: Number(total), used: Number(used), free: Number(free), fsType };
      }).filter(Boolean);
      const usageByTarget = new Map(mounted.map(item => [item.target, item]));
      const collectMounts = device => [...(device.mountpoints || []), ...(device.children || []).flatMap(collectMounts)]
        .filter(target => target && target !== '/boot' && !target.startsWith('/boot/'));
      const physical = await Promise.all(JSON.parse(blockOutput).blockdevices.filter(device => device.type === 'disk').map(async device => {
        const mounts = [...new Set(collectMounts(device))];
        const usage = mounts.map(target => usageByTarget.get(target)).filter(Boolean);
        const used = usage.reduce((sum, item) => sum + item.used, 0);
        const free = usage.reduce((sum, item) => sum + item.free, 0);
        const external = device.tran === 'usb' || Number(device.hotplug) === 1;
        const temperature = device.tran === 'nvme' ? sensors.nvme : await smartTemperature(device.path);
        return {
          source: device.path, target: mounts.join(' · '), mounts, model: String(device.model || '').trim() || device.name,
          transport: device.tran || '', external, label: external ? '外置硬盘' : '内置硬盘',
          total: Number(device.size), used, free, temperature
        };
      }));
      const availablePhysical = physical.filter(disk => disk.mounts.length && Number.isFinite(disk.total) && disk.total > 0);
      availablePhysical.sort((a, b) => Number(a.external) - Number(b.external) || b.total - a.total);
      if (availablePhysical.length) return availablePhysical;
    } catch {
      // df 不可用时回退到文件入口所在的文件系统。
    }
  }
  const snapshots = await Promise.all(roots.map(async root => {
    try {
      const info = await statfs(root.path);
      const total = info.blocks * info.bsize;
      const free = info.bavail * info.bsize;
      return { source: root.id, target: root.path, label: root.label, total, free, used: total - free };
    } catch { return null; }
  }));
  return [...new Map(snapshots.filter(Boolean).map(disk => [`${disk.total}:${disk.free}`, disk])).values()];
}

async function serveFile(req, res, target, mime, downloadName) {
  const info = await stat(target);
  if (!info.isFile()) return error(res, 400, '目标不是文件');
  const range = req.headers.range;
  const headers = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': res.getHeader('Cache-Control') || 'private, max-age=60' };
  if (downloadName) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (!match) return error(res, 416, '无效的文件范围');
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size) return error(res, 416, '文件范围超出边界');
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Content-Length': end - start + 1 });
    createReadStream(target, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': info.size });
    createReadStream(target).pipe(res);
  }
}

async function apiHandler(req, res, url) {
  // 兼容反向代理或开发工具自动补充的尾部斜杠
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  if (await handleSpeedTest(req, res, url)) return;
  if (await xiaoAiMusic.handle(req, res, url)) return;
  if (await xiaoAiAssistant.handle(req, res, url)) return;
  if (await musicDownload.handle(req, res, url)) return;
  if (await checklist.handle(req, res, url)) return;
  if (await beijingPass.handle(req, res, url)) return;
  if (await shellCrash.handle(req, res, url)) return;
  if (await billManager.handle(req, res, url)) return;
  if (await terminal.handle(req, res, url)) return;
  if (url.pathname === '/api/config' && req.method === 'GET') {
    return json(res, 200, { roots: roots.map(({ id, label }) => ({ id, label })) });
  }
  if (url.pathname === '/api/files' && req.method === 'GET') {
    const current = await resolveSafePath(url.searchParams.get('root'), url.searchParams.get('path') || '');
    const currentStat = await stat(current.target);
    if (!currentStat.isDirectory()) throw Object.assign(new Error('目标不是目录'), { status: 400 });
    const allEntries = await readdir(current.target, { withFileTypes: true });
    const showHidden = url.searchParams.get('hidden') === '1';
    const hiddenCount = allEntries.filter(entry => entry.name.startsWith('.')).length;
    const entries = showHidden ? allEntries : allEntries.filter(entry => !entry.name.startsWith('.'));
    const files = await Promise.all(entries.slice(0, 5000).map(async entry => {
      try {
        const info = await stat(path.join(current.target, entry.name));
        return { name: entry.name, path: [current.relative, entry.name].filter(Boolean).join('/'), absolutePath: path.join(current.target, entry.name), type: classify(entry.name, info.isDirectory()), size: info.size, modified: info.mtime.toISOString() };
      } catch { return null; }
    }));
    files.sort((a, b) => (a?.type === 'folder' ? -1 : 1) - (b?.type === 'folder' ? -1 : 1) || a?.name.localeCompare(b?.name, 'zh-CN', { numeric: true }));
    return json(res, 200, { path: current.relative, absolutePath: current.target, truncated: entries.length > 5000, hiddenCount, entries: files.filter(Boolean) });
  }
  if (url.pathname === '/api/files/upload' && req.method === 'POST') {
    const directory = await resolveSafePath(url.searchParams.get('root'), url.searchParams.get('path') || '');
    if (!(await stat(directory.target)).isDirectory()) throw Object.assign(new Error('上传目标不是目录'), { status: 400 });
    const item = await receiveUpload(req, directory, validateFileEntryName(url.searchParams.get('name')));
    return json(res, 201, { item });
  }
  if (url.pathname === '/api/files/directory' && req.method === 'POST') {
    const input = await readBody(req);
    const directory = await resolveSafePath(String(input.root || ''), String(input.path || ''));
    if (!(await stat(directory.target)).isDirectory()) throw Object.assign(new Error('目标不是目录'), { status: 400 });
    const name = validateFileEntryName(String(input.name || '').trim());
    const target = path.join(directory.target, name);
    try { await mkdir(target, { recursive: false, mode: 0o755 }); }
    catch (cause) {
      if (cause.code === 'EEXIST') throw Object.assign(new Error('当前目录已存在同名项目'), { status: 409 });
      if (['EACCES', 'EPERM', 'EROFS'].includes(cause.code)) throw Object.assign(new Error('当前目录没有写入权限'), { status: 403 });
      throw cause;
    }
    return json(res, 201, { item: { name, path: [directory.relative, name].filter(Boolean).join('/'), type: 'folder' } });
  }
  if (url.pathname === '/api/file' && req.method === 'GET') {
    const file = await resolveSafePath(url.searchParams.get('root'), url.searchParams.get('path') || '');
    const ext = path.extname(file.target).toLowerCase();
    return serveFile(req, res, file.target, mimeTypes[ext] || 'application/octet-stream', url.searchParams.get('download') === '1' ? path.basename(file.target) : null);
  }
  if (url.pathname === '/api/file' && req.method === 'DELETE') {
    const target = await resolveSafeDeletePath(url.searchParams.get('root'), url.searchParams.get('path') || '');
    await rm(target.target, { recursive: target.info.isDirectory() });
    const favorites = await readFavorites();
    const prefix = `${target.relative}/`;
    const remaining = favorites.filter(item => item.root !== target.root.id || (item.path !== target.relative && !item.path.startsWith(prefix)));
    if (remaining.length !== favorites.length) await saveFavorites(remaining);
    return json(res, 200, { success: true });
  }
  if (url.pathname === '/api/text' && req.method === 'GET') {
    const file = await resolveSafePath(url.searchParams.get('root'), url.searchParams.get('path') || '');
    const info = await stat(file.target);
    if (info.size > textPreviewLimit) throw Object.assign(new Error(`文本超过预览上限（${Math.round(textPreviewLimit / 1024)} KB）`), { status: 413 });
    const content = await readFile(file.target);
    if (content.includes(0)) throw Object.assign(new Error('文件包含二进制数据，无法作为文本预览'), { status: 415 });
    try {
      return json(res, 200, { content: new TextDecoder('utf-8', { fatal: true }).decode(content) });
    } catch {
      throw Object.assign(new Error('文件不是有效的 UTF-8 文本'), { status: 415 });
    }
  }
  if (url.pathname === '/api/system' && req.method === 'GET') return json(res, 200, await systemSnapshot());
  if (url.pathname === '/api/favorites' && req.method === 'GET') {
    const items = (await readFavorites()).filter(item => roots.some(root => root.id === item.root));
    return json(res, 200, { items });
  }
  if (url.pathname === '/api/favorites' && req.method === 'POST') {
    const input = await readBody(req);
    const directory = await resolveSafePath(String(input.root || ''), String(input.path || ''));
    if (!(await stat(directory.target)).isDirectory()) throw Object.assign(new Error('只能收藏目录'), { status: 400 });
    const items = await readFavorites();
    const existing = items.find(item => item.root === directory.root.id && item.path === directory.relative);
    if (existing) return json(res, 200, { item: existing });
    const item = {
      id: crypto.randomUUID(), root: directory.root.id, path: directory.relative,
      title: directory.relative ? path.basename(directory.target) : directory.root.label
    };
    items.push(item); await saveFavorites(items); return json(res, 201, { item });
  }
  const favoriteMatch = url.pathname.match(/^\/api\/favorites\/([^/]+)$/);
  if (favoriteMatch && req.method === 'DELETE') {
    const items = await readFavorites();
    const id = decodeURIComponent(favoriteMatch[1]);
    const index = items.findIndex(item => item.id === id);
    if (index < 0) throw Object.assign(new Error('收藏目录不存在'), { status: 404 });
    items.splice(index, 1); await saveFavorites(items); return json(res, 200, { success: true });
  }
  if (url.pathname === '/api/bookmarks' && req.method === 'GET') return json(res, 200, { items: await readBookmarks() });
  if (url.pathname === '/api/bookmarks' && req.method === 'POST') {
    const items = await readBookmarks();
    const item = validateBookmark(await readBody(req));
    items.push(item); await saveBookmarks(items); return json(res, 201, { item });
  }
  if (url.pathname === '/api/bookmarks/order' && req.method === 'PUT') {
    const items = await readBookmarks();
    const input = await readBody(req);
    const ids = Array.isArray(input.ids) ? input.ids.map(String) : [];
    if (ids.length !== items.length || new Set(ids).size !== items.length || items.some(item => !ids.includes(item.id))) {
      throw Object.assign(new Error('导航排序数据与现有项目不一致'), { status: 400 });
    }
    const byId = new Map(items.map(item => [item.id, item]));
    const ordered = ids.map(id => byId.get(id));
    await saveBookmarks(ordered); return json(res, 200, { items: ordered });
  }
  const bookmarkMatch = url.pathname.match(/^\/api\/bookmarks\/([^/]+)$/);
  if (bookmarkMatch && ['PUT', 'DELETE'].includes(req.method)) {
    const items = await readBookmarks();
    const id = decodeURIComponent(bookmarkMatch[1]);
    const index = items.findIndex(item => item.id === id);
    if (index < 0) throw Object.assign(new Error('导航地址不存在'), { status: 404 });
    if (req.method === 'DELETE') { items.splice(index, 1); await saveBookmarks(items); return json(res, 200, { success: true }); }
    items[index] = validateBookmark(await readBody(req), id); await saveBookmarks(items); return json(res, 200, { item: items[index] });
  }
  console.warn(`未匹配接口：${req.method} ${url.pathname}`);
  error(res, 404, `接口不存在：${req.method} ${url.pathname}`);
}

async function requestHandler(req, res) {
  try {
    const previewAllowed = allowPreviewRequest(req, res);
    if (req.method === 'OPTIONS') {
      if (!previewAllowed) return error(res, 403, '不允许当前来源跨域访问');
      res.writeHead(204); return res.end();
    }
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/login') {
      if (!accessToken) {
        res.writeHead(303, { Location: '/' }); return res.end();
      }
      const next = safeRedirect(url.searchParams.get('next') || '/');
      if (req.method === 'GET') return loginPage(res, { next });
      if (req.method === 'POST') {
        const form = await readForm(req);
        const formNext = safeRedirect(form.get('next') || '/');
        if (!tokenMatches(form.get('token'))) return loginPage(res, { status: 401, next: formNext, message: '访问令牌不正确' });
        res.writeHead(303, { 'Set-Cookie': authCookie(req), Location: formNext, 'Cache-Control': 'no-store' });
        return res.end();
      }
      return error(res, 405, '请求方法不支持');
    }

    if (url.pathname === '/logout') {
      res.writeHead(303, { 'Set-Cookie': clearedAuthCookie(req), Location: '/login', 'Cache-Control': 'no-store' });
      return res.end();
    }

    if (!isAuthenticated(req, url)) {
      if (url.pathname.startsWith('/api/')) return error(res, 401, '未授权，请提供有效访问令牌');
      const next = safeRedirect(`${url.pathname}${url.search}`);
      res.writeHead(303, { Location: `/login?next=${encodeURIComponent(next)}`, 'Cache-Control': 'no-store' });
      return res.end();
    }

    // URL 令牌只用于必要的 iframe/预览兼容，验证后立即换成 Cookie 并从地址中移除。
    if (accessToken && url.searchParams.has('token') && !url.pathname.startsWith('/api/')) {
      url.searchParams.delete('token');
      const location = `${url.pathname}${url.search}${url.hash}`;
      res.writeHead(303, { 'Set-Cookie': authCookie(req), Location: safeRedirect(location), 'Cache-Control': 'no-store' });
      return res.end();
    }

    if (url.pathname.startsWith('/api/')) return await apiHandler(req, res, url);
    const terminalVendors = {
      '/vendor/xterm.js': ['@xterm', 'xterm', 'lib', 'xterm.js'],
      '/vendor/xterm.css': ['@xterm', 'xterm', 'css', 'xterm.css'],
      '/vendor/xterm-addon-fit.js': ['@xterm', 'addon-fit', 'lib', 'addon-fit.js'],
      '/vendor/xterm-addon-search.js': ['@xterm', 'addon-search', 'lib', 'addon-search.js'],
      '/vendor/xterm-addon-web-links.js': ['@xterm', 'addon-web-links', 'lib', 'addon-web-links.js']
    };
    if (terminalVendors[url.pathname]) {
      const target = path.join(projectDir, 'node_modules', ...terminalVendors[url.pathname]);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return serveFile(req, res, target, url.pathname.endsWith('.css') ? mimeTypes['.css'] : mimeTypes['.js']);
    }
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const target = path.resolve(publicDir, relative);
    if (target !== publicDir && !target.startsWith(`${publicDir}${path.sep}`)) return error(res, 403, '禁止访问');
    res.setHeader('Cache-Control', 'no-cache');
    await serveFile(req, res, target, mimeTypes[path.extname(target).toLowerCase()] || 'application/octet-stream');
  } catch (cause) {
    if (cause.code === 'ENOENT') return error(res, 404, '资源不存在');
    console.error(cause);
    error(res, cause.status || 500, cause.status ? cause.message : '服务器处理失败');
  }
}

await xiaoAiMusic.initialize();
await xiaoAiAssistant.initialize();
await musicDownload.initialize();
await checklist.initialize();
await beijingPass.initialize();
await shellCrash.initialize();
await billManager.initialize();
const httpServer = http.createServer(requestHandler).listen(port, host, () => {
  console.log(`Allinone 已启动：http://${host}:${port}`);
  console.log(`文件入口：${roots.map(root => `${root.label} → ${root.path}`).join('，')}`);
});
terminal.attach(httpServer);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  httpServer.close();
  terminal.shutdown();
  beijingPass.shutdown();
  shellCrash.shutdown();
  await xiaoAiMusic.shutdown();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
