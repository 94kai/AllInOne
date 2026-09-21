import path from 'node:path';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';

const ROOT = '/api/modules/beijing-pass';
const DEFAULTS = {
  stateUrl: 'https://jjz.jtgl.beijing.gov.cn:2443/pro//applyRecordController/stateList',
  ssoUrl: 'https://ssp.jtgl.beijing.gov.cn/auth/getSsoUserToken',
  stateAuth: '',
  ssoAuth: ''
};
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 16; V2436A Build/BP2A.250605.031.A3_V000L1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/151.0.7922.200 Mobile Safari/537.36 uni-app Html5Plus/1.0 (Immersed/38.153847)';

function httpError(message, status = 400) { return Object.assign(new Error(message), { status }); }
export class BeijingPassModule {
  constructor({ dataDir }) {
    this.dir = path.join(dataDir, 'beijing-pass');
    this.file = path.join(this.dir, 'config.json');
    this.config = { ...DEFAULTS };
    this.meta = { updatedAt: '', stateAuthUpdatedAt: '', lastQueryAt: '', lastSuccessAt: '', lastDirectSuccessAt: '', firstDirectFailureAt: '', lastPath: '', lastError: '' };
  }

  async initialize() {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      this.config = Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, saved.config?.[key] || DEFAULTS[key]]));
      this.meta = { ...this.meta, ...(saved.meta || {}) };
    } catch { /* 首次使用由内置默认值初始化。 */ }
  }

  async save() {
    await mkdir(this.dir, { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ config: this.config, meta: this.meta }, null, 2)}\n`, { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, this.file);
  }

  async body(req) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 64 * 1024) throw httpError('请求内容过大', 413); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw httpError('请求内容不是有效 JSON'); }
  }

  send(res, status, value) {
    const body = JSON.stringify(value);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
    res.end(body); return true;
  }

  publicConfig() {
    const { stateUrl, stateAuth, ssoUrl, ssoAuth } = this.config;
    return { stateUrl, stateAuth, ssoUrl, ssoAuth, meta: this.meta };
  }

  async upstream(url, authorization, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(url, {
        method, signal: controller.signal,
        headers: {
          Authorization: authorization,
          'User-Agent': USER_AGENT,
          Accept: '*/*',
          ...(body ? { 'Content-Type': 'application/json', Origin: 'https://jjz.jtgl.beijing.gov.cn:2443', Referer: 'https://jjz.jtgl.beijing.gov.cn:2443/H5_NewUC/', 'X-Requested-With': 'com.zcbl.bjjj_driving' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 4000) }; }
      if (!response.ok) throw httpError(`上游接口返回 HTTP ${response.status}`, 502);
      return data;
    } catch (cause) {
      if (cause.name === 'AbortError') throw httpError('上游接口请求超时', 504);
      if (cause.status) throw cause;
      throw httpError(`上游接口连接失败：${cause.message}`, 502);
    } finally { clearTimeout(timer); }
  }

  stateSucceeded(data) {
    const code = data?.code ?? data?.status ?? data?.resultCode;
    const message = String(data?.message ?? data?.msg ?? data?.error ?? '');
    if (code !== undefined && ![0, 200, '0', '200', 'success', 'SUCCESS'].includes(code)) return false;
    return !/(token|auth|登录|认证|过期|失效|无效|未授权)/i.test(message);
  }

  findToken(value, preferred = true) {
    if (!value || typeof value !== 'object') return '';
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === 'string' && child.length >= 20 && (preferred ? /(token|auth|user_key|userKey)/i.test(key) : (/^[\w-]+\.[\w-]+\.[\w-]+$/.test(child) || /^[0-9a-f-]{32,}$/i.test(child)))) return child.trim();
    }
    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') { const found = this.findToken(child, preferred); if (found) return found; }
    }
    return preferred ? this.findToken(value, false) : '';
  }

  async queryState(auth) { return this.upstream(this.config.stateUrl, auth, { method: 'POST', body: {} }); }

  async refreshStateAuth(ssoAuth) {
    const response = await this.upstream(this.config.ssoUrl, ssoAuth);
    const token = this.findToken(response);
    if (!token) throw httpError('换取接口响应中没有找到可用 Token', 502);
    this.config.stateAuth = token;
    this.meta.stateAuthUpdatedAt = new Date().toISOString();
    await this.save();
    return token;
  }

  async query() {
    this.meta.lastQueryAt = new Date().toISOString();
    const attempts = [];
    try {
      try {
        const data = await this.queryState(this.config.stateAuth);
        if (this.stateSucceeded(data)) { this.meta.lastDirectSuccessAt = new Date().toISOString(); return await this.finishQuery(data, 'direct', attempts); }
        if (!this.meta.firstDirectFailureAt) this.meta.firstDirectFailureAt = new Date().toISOString();
        attempts.push({ step: 'direct', error: String(data?.message || data?.msg || '直查返回未授权或失败状态') });
      } catch (cause) { if (!this.meta.firstDirectFailureAt) this.meta.firstDirectFailureAt = new Date().toISOString(); attempts.push({ step: 'direct', error: cause.message }); }

      try {
        const token = await this.refreshStateAuth(this.config.ssoAuth);
        const data = await this.queryState(token);
        if (!this.stateSucceeded(data)) throw httpError(String(data?.message || data?.msg || '刷新后查询仍失败'), 502);
        return await this.finishQuery(data, 'sso-refresh', attempts);
      } catch (cause) { attempts.push({ step: 'sso-refresh', error: cause.message }); throw cause; }

    } catch (cause) {
      this.meta.lastError = cause.message; this.meta.lastPath = 'failed'; await this.save();
      throw Object.assign(new Error(cause.message), { status: cause.status || 502, attempts });
    }
  }

  async finishQuery(data, pathName, attempts) {
    this.meta.lastSuccessAt = new Date().toISOString(); this.meta.lastPath = pathName; this.meta.lastError = ''; await this.save();
    return { data, path: pathName, attempts, meta: this.meta };
  }

  async handle(req, res, url) {
    if (!url.pathname.startsWith(ROOT)) return false;
    if (url.pathname === `${ROOT}/config` && req.method === 'GET') return this.send(res, 200, this.publicConfig());
    if (url.pathname === `${ROOT}/config` && req.method === 'PUT') {
      const input = await this.body(req), credentials = {};
      for (const key of ['stateAuth', 'ssoAuth']) { credentials[key] = String(input[key] || '').trim(); if (!credentials[key] || credentials[key].length > 4096) throw httpError(`${key} 不能为空或过长`); }
      this.config = { ...this.config, ...credentials }; this.meta.updatedAt = new Date().toISOString(); await this.save();
      return this.send(res, 200, this.publicConfig());
    }
    if (url.pathname === `${ROOT}/state` && req.method === 'POST') {
      try { return this.send(res, 200, await this.query()); }
      catch (cause) { return this.send(res, cause.status || 502, { error: cause.message, attempts: cause.attempts || [], meta: this.meta }); }
    }
    throw httpError('进京证接口不存在', 404);
  }
}
