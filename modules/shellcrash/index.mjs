import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

const ROOT = '/api/modules/shellcrash';
const DEFAULTS = {
  enabled: true,
  group: 'erwan',
  testUrl: 'https://chatgpt.com/cdn-cgi/trace',
  intervalSeconds: 180,
  failureThreshold: 3,
  cooldownSeconds: 600,
  timeoutMs: 6000
};
const ignoredNodePattern = /^(DIRECT|REJECT|REJECT-DROP|PASS|COMPATIBLE)$|官网|网站|套餐|流量|到期|剩余/i;

function httpError(message, status = 400) { return Object.assign(new Error(message), { status }); }
function isoNow() { return new Date().toISOString(); }

export class ShellCrashModule {
  constructor({ dataDir }) {
    this.dir = path.join(dataDir, 'shellcrash');
    this.file = path.join(this.dir, 'state.json');
    this.shellConfig = process.env.SHELLCRASH_CONFIG_PATH || '/etc/ShellCrash/config.yaml';
    this.config = { ...DEFAULTS };
    this.controller = null;
    this.timer = null;
    this.running = false;
    this.runtime = { available: false, current: '', failures: 0, lastCheckAt: '', lastSuccessAt: '', lastError: '', lastDelay: null, nextCheckAt: '', cooldownUntil: '', history: [] };
  }

