import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, chmod, copyFile, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { promisify } from 'node:util';
import QRCode from 'qrcode';

const execFileAsync = promisify(execFile);
const apiPrefix = '/api/modules/music-download';
const mediaGetVersion = '0.2.14';
const audioExtensions = new Set(['.mp3', '.flac', '.m4a', '.aac', '.wav', '.ogg', '.ape', '.wma']);
const audioMimeTypes = { '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.ape': 'audio/ape', '.wma': 'audio/x-ms-wma' };
const sourceLabels = { migu: '咪咕音乐', netease: '网易云', qq: 'QQ 音乐', kugou: '酷狗音乐', kuwo: '酷我音乐', bilibili: 'Bilibili', douyin: '抖音', youtube: 'YouTube', qmkg: '全民 K 歌' };
const neteaseQualities = new Set(['standard', 'exhigh', 'lossless', 'hires', 'jyeffect', 'sky', 'jymaster']);
const neteaseEapiKey = Buffer.from('e82ckenh8dichen8');

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload), 'Cache-Control': 'no-store' });
  res.end(payload);
}

function httpError(message, status = 400) { return Object.assign(new Error(message), { status }); }

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw httpError('请求内容不能超过 64 KB', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw httpError('请求内容不是有效 JSON'); }
}

function cleanFilename(value, fallback = '未命名歌曲') {
  const cleaned = String(value || '').replace(/[/\\<>:"|?*\x00-\x1f]/g, '').replace(/^\.+|\.+$/g, '').trim();
  return (cleaned || fallback).slice(0, 180);
}

function isInside(base, target) { return target === base || target.startsWith(`${base}${path.sep}`); }

async function exists(target) {
  try { await access(target); return true; } catch { return false; }
}

async function uniquePath(directory, filename) {
  const extension = path.extname(filename);
  const stem = path.basename(filename, extension);
  let candidate = path.join(directory, filename);
  for (let index = 2; await exists(candidate); index += 1) candidate = path.join(directory, `${stem} (${index})${extension}`);
  return candidate;
}

function parseRoots(raw, fallbackRoots) {
  const configured = String(raw || '').split(',').map(value => value.trim()).filter(Boolean).map((value, index) => {
    const separator = value.indexOf(':');
    const label = separator > 0 ? value.slice(0, separator).trim() : `目录 ${index + 1}`;
    const directory = path.resolve(separator > 0 ? value.slice(separator + 1).trim() : value);
    return { id: crypto.createHash('sha1').update(directory).digest('hex').slice(0, 10), label, path: directory };
  });
  return configured.length ? configured : fallbackRoots;
}

export class MusicDownloadModule {
  constructor({ projectDir, dataDir, fileRoots }) {
    this.dataDir = path.join(dataDir, 'music-download');
    this.downloadDir = path.resolve(process.env.MUSIC_DOWNLOAD_DIR || path.join(this.dataDir, 'downloads'));
    this.binDir = path.join(this.dataDir, 'bin');
    this.catalogFile = path.join(this.dataDir, 'catalog.json');
    this.configFile = path.join(this.dataDir, 'config.json');
    this.neteaseAuthFile = path.join(this.dataDir, 'netease-auth.json');
    this.configuredBinary = process.env.MUSIC_MEDIA_GET_PATH?.trim() || '';
    this.sources = (process.env.MUSIC_SEARCH_SOURCES || 'migu,netease,qq,kugou,kuwo,bilibili').split(',').map(value => value.trim()).filter(Boolean);
    this.moveRoots = parseRoots(process.env.MUSIC_MOVE_ROOTS, fileRoots.map(root => ({ ...root })));
    this.jobs = new Map();
    this.queue = [];
    this.activeJobs = 0;
    this.maxConcurrent = 2;
    this.installPromise = null;
    this.catalog = {};
    this.scrapeTokens = new Map();
    this.catalogWrite = Promise.resolve();
    this.projectDir = projectDir;
    this.neteaseCookie = '';
    this.neteaseQr = new Map();
  }

  async initialize() {
    await mkdir(this.downloadDir, { recursive: true });
    await mkdir(this.binDir, { recursive: true });
    try { this.catalog = JSON.parse(await readFile(this.catalogFile, 'utf8')); } catch { this.catalog = {}; }
    try {
      const config = JSON.parse(await readFile(this.configFile, 'utf8'));
      if (Array.isArray(config.moveRoots) && config.moveRoots.length) this.moveRoots = config.moveRoots;
    } catch {}
    await this.loadNeteaseAuth();
  }

  authSecret() {
    const value = process.env.NETEASE_COOKIE_SECRET?.trim() || process.env.DEVSTUDIO_TOKEN?.trim() || '';
    return value ? crypto.createHash('sha256').update(value).digest() : null;
  }

  async loadNeteaseAuth() {
    const key = this.authSecret();
    if (!key) return;
    try {
      const saved = JSON.parse(await readFile(this.neteaseAuthFile, 'utf8'));
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(saved.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(saved.tag, 'base64'));
      this.neteaseCookie = Buffer.concat([decipher.update(Buffer.from(saved.data, 'base64')), decipher.final()]).toString('utf8');
    } catch { this.neteaseCookie = ''; }
  }

  async saveNeteaseAuth(cookie) {
    const key = this.authSecret();
    if (!key) throw httpError('需要配置 DEVSTUDIO_TOKEN 或 NETEASE_COOKIE_SECRET 才能安全保存网易云登录状态', 503);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(cookie, 'utf8'), cipher.final()]);
    await writeFile(this.neteaseAuthFile, `${JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') })}\n`, { mode: 0o600 });
    this.neteaseCookie = cookie;
  }

  neteaseParams(endpoint, payload) {
    const apiPath = new URL(endpoint).pathname.replace('/eapi/', '/api/');
    const body = JSON.stringify(payload);
    const digest = crypto.createHash('md5').update(`nobody${apiPath}use${body}md5forencrypt`).digest('hex');
    const plaintext = `${apiPath}-36cd479b6b5-${body}-36cd479b6b5-${digest}`;
    const cipher = crypto.createCipheriv('aes-128-ecb', neteaseEapiKey, null);
    return Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('hex').toUpperCase();
  }

  async neteaseEapi(endpoint, payload, cookie = this.neteaseCookie, includeResponse = false) {
    const header = { os: 'pc', appver: '', osver: '', deviceId: 'pyncm!', requestId: String(20000000 + crypto.randomInt(10000000)) };
    const params = this.neteaseParams(endpoint, { ...payload, header: JSON.stringify(header) });
    const response = await fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(30000), headers: {
      'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/2.10.2.200154', Referer: 'https://music.163.com/', Cookie: `${cookie ? `${cookie}; ` : ''}os=pc; deviceId=pyncm!`
    }, body: new URLSearchParams({ params }) });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw httpError(`网易云接口返回 ${response.status}`, 502);
    return includeResponse ? { data, response } : data;
  }

  async createNeteaseQr() {
    if (!this.authSecret()) throw httpError('服务尚未配置安全密钥，不能保存网易云登录状态', 503);
    const endpoint = 'https://interface3.music.163.com/eapi/login/qrcode/unikey';
    const result = await this.neteaseEapi(endpoint, { type: 1 }, '');
    if (result.code !== 200 || !result.unikey) throw httpError(result.message || '生成网易云登录二维码失败', 502);
    const id = crypto.randomUUID();
    this.neteaseQr.set(id, { key: result.unikey, expiresAt: Date.now() + 3 * 60 * 1000 });
    return { id, image: await QRCode.toDataURL(`https://music.163.com/login?codekey=${result.unikey}`, { width: 280, margin: 1 }), expiresAt: new Date(Date.now() + 3 * 60 * 1000).toISOString() };
  }

  async checkNeteaseQr(id) {
    const pending = this.neteaseQr.get(String(id));
    if (!pending || pending.expiresAt < Date.now()) { this.neteaseQr.delete(String(id)); throw httpError('二维码已过期，请重新生成', 410); }
    const endpoint = 'https://interface3.music.163.com/eapi/login/qrcode/client/login';
    const { data, response } = await this.neteaseEapi(endpoint, { key: pending.key, type: 1 }, '', true);
    if (data.code === 803) {
      const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie') || ''];
      const musicU = setCookies.join(';').match(/(?:^|[;,]\s*)MUSIC_U=([^;,]+)/)?.[1];
      if (!musicU) throw httpError('网易云登录成功，但没有返回 MUSIC_U', 502);
      await this.saveNeteaseAuth(`MUSIC_U=${musicU}; os=pc; appver=2.10.2.200154`);
      this.neteaseQr.delete(String(id));
      return { state: 'authorized', loggedIn: true };
    }
    return { state: data.code === 802 ? 'confirming' : data.code === 801 ? 'waiting' : 'expired', loggedIn: false };
  }

  async logoutNetease() {
    this.neteaseCookie = '';
    await rm(this.neteaseAuthFile, { force: true });
  }

  async importNeteaseCookie(input) {
    const raw = String(input.cookie || '').trim();
    const musicU = raw.match(/(?:^|;\s*)MUSIC_U=([^;\s]+)/)?.[1];
    if (!musicU || musicU.length < 20 || musicU.length > 1000) throw httpError('Cookie 中没有有效的 MUSIC_U');
    await this.saveNeteaseAuth(`MUSIC_U=${musicU}; os=pc; appver=2.10.2.200154`);
    try {
      const response = await fetch('https://music.163.com/api/nuser/account/get', { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://music.163.com/', Cookie: this.neteaseCookie } });
      const account = await response.json();
      if (account.code !== 200 || !account.account || account.account.anonimousUser) throw new Error('登录状态无效或已过期');
    }
    catch (cause) { await this.logoutNetease(); throw httpError(`Cookie 验证失败：${cause.message}`, 401); }
    return { loggedIn: true };
  }

  async resolveNeteaseSong(songId, quality) {
    if (!this.neteaseCookie) throw httpError('请先登录网易云账号', 401);
    if (!neteaseQualities.has(quality)) throw httpError('不支持该网易云音质');
    const endpoint = 'https://interface3.music.163.com/eapi/song/enhance/player/url/v1';
    const result = await this.neteaseEapi(endpoint, { ids: [Number(songId)], level: quality, encodeType: 'flac', ...(quality === 'sky' ? { immerseType: 'c51' } : {}) });
    const audio = result.data?.[0];
    if (!audio?.url) throw httpError(`网易云未返回可下载地址${audio?.message ? `：${audio.message}` : '，可能没有版权或音质权益'}`, 404);
    return { url: audio.url, type: String(audio.type || 'mp3').toLowerCase(), level: audio.level || quality, size: Number(audio.size) || 0 };
  }

  async searchNetease(keyword, quality) {
    if (!this.neteaseCookie) return [];
    const response = await fetch('https://music.163.com/api/cloudsearch/pc', { method: 'POST', signal: AbortSignal.timeout(30000), headers: {
      'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0', Referer: 'https://music.163.com/', Cookie: this.neteaseCookie
    }, body: new URLSearchParams({ s: keyword, type: '1', limit: '12' }) });
    const result = await response.json();
    const songs = result.result?.songs || [];
    const checked = await Promise.all(songs.map(async song => {
      try {
        const audio = await this.resolveNeteaseSong(song.id, quality);
        return { id: `netease-${song.id}`, neteaseId: song.id, name: String(song.name || ''), artist: (song.ar || []).map(item => item.name).join('/'), album: String(song.al?.name || ''), duration: Number(song.dt) / 1000 || 0, url: `https://music.163.com/song?id=${song.id}`, source: 'netease-auth', sourceLabel: '网易云会员', requestedQuality: quality, actualQuality: audio.level, fileType: audio.type, fileSize: audio.size };
      } catch { return null; }
    }));
    return checked.filter(Boolean);
  }

  binaryPath() {
    if (this.configuredBinary) return path.resolve(this.configuredBinary);
    return path.join(this.binDir, process.platform === 'win32' ? 'media-get.exe' : 'media-get');
  }

  assetName() {
    const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'linux' ? 'linux' : process.platform === 'win32' ? 'win' : '';
    const architecture = process.arch === 'arm64' ? '-arm64' : process.arch === 'x64' ? '' : null;
    if (!platform || architecture === null || (platform === 'win' && architecture)) throw httpError(`当前系统暂不支持自动安装 media-get：${process.platform}/${process.arch}`, 503);
    return `media-get-${mediaGetVersion}-${platform}${architecture}${platform === 'win' ? '.exe' : ''}`;
  }

  async ensureBinary() {
    const binary = this.binaryPath();
    if (await exists(binary)) return binary;
    if (this.configuredBinary) throw httpError(`找不到 MUSIC_MEDIA_GET_PATH：${binary}`, 503);
    if (!this.installPromise) this.installPromise = this.installBinary(binary).finally(() => { this.installPromise = null; });
    return this.installPromise;
  }

  async installBinary(binary) {
    const asset = this.assetName();
    const url = `https://github.com/foamzou/media-get/releases/download/v${mediaGetVersion}/${asset}`;
    const temporary = `${binary}.download`;
    let response;
    try { response = await fetch(url, { signal: AbortSignal.timeout(120000) }); }
    catch (cause) { throw httpError(`安装 media-get 失败：${cause.message}`, 503); }
    if (!response.ok || !response.body) throw httpError(`安装 media-get 失败：GitHub 返回 ${response.status}`, 503);
    try {
      await pipeline(response.body, createWriteStream(temporary, { mode: 0o755 }));
      await rename(temporary, binary);
      if (process.platform !== 'win32') await chmod(binary, 0o755);
    } catch (cause) {
      await rm(temporary, { force: true });
      throw httpError(`安装 media-get 失败：${cause.message}`, 503);
    }
    return binary;
  }

  async runMediaGet(args, timeout) {
    const binary = await this.ensureBinary();
    try {
      const { stdout } = await execFileAsync(binary, args, { timeout, maxBuffer: 4 * 1024 * 1024, env: process.env });
      return stdout;
    } catch (cause) {
      const detail = String(cause.stderr || cause.stdout || cause.message).trim().slice(0, 500);
      throw httpError(`媒体服务执行失败${detail ? `：${detail}` : ''}`, 502);
    }
  }

  async search(query, quality = 'lossless') {
    const keyword = String(query || '').trim();
    if (!keyword || keyword.length > 100) throw httpError('搜索关键词长度必须为 1–100 个字符');
    if (!neteaseQualities.has(quality)) throw httpError('不支持该网易云音质');
    const authorized = await this.searchNetease(keyword, quality);
    const publicSources = this.neteaseCookie ? this.sources.filter(source => source !== 'netease') : this.sources;
    if (!publicSources.length) return authorized;
    const output = await this.runMediaGet(['-k', keyword, '--searchType=song', `--sources=${publicSources.join(',')}`, '-m', '--infoFormat=json', '-l', 'silence'], 45000);
    let items;
    try { items = JSON.parse(output); } catch { throw httpError('媒体服务返回了无法识别的搜索结果', 502); }
    if (!Array.isArray(items)) return [];
    const candidates = items.slice(0, 50).map((item, index) => ({
      id: crypto.createHash('sha1').update(`${item.Url || ''}:${index}`).digest('hex').slice(0, 16),
      name: String(item.Name || '').slice(0, 200), artist: String(item.Artist || '').slice(0, 200),
      album: String(item.Album || '').slice(0, 200), duration: Number(item.Duration) || 0,
      url: String(item.Url || ''), source: String(item.Source || ''), sourceLabel: sourceLabels[item.Source] || String(item.Source || '未知来源'),
      forbidden: Boolean(item.ResourceForbidden)
    })).filter(item => !item.forbidden && /^https?:\/\//.test(item.url));
    return [...authorized, ...await this.filterDownloadable(candidates)];
  }

  async filterDownloadable(candidates) {
    const results = new Array(candidates.length).fill(null);
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < candidates.length) {
        const index = nextIndex++;
        const item = candidates[index];
        try {
          const output = await this.runMediaGet(['-u', item.url, '-m', '--infoFormat=json', '-l', 'silence'], 20000);
          const meta = JSON.parse(output);
          const audios = Array.isArray(meta.audios) ? meta.audios : [];
          const audio = audios.find(candidate => !candidate.not_available && /^https?:\/\//.test(String(candidate.url || '')));
          if (audio && await this.isAudioUrlAvailable(String(audio.url))) {
            results[index] = { ...item, audioUrl: String(audio.url), coverUrl: /^https?:\/\//.test(String(meta.cover_url || '')) ? meta.cover_url : '' };
          }
        } catch {
          // 单个来源解析失败不影响其他搜索结果，无法确认可下载的结果直接隐藏。
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, worker));
    return results.filter(Boolean);
  }

  async isAudioUrlAvailable(url) {
    try {
      const response = await fetch(url, {
        redirect: 'follow', signal: AbortSignal.timeout(10000),
        headers: { Range: 'bytes=0-31', 'User-Agent': 'Mozilla/5.0' }
      });
      if (!response.ok || !response.body) return false;
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      await response.body.cancel();
      return !contentType.includes('text/html') && !contentType.includes('application/json');
    } catch { return false; }
  }

  async listFiles() {
    const entries = await readdir(this.downloadDir, { withFileTypes: true });
    const items = await Promise.all(entries.filter(entry => entry.isFile() && audioExtensions.has(path.extname(entry.name).toLowerCase())).map(async entry => {
      const info = await stat(path.join(this.downloadDir, entry.name));
      return { id: entry.name, name: entry.name, size: info.size, modified: info.mtime.toISOString() };
    }));
    return items.sort((a, b) => b.modified.localeCompare(a.modified));
  }

  createDownload(input) {
    const url = String(input.url || '').trim();
    let parsed;
    try { parsed = new URL(url); } catch { throw httpError('下载地址无效'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw httpError('下载地址仅支持 HTTP/HTTPS');
    const title = cleanFilename([input.artist, input.name].filter(Boolean).join(' - '));
    const job = { id: crypto.randomUUID(), type: 'download', title, status: 'queued', error: '', createdAt: new Date().toISOString() };
    this.jobs.set(job.id, job);
    const audioUrl = /^https?:\/\//.test(String(input.audioUrl || '')) ? String(input.audioUrl) : '';
    const neteaseId = input.source === 'netease-auth' && /^\d+$/.test(String(input.neteaseId || '')) ? Number(input.neteaseId) : 0;
    const requestedQuality = neteaseQualities.has(input.requestedQuality) ? input.requestedQuality : 'lossless';
    this.queue.push({ job, url, audioUrl, neteaseId, requestedQuality, title, song: {
      name: String(input.name || '').slice(0, 200), artist: String(input.artist || '').slice(0, 200),
      album: String(input.album || '').slice(0, 200), duration: Number(input.duration) || 0,
      source: String(input.source || '').slice(0, 30), sourceLabel: String(input.sourceLabel || '').slice(0, 50), requestedQuality,
      coverUrl: /^https?:\/\//.test(String(input.coverUrl || '')) ? String(input.coverUrl) : ''
    } });
    this.pumpQueue();
    return job;
  }

  pumpQueue() {
    while (this.activeJobs < this.maxConcurrent && this.queue.length) {
      const task = this.queue.shift();
      this.activeJobs += 1;
      this.runDownload(task).finally(() => { this.activeJobs -= 1; this.pumpQueue(); });
    }
  }

  async downloadAudioUrl(url, target) {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60 * 1000) });
    if (!response.ok || !response.body) throw httpError(`音频直链返回 ${response.status}`, 502);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html') || contentType.includes('application/json')) throw httpError('音频直链已失效', 502);
    const declaredSize = Number(response.headers.get('content-length') || 0);
    const maxSize = 1024 * 1024 * 1024;
    if (declaredSize > maxSize) throw httpError('音频文件超过 1 GB 限制', 413);
    let received = 0;
    const limiter = new Transform({ transform(chunk, encoding, callback) {
      received += chunk.length;
      callback(received > maxSize ? httpError('音频文件超过 1 GB 限制', 413) : null, chunk);
    } });
    await pipeline(response.body, limiter, createWriteStream(target, { mode: 0o600 }));
    if (!received) throw httpError('音频直链返回了空文件', 502);
  }

  async runDownload({ job, url, audioUrl, neteaseId, requestedQuality, title, song }) {
    job.status = 'running';
    const tempDir = await import('node:fs/promises').then(fs => fs.mkdtemp(path.join(os.tmpdir(), 'allinone-music-')));
    let extension = '.mp3';
    let resolvedNetease = null;
    try {
      if (neteaseId) {
        resolvedNetease = await this.resolveNeteaseSong(neteaseId, requestedQuality);
        extension = audioExtensions.has(`.${resolvedNetease.type}`) ? `.${resolvedNetease.type}` : '.mp3';
      }
      const temporary = path.join(tempDir, `${title}${extension}`);
      if (resolvedNetease) {
        await this.downloadAudioUrl(resolvedNetease.url, temporary);
        song.actualQuality = resolvedNetease.level;
      } else if (audioUrl) {
        try { await this.downloadAudioUrl(audioUrl, temporary); }
        catch (directCause) {
          try { await this.runMediaGet(['-u', url, '--out', temporary, '-t', 'audio', '-l', 'silence'], 10 * 60 * 1000); }
          catch (fallbackCause) { throw httpError(`${directCause.message}；备用解析失败：${fallbackCause.message}`, 502); }
        }
      } else {
        await this.runMediaGet(['-u', url, '--out', temporary, '-t', 'audio', '-l', 'silence'], 10 * 60 * 1000);
      }
      if (!(await exists(temporary))) throw httpError('媒体服务未生成音频文件', 502);
      const destination = await uniquePath(this.downloadDir, path.basename(temporary));
      await rename(temporary, destination);
      job.status = 'finished'; job.filename = path.basename(destination); job.finishedAt = new Date().toISOString();
      this.catalog[job.filename] = { ...song, url, downloadedAt: job.finishedAt };
      await this.saveCatalog();
    } catch (cause) {
      job.status = 'failed'; job.error = cause.message; job.finishedAt = new Date().toISOString();
    } finally { await rm(tempDir, { recursive: true, force: true }); }
  }

  async saveCatalog() {
    this.catalogWrite = this.catalogWrite.catch(() => {}).then(async () => {
      const temporary = `${this.catalogFile}.tmp`;
      await writeFile(temporary, `${JSON.stringify(this.catalog, null, 2)}\n`, 'utf8');
      await rename(temporary, this.catalogFile);
    });
    return this.catalogWrite;
  }

  async saveConfig() {
    const temporary = `${this.configFile}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ moveRoots: this.moveRoots }, null, 2)}\n`, 'utf8');
    await rename(temporary, this.configFile);
  }

  async updateMoveRoots(input) {
    if (!Array.isArray(input.moveRoots) || !input.moveRoots.length || input.moveRoots.length > 20) throw httpError('请配置 1–20 个移动目的地');
    const seen = new Set();
    const roots = [];
    for (const item of input.moveRoots) {
      const label = String(item.label || '').trim().slice(0, 30);
      const directory = path.resolve(String(item.path || '').trim());
      if (!label || !path.isAbsolute(String(item.path || '').trim())) throw httpError('目的地需要填写名称和绝对路径');
      if (seen.has(directory)) throw httpError(`目的地路径重复：${directory}`);
      const info = await stat(directory).catch(() => null);
      if (!info?.isDirectory()) throw httpError(`目的地根目录不存在：${directory}`);
      seen.add(directory);
      roots.push({ id: crypto.createHash('sha1').update(directory).digest('hex').slice(0, 10), label, path: directory });
    }
    this.moveRoots = roots;
    await this.saveConfig();
    return roots;
  }

  resolveDownloadedFile(value) {
    const filename = path.basename(String(value || ''));
    if (!audioExtensions.has(path.extname(filename).toLowerCase())) throw httpError('不支持该音频格式');
    const target = path.join(this.downloadDir, filename);
    if (!isInside(this.downloadDir, target)) throw httpError('文件路径无效', 403);
    return { filename, target };
  }

  async readMetadata(filenameInput) {
    const { filename, target } = this.resolveDownloadedFile(filenameInput);
    if (!(await exists(target))) throw httpError('下载文件不存在', 404);
    let probe;
    try {
      const { stdout } = await execFileAsync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', target], { timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
      probe = JSON.parse(stdout);
    } catch (cause) { throw httpError(`读取音频元信息失败：${cause.message}`, 502); }
    const tags = probe.format?.tags || {};
    const tag = name => String(tags[name] ?? tags[name.toUpperCase()] ?? '').slice(0, 300);
    const audio = probe.streams?.find(stream => stream.codec_type === 'audio') || {};
    const catalog = this.catalog[filename] || {};
    return {
      filename, title: tag('title') || catalog.name || path.basename(filename, path.extname(filename)),
      artist: tag('artist') || catalog.artist || '', album: tag('album') || catalog.album || '',
      date: tag('date') || tag('year'), genre: tag('genre'), track: tag('track'),
      duration: Number(probe.format?.duration) || catalog.duration || 0, bitrate: Number(probe.format?.bit_rate) || 0,
      codec: audio.codec_name || '', sampleRate: Number(audio.sample_rate) || 0,
      hasCover: Boolean(probe.streams?.some(stream => stream.codec_type === 'video' && stream.disposition?.attached_pic)),
      source: catalog.source || '', sourceLabel: catalog.sourceLabel || sourceLabels[catalog.source] || ''
    };
  }

  validateTags(input) {
    const field = (name, max = 200) => String(input[name] || '').trim().slice(0, max);
    return { title: field('title'), artist: field('artist'), album: field('album'), date: field('date', 20), genre: field('genre', 80), track: field('track', 20) };
  }

  async fetchCover(url, directory) {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok || !response.body) throw httpError(`封面下载失败：HTTP ${response.status}`, 502);
    const size = Number(response.headers.get('content-length') || 0);
    if (size > 10 * 1024 * 1024) throw httpError('封面不能超过 10 MB', 413);
    const type = String(response.headers.get('content-type') || '').split(';')[0];
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) throw httpError('刮削结果不是支持的图片格式', 415);
    const coverPath = path.join(directory, type === 'image/png' ? 'cover.png' : type === 'image/webp' ? 'cover.webp' : 'cover.jpg');
    let received = 0;
    const limiter = new TransformStream({ transform(chunk, controller) { received += chunk.byteLength; if (received > 10 * 1024 * 1024) throw httpError('封面不能超过 10 MB', 413); controller.enqueue(chunk); } });
    await pipeline(response.body.pipeThrough(limiter), createWriteStream(coverPath));
    return coverPath;
  }

  async writeMetadata(input) {
    const { filename, target } = this.resolveDownloadedFile(input.filename);
    if (!(await exists(target))) throw httpError('下载文件不存在', 404);
    const tags = this.validateTags(input);
    if (!tags.title) throw httpError('歌曲名不能为空');
    let coverUrl = '';
    if (input.scrapeToken) {
      const scraped = this.scrapeTokens.get(String(input.scrapeToken));
      if (!scraped || scraped.filename !== filename || scraped.expiresAt < Date.now()) throw httpError('刮削结果已失效，请重新刮削');
      coverUrl = scraped.coverUrl;
      this.scrapeTokens.delete(String(input.scrapeToken));
    }
    const temporaryDir = await import('node:fs/promises').then(fs => fs.mkdtemp(path.join(os.tmpdir(), 'allinone-tags-')));
    const output = path.join(temporaryDir, `output${path.extname(filename)}`);
    try {
      const args = ['-v', 'error', '-y', '-i', target];
      if (coverUrl) args.push('-i', await this.fetchCover(coverUrl, temporaryDir), '-map', '0:a:0', '-map', '1:v:0', '-c', 'copy', '-disposition:v:0', 'attached_pic');
      else args.push('-map', '0', '-c', 'copy', '-map_metadata', '0');
      for (const [key, value] of Object.entries(tags)) args.push('-metadata', `${key}=${value}`);
      if (path.extname(filename).toLowerCase() === '.mp3') args.push('-id3v2_version', '3');
      args.push(output);
      await execFileAsync(process.env.FFMPEG_PATH || 'ffmpeg', args, { timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
      await rename(output, target);
      this.catalog[filename] = { ...(this.catalog[filename] || {}), name: tags.title, artist: tags.artist, album: tags.album, editedAt: new Date().toISOString() };
      await this.saveCatalog();
      return this.readMetadata(filename);
    } catch (cause) { throw httpError(`写入音频元信息失败：${String(cause.stderr || cause.message).trim().slice(0, 400)}`, 502); }
    finally { await rm(temporaryDir, { recursive: true, force: true }); }
  }

  async scrape(input) {
    const metadata = await this.readMetadata(input.filename);
    const manualTitle = String(input.title || '').trim().slice(0, 200);
    const manualArtist = String(input.artist || '').trim().slice(0, 200);
    if (!manualTitle) throw httpError('请先输入歌曲名再刮削');
    const query = [manualTitle, manualArtist].filter(Boolean).join(' ');
    const candidates = await this.search(query);
    const normalize = value => String(value || '').toLocaleLowerCase('zh-CN').replace(/[\s·・\-—_()[\]（）【】《》"']/g, '');
    const title = normalize(manualTitle);
    const artist = normalize(manualArtist);
    const score = item => {
      const itemTitle = normalize(item.name), itemArtist = normalize(item.artist);
      const durationDifference = metadata.duration && item.duration ? Math.abs(metadata.duration - item.duration) : 120;
      return (title && (itemTitle === title ? 12 : itemTitle.includes(title) ? 6 : 0))
        + (artist && (itemArtist === artist ? 16 : itemArtist.includes(artist) ? 9 : 0))
        + (['migu', 'netease', 'qq', 'kugou', 'kuwo'].includes(item.source) ? 3 : 0)
        + (item.coverUrl ? 1 : 0) - Math.min(durationDifference / 20, 5);
    };
    const ranked = candidates.sort((a, b) => score(b) - score(a)).slice(0, 8);
    if (!ranked.length) throw httpError('没有找到可用的刮削结果', 404);
    return { candidates: ranked.map(candidate => {
      const token = crypto.randomUUID();
      this.scrapeTokens.set(token, { filename: metadata.filename, coverUrl: candidate.coverUrl || '', expiresAt: Date.now() + 10 * 60 * 1000 });
      return { ...candidate, token };
    }) };
  }

  async moveFiles(input) {
    const names = Array.isArray(input.files) ? [...new Set(input.files.map(value => path.basename(String(value))))] : [];
    if (!names.length || names.length > 200) throw httpError('请选择 1–200 首已下载歌曲');
    const root = this.moveRoots.find(item => item.id === String(input.root || ''));
    if (!root) throw httpError('目标目录不在允许范围内', 403);
    const relative = String(input.path || '').trim().replace(/^[/\\]+/, '');
    const destinationDirectory = path.resolve(root.path, relative);
    if (!isInside(root.path, destinationDirectory)) throw httpError('目标目录超出允许范围', 403);
    const rootInfo = await stat(root.path).catch(() => null);
    if (!rootInfo?.isDirectory()) throw httpError('目标根目录不存在', 404);
    await mkdir(destinationDirectory, { recursive: true });
    const moved = [];
    for (const name of names) {
      if (!audioExtensions.has(path.extname(name).toLowerCase())) throw httpError(`不支持移动该文件：${name}`);
      const source = path.join(this.downloadDir, name);
      if (!isInside(this.downloadDir, source) || !(await exists(source))) throw httpError(`下载文件不存在：${name}`, 404);
      const destination = await uniquePath(destinationDirectory, name);
      try { await rename(source, destination); }
      catch (cause) {
        if (cause.code !== 'EXDEV') throw cause;
        await copyFile(source, destination); await rm(source);
      }
      moved.push({ name, destination: path.basename(destination) });
      delete this.catalog[name];
    }
    await this.saveCatalog();
    return moved;
  }

  async browseMoveDirectories(rootId, relativeInput = '') {
    const root = this.moveRoots.find(item => item.id === String(rootId || ''));
    if (!root) throw httpError('移动目的地不存在', 404);
    const relative = String(relativeInput || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (relative.length > 500 || relative.split('/').some(part => part === '..')) throw httpError('子目录路径无效');
    const rootPath = await realpath(root.path).catch(() => null);
    const requested = path.resolve(root.path, relative);
    const directory = await realpath(requested).catch(() => null);
    if (!rootPath || !directory || !isInside(rootPath, directory)) throw httpError('子目录不存在或超出目的地', 404);
    const info = await stat(directory);
    if (!info.isDirectory()) throw httpError('选择的路径不是目录');
    const entries = await readdir(directory, { withFileTypes: true });
    const directories = [];
    for (const entry of entries.filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))) {
      const child = await realpath(path.join(directory, entry.name)).catch(() => null);
      if (child && isInside(rootPath, child)) directories.push(entry.name);
    }
    const current = path.relative(rootPath, directory).split(path.sep).join('/');
    return { root: { id: root.id, label: root.label }, path: current, parent: current ? current.split('/').slice(0, -1).join('/') : null, directories };
  }

  async streamAudio(req, res, filenameInput) {
    const { filename, target } = this.resolveDownloadedFile(filenameInput);
    const info = await stat(target).catch(() => null);
    if (!info?.isFile()) throw httpError('下载文件不存在', 404);
    const mime = audioMimeTypes[path.extname(filename).toLowerCase()] || 'application/octet-stream';
    const range = String(req.headers.range || '');
    const headers = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=60', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(filename)}` };
    if (!range) {
      res.writeHead(200, { ...headers, 'Content-Length': info.size });
      createReadStream(target).pipe(res); return;
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) throw httpError('无效的音频范围', 416);
    const suffixLength = !match[1] && match[2] ? Number(match[2]) : 0;
    const start = suffixLength ? Math.max(0, info.size - suffixLength) : match[1] ? Number(match[1]) : 0;
    const end = suffixLength ? info.size - 1 : match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= info.size) throw httpError('音频范围超出文件大小', 416);
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Content-Length': end - start + 1 });
    createReadStream(target, { start, end }).pipe(res);
  }

  async deleteDownloadedFile(filenameInput) {
    const { filename, target } = this.resolveDownloadedFile(filenameInput);
    const info = await stat(target).catch(() => null);
    if (!info?.isFile()) throw httpError('下载文件不存在', 404);
    await rm(target);
    delete this.catalog[filename];
    await this.saveCatalog();
    return filename;
  }

  async handle(req, res, url) {
    if (!url.pathname.startsWith(apiPrefix)) return false;
    if (url.pathname === `${apiPrefix}/status` && req.method === 'GET') {
      return json(res, 200, { ready: await exists(this.binaryPath()), downloadDir: this.downloadDir, roots: this.moveRoots.map(({ id, label }) => ({ id, label })), netease: { loggedIn: Boolean(this.neteaseCookie), secureStorageReady: Boolean(this.authSecret()) } }), true;
    }
    if (url.pathname === `${apiPrefix}/netease/qr` && req.method === 'POST') return json(res, 201, { qr: await this.createNeteaseQr() }), true;
    if (url.pathname === `${apiPrefix}/netease/qr` && req.method === 'GET') return json(res, 200, await this.checkNeteaseQr(url.searchParams.get('id'))), true;
    if (url.pathname === `${apiPrefix}/netease/session` && req.method === 'PUT') return json(res, 200, await this.importNeteaseCookie(await readJson(req))), true;
    if (url.pathname === `${apiPrefix}/netease/session` && req.method === 'DELETE') { await this.logoutNetease(); return json(res, 200, { loggedIn: false }), true; }
    if (url.pathname === `${apiPrefix}/config` && req.method === 'GET') return json(res, 200, { moveRoots: this.moveRoots }), true;
    if (url.pathname === `${apiPrefix}/config` && req.method === 'PUT') return json(res, 200, { moveRoots: await this.updateMoveRoots(await readJson(req)) }), true;
    if (url.pathname === `${apiPrefix}/search` && req.method === 'GET') return json(res, 200, { items: await this.search(url.searchParams.get('q'), url.searchParams.get('quality') || 'lossless') }), true;
    if (url.pathname === `${apiPrefix}/downloads` && req.method === 'GET') return json(res, 200, { items: await this.listFiles(), jobs: [...this.jobs.values()].slice(-30).reverse() }), true;
    if (url.pathname === `${apiPrefix}/downloads` && req.method === 'POST') return json(res, 202, { job: this.createDownload(await readJson(req)) }), true;
    if (url.pathname === `${apiPrefix}/downloads` && req.method === 'DELETE') return json(res, 200, { deleted: await this.deleteDownloadedFile(url.searchParams.get('file')) }), true;
    if (url.pathname === `${apiPrefix}/audio` && req.method === 'GET') { await this.streamAudio(req, res, url.searchParams.get('file')); return true; }
    if (url.pathname === `${apiPrefix}/move` && req.method === 'POST') return json(res, 200, { moved: await this.moveFiles(await readJson(req)) }), true;
    if (url.pathname === `${apiPrefix}/directories` && req.method === 'GET') return json(res, 200, await this.browseMoveDirectories(url.searchParams.get('root'), url.searchParams.get('path'))), true;
    if (url.pathname === `${apiPrefix}/metadata` && req.method === 'GET') return json(res, 200, { metadata: await this.readMetadata(url.searchParams.get('file')) }), true;
    if (url.pathname === `${apiPrefix}/metadata` && req.method === 'PUT') return json(res, 200, { metadata: await this.writeMetadata(await readJson(req)) }), true;
    if (url.pathname === `${apiPrefix}/scrape` && req.method === 'POST') return json(res, 200, await this.scrape(await readJson(req))), true;
    return false;
  }
}
