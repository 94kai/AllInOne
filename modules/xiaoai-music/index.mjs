import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const defaultProfiles = [
  { id: 'living-room', name: '客厅音箱', ws_port: 4399, api_port: 18180, musicPort: 18080 },
  { id: 'new-speaker', name: '新音箱', ws_port: 4400, api_port: 18181, musicPort: 18081 }
];

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload), 'Cache-Control': 'no-store' });
  res.end(payload);
}

async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 64 * 1024) throw Object.assign(new Error('请求内容过大'), { status: 413 }); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw Object.assign(new Error('请求内容不是有效 JSON'), { status: 400 }); }
}

export class XiaoAiMusicModule {
  constructor({ projectDir, dataDir }) {
    this.moduleDir = path.join(projectDir, 'modules', 'xiaoai-music');
    this.dataDir = path.join(dataDir, 'xiaoai-music');
    this.configFile = path.join(this.dataDir, 'config.json');
    this.children = new Map();
    this.config = null;
    this.shuttingDown = false;
  }

  async initialize() {
    await mkdir(this.dataDir, { recursive: true });
    try { this.config = JSON.parse(await readFile(this.configFile, 'utf8')); }
    catch { this.config = { profiles: defaultProfiles.map(profile => this.normalizeProfile(profile)) }; }
    this.config = { profiles: (this.config.profiles || []).map(profile => this.normalizeProfile(profile, profile)) };
    await this.save();
    for (const profile of this.config.profiles) this.start(profile);
  }

  normalizeProfile(input, previous = {}) {
    const musicDirs = Array.isArray(input.musicDirs) ? input.musicDirs.map(String).map(value => value.trim()).filter(Boolean) : previous.musicDirs || ['/vol3/1000/master/音乐/', '/vol3/1000/master/儿歌/'];
    const musicPort = Number(input.musicPort || previous.musicPort);
    const name = String(input.name || previous.name || '小爱音箱').trim().slice(0, 30);
    const baseUrl = String(input.baseUrl || previous.baseUrl || `http://192.168.11.111:${musicPort}`).trim();
    if (!name) throw Object.assign(new Error('音箱名称不能为空'), { status: 400 });
    if (!musicDirs.length || musicDirs.length > 10 || musicDirs.some(directory => !path.isAbsolute(directory))) throw Object.assign(new Error('音乐目录必须是 1–10 个绝对路径'), { status: 400 });
    try { if (!['http:', 'https:'].includes(new URL(baseUrl).protocol)) throw new Error(); }
    catch { throw Object.assign(new Error('音箱访问地址必须是有效的 HTTP/HTTPS 地址'), { status: 400 }); }
    return {
      id: String(input.id || previous.id), name,
      ws_port: Number(input.ws_port || previous.ws_port), api_port: Number(input.api_port || previous.api_port), musicPort,
      baseUrl,
      musicDirs, maxResults: Math.max(1, Math.min(100, Number(input.maxResults ?? previous.maxResults ?? 20))),
      refreshInterval: Math.max(0, Number(input.refreshInterval ?? previous.refreshInterval ?? 0)),
      playKeywords: this.keywordList(input.playKeywords ?? previous.playKeywords, ['播放']),
      stopKeywords: this.keywordList(input.stopKeywords ?? previous.stopKeywords, ['停止播放', '暂停播放', '停止', '暂停', '闭嘴', '别放了']),
      refreshKeywords: this.keywordList(input.refreshKeywords ?? previous.refreshKeywords, ['刷新曲库']),
      randomKeywords: this.keywordList(input.randomKeywords ?? previous.randomKeywords, ['随便听听']),
      listenerEnabled: input.listenerEnabled ?? previous.listenerEnabled ?? true
    };
  }

  keywordList(value, fallback) {
    const items = Array.isArray(value) ? value : fallback;
    return [...new Set(items.map(String).map(item => item.trim()).filter(Boolean))].slice(0, 20);
  }

  workerConfig(profile) {
    return {
      id: profile.id, name: profile.name, ws_port: profile.ws_port, api_port: profile.api_port,
      listener_enabled: profile.listenerEnabled,
      music: {
        music_dirs: profile.musicDirs, supported_audio_extensions: ['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg'],
        search: { max_results: profile.maxResults, refresh_interval_sec: profile.refreshInterval, index_file: path.join(this.dataDir, `${profile.id}-index.json`) },
        commands: { play_keywords: profile.playKeywords, stop_keywords: profile.stopKeywords, refresh_keywords: profile.refreshKeywords, random_play_keywords: profile.randomKeywords, interrupt_whitelist_keywords: ['音量', '声音', '大点声', '小点声', '静音'], auto_resume_delay_sec: 1.8 },
        http: { port: profile.musicPort, base_url: profile.baseUrl }, logging: { level: 'INFO' }
      }
    };
  }