  async initialize() {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      this.config = { ...DEFAULTS, ...(saved.config || {}) };
      this.runtime = { ...this.runtime, ...(saved.runtime || {}), nextCheckAt: '' };
      this.runtime.history = Array.isArray(this.runtime.history) ? this.runtime.history.slice(0, 30) : [];
    } catch { /* 首次启动使用保守默认值。 */ }
    await this.readController().catch(cause => { this.runtime.lastError = cause.message; });
    if (this.config.enabled) this.schedule(12_000);
  }

  shutdown() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async save() {
    await mkdir(this.dir, { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ config: this.config, runtime: this.runtime }, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.file);
  }

  async readController() {
    const yaml = await readFile(this.shellConfig, 'utf8').catch(() => { throw httpError(`无法读取 ShellCrash 配置：${this.shellConfig}`, 503); });
    const readValue = key => {
      const match = yaml.match(new RegExp(`^\\s*${key}:\\s*(.*?)\\s*$`, 'm'));
      return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : '';
    };
    let address = readValue('external-controller');
    if (!address) throw httpError('ShellCrash 未开放 external-controller', 503);
    if (address.startsWith(':')) address = `127.0.0.1${address}`;
    if (!/^https?:\/\//i.test(address)) address = `http://${address}`;
    this.controller = { address: address.replace(/\/$/, ''), secret: readValue('secret'), mixedPort: Number(readValue('mixed-port')) || null };
    return this.controller;
  }

  async controllerRequest(endpoint, { method = 'GET', body, timeout = 8000 } = {}) {
    if (!this.controller) await this.readController();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(`${this.controller.address}${endpoint}`, {
        method,
        signal: controller.signal,
        headers: {
          ...(this.controller.secret ? { Authorization: `Bearer ${this.controller.secret}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      });
      const text = await response.text();
      const value = text ? JSON.parse(text) : {};
      if (!response.ok) throw httpError(value.message || `ShellCrash 控制接口返回 ${response.status}`, 502);
      return value;
    } catch (cause) {
      if (cause.name === 'AbortError') throw httpError('ShellCrash 控制接口超时', 504);
      if (cause.status) throw cause;
      throw httpError(`无法连接 ShellCrash：${cause.message}`, 503);
    } finally { clearTimeout(timer); }
  }

  async snapshot() {
    const data = await this.controllerRequest('/proxies');
    const proxies = data.proxies || {};
    const group = proxies[this.config.group];
    if (!group || !Array.isArray(group.all)) throw httpError(`找不到代理组“${this.config.group}”`, 503);
    const nodes = group.all.filter(name => proxies[name] && !Array.isArray(proxies[name].all) && !ignoredNodePattern.test(name));
    this.runtime.available = true;
    this.runtime.current = group.now || '';
    return { current: this.runtime.current, nodes, total: nodes.length };
  }

  async testNode(name) {
    const query = new URLSearchParams({ url: this.config.testUrl, timeout: String(this.config.timeoutMs) });
    const result = await this.controllerRequest(`/proxies/${encodeURIComponent(name)}/delay?${query}`, { timeout: this.config.timeoutMs + 1500 });
    if (!Number.isFinite(result.delay) || result.delay <= 0) throw httpError(`${name} 无法访问 ChatGPT`, 502);
    return result.delay;
  }

  addHistory(entry) {
    this.runtime.history.unshift({ at: isoNow(), ...entry });
    this.runtime.history = this.runtime.history.slice(0, 30);
  }

  async chooseCandidate(nodes, current) {
    const candidates = nodes.filter(name => name !== current);
    const reachable = [];
    for (let offset = 0; offset < candidates.length; offset += 8) {
      const batch = candidates.slice(offset, offset + 8);
      const results = await Promise.all(batch.map(async name => {
        try { return { name, delay: await this.testNode(name) }; } catch { return null; }
      }));
      reachable.push(...results.filter(Boolean));
    }
    reachable.sort((a, b) => a.delay - b.delay);
    return reachable[0] || null;
  }

  async switchTo(name, reason = '手动切换') {
    const { nodes, current } = await this.snapshot();
    if (!nodes.includes(name)) throw httpError('目标节点不在当前代理组中');
    if (name === current) return { changed: false, current };
    await this.controllerRequest(`/proxies/${encodeURIComponent(this.config.group)}`, { method: 'PUT', body: { name } });
    this.runtime.current = name;
    this.runtime.failures = 0;
    this.runtime.cooldownUntil = new Date(Date.now() + this.config.cooldownSeconds * 1000).toISOString();
    this.addHistory({ type: 'switch', from: current, to: name, reason });
    await this.save();
    return { changed: true, current: name };
  }

  async check({ force = false } = {}) {
    if (this.running) throw httpError('检测正在进行中', 409);
    this.running = true;
    this.runtime.lastCheckAt = isoNow();
    this.runtime.lastError = '';
    try {
      const { current, nodes } = await this.snapshot();
      const delay = await this.testNode(current);
      this.runtime.lastDelay = delay;
      this.runtime.lastSuccessAt = isoNow();
      this.runtime.failures = 0;
      this.addHistory({ type: 'success', node: current, delay });
      await this.save();
      return { ok: true, switched: false, current, delay };
    } catch (cause) {
      this.runtime.lastDelay = null;
      this.runtime.lastError = cause.message;
      this.runtime.failures += 1;
      this.addHistory({ type: 'failure', node: this.runtime.current, reason: cause.message, failures: this.runtime.failures });
      const cooldown = Date.parse(this.runtime.cooldownUntil || '') > Date.now();
      if ((force || this.runtime.failures >= this.config.failureThreshold) && !cooldown) {
        try {
          const { current, nodes } = await this.snapshot();
          const candidate = await this.chooseCandidate(nodes, current);
          if (!candidate) throw httpError('没有找到能够访问 ChatGPT 的候选节点', 503);
          await this.switchTo(candidate.name, `ChatGPT 连续检测失败 ${this.runtime.failures} 次`);
          this.runtime.lastDelay = candidate.delay;
          this.runtime.lastSuccessAt = isoNow();
          this.runtime.lastError = '';
          await this.save();
          return { ok: true, switched: true, current: candidate.name, delay: candidate.delay };
        } catch (switchError) { this.runtime.lastError = switchError.message; }
      }
      await this.save();
      return { ok: false, switched: false, current: this.runtime.current, error: this.runtime.lastError, failures: this.runtime.failures, cooldown };
    } finally { this.running = false; }
  }

  schedule(delay = this.config.intervalSeconds * 1000) {
    if (this.timer) clearTimeout(this.timer);
    if (!this.config.enabled) { this.runtime.nextCheckAt = ''; return; }
    this.runtime.nextCheckAt = new Date(Date.now() + delay).toISOString();
    this.timer = setTimeout(async () => {
      this.timer = null;
      try { await this.check(); } catch (cause) { this.runtime.lastError = cause.message; }
      this.schedule();
    }, delay);
    this.timer.unref?.();
  }

  publicState(snapshot = null) {
    return {
      config: this.config,
      runtime: { ...this.runtime, running: this.running },
      shellcrash: { controller: this.controller?.address || '', mixedPort: this.controller?.mixedPort || null },
      nodes: snapshot?.nodes || [],
      total: snapshot?.total || 0
    };
  }

  async body(req) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 16 * 1024) throw httpError('请求内容过大', 413); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw httpError('请求内容不是有效 JSON'); }
  }

  send(res, status, value) {
    const body = JSON.stringify(value);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
    res.end(body); return true;
  }

  async handle(req, res, url) {
    if (!url.pathname.startsWith(ROOT)) return false;
    if (url.pathname === ROOT && req.method === 'GET') {
      let snapshot = null;
      try { snapshot = await this.snapshot(); } catch (cause) { this.runtime.available = false; this.runtime.lastError = cause.message; }
      return this.send(res, 200, this.publicState(snapshot));
    }
    if (url.pathname === `${ROOT}/check` && req.method === 'POST') {
      const result = await this.check({ force: true });
      this.schedule();
      return this.send(res, 200, { result, ...this.publicState(await this.snapshot().catch(() => null)) });
    }
    if (url.pathname === `${ROOT}/switch` && req.method === 'POST') {
      const input = await this.body(req);
      const name = String(input.name || '').trim();
      if (!name || name.length > 200) throw httpError('节点名称不正确');
      const result = await this.switchTo(name);
      return this.send(res, 200, { result, ...this.publicState(await this.snapshot()) });
    }
    if (url.pathname === `${ROOT}/config` && req.method === 'PUT') {
      const input = await this.body(req);
      const number = (key, min, max) => {
        const value = Number(input[key]);
        if (!Number.isInteger(value) || value < min || value > max) throw httpError(`${key} 参数不正确`);
        return value;
      };
      this.config.enabled = Boolean(input.enabled);
      this.config.intervalSeconds = number('intervalSeconds', 60, 3600);
      this.config.failureThreshold = number('failureThreshold', 1, 10);
      this.config.cooldownSeconds = number('cooldownSeconds', 60, 86400);
      await this.save();
      this.schedule();
      return this.send(res, 200, this.publicState(await this.snapshot().catch(() => null)));
    }
    throw httpError('ShellCrash 接口不存在', 404);
  }
}