  async save() {
    const temporary = `${this.configFile}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.config, null, 2)}\n`, 'utf8'); await rename(temporary, this.configFile);
    for (const profile of this.config.profiles) await writeFile(path.join(this.dataDir, `${profile.id}-worker.json`), JSON.stringify(this.workerConfig(profile)), 'utf8');
  }

  start(profile) {
    if (this.shuttingDown || this.children.has(profile.id)) return;
    const python = process.env.XIAOAI_PYTHON || 'python3';
    const configPath = path.join(this.dataDir, `${profile.id}-worker.json`);
    const child = spawn(python, [path.join(this.moduleDir, 'worker_bridge.py'), '--config', configPath], { cwd: this.moduleDir, stdio: ['ignore', 'pipe', 'pipe'] });
    const state = { child, startedAt: Date.now(), error: '', stopping: false };
    this.children.set(profile.id, state);
    child.stdout.on('data', chunk => process.stdout.write(`[xiaoai:${profile.id}] ${chunk}`));
    child.stderr.on('data', chunk => { state.error = String(chunk).trim().slice(-500); process.stderr.write(`[xiaoai:${profile.id}] ${chunk}`); });
    child.on('exit', () => { this.children.delete(profile.id); if (!state.stopping && !this.shuttingDown) setTimeout(() => this.start(profile), 3000); });
  }

  async stop(id) {
    const state = this.children.get(id); if (!state) return;
    state.stopping = true; state.child.kill('SIGTERM');
    await new Promise(resolve => { const timer = setTimeout(() => { state.child.kill('SIGKILL'); resolve(); }, 4000); state.child.once('exit', () => { clearTimeout(timer); resolve(); }); });
    this.children.delete(id);
  }

  async shutdown() {
    this.shuttingDown = true;
    await Promise.all([...this.children.keys()].map(id => this.stop(id)));
  }

  profile(id) { return this.config.profiles.find(item => item.id === id); }

  async worker(profile, pathname, options = {}) {
    const response = await fetch(`http://127.0.0.1:${profile.api_port}${pathname}`, { ...options, signal: AbortSignal.timeout(options.timeout || 120000), headers: options.body ? { 'Content-Type': 'application/json' } : undefined });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || `音箱服务请求失败（${response.status}）`), { status: 502 });
    return data;
  }

  publicProfile(profile) { const { api_port, ws_port, ...safe } = profile; return safe; }

  async handle(req, res, url) {
    const base = '/api/modules/xiaoai-music';
    if (!url.pathname.startsWith(base)) return false;
    if (url.pathname === `${base}/profiles` && req.method === 'GET') {
      const profiles = await Promise.all(this.config.profiles.map(async profile => {
        try { return { ...this.publicProfile(profile), ...(await this.worker(profile, '/status', { timeout: 2500 })), online: true }; }
        catch { return { ...this.publicProfile(profile), online: false, processError: this.children.get(profile.id)?.error || '服务未连接' }; }
      }));
      json(res, 200, { profiles }); return true;
    }
    const match = url.pathname.match(/^\/api\/modules\/xiaoai-music\/profiles\/([^/]+)(?:\/(.+))?$/);
    if (!match) { json(res, 404, { error: '小爱音乐接口不存在' }); return true; }
    const profile = this.profile(decodeURIComponent(match[1]));
    if (!profile) { json(res, 404, { error: '音箱不存在' }); return true; }
    const action = match[2] || '';
    if (!action && req.method === 'PUT') {
      const updated = this.normalizeProfile({ ...(await body(req)), id: profile.id, ws_port: profile.ws_port, api_port: profile.api_port }, profile);
      Object.assign(profile, updated); await this.stop(profile.id); await this.save(); this.start(profile); json(res, 200, { profile: this.publicProfile(profile) }); return true;
    }
    if (action === 'search' && req.method === 'GET') { json(res, 200, await this.worker(profile, `/search?q=${encodeURIComponent(String(url.searchParams.get('q') || '').slice(0, 100))}`)); return true; }
    if (['play', 'play-search', 'random', 'stop', 'refresh', 'listener'].includes(action) && req.method === 'POST') {
      const payload = await body(req);
      const result = await this.worker(profile, `/${action}`, { method: 'POST', body: JSON.stringify(payload), timeout: action === 'refresh' ? 600000 : 120000 });
      if (action === 'listener') { profile.listenerEnabled = Boolean(payload.enabled); await this.save(); }
      json(res, 200, result); return true;
    }
    json(res, 405, { error: '请求方法不支持' }); return true;
  }
}
