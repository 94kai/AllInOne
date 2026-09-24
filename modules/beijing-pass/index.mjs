import path from 'node:path';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';

const ROOT = '/api/modules/beijing-pass';
const DEFAULTS = {
  stateUrl: 'https://jjz.jtgl.beijing.gov.cn:2443/pro//applyRecordController/stateList',
  ssoUrl: 'https://ssp.jtgl.beijing.gov.cn/auth/getSsoUserToken',
  stateAuth: '',
  ssoAuth: '',
  serverChanSendKey: ''
};
const POLL_INTERVAL_MS = 60_000;
const MAX_POLL_ATTEMPTS = 15;
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 16; V2436A Build/BP2A.250605.031.A3_V000L1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/151.0.7922.200 Mobile Safari/537.36 uni-app Html5Plus/1.0 (Immersed/38.153847)';
const SOURCE = '99c4g1a438jgf412sa3xvckd43256h7g';

function httpError(message, status = 400) { return Object.assign(new Error(message), { status }); }
export class BeijingPassModule {
  constructor({ dataDir }) {
    this.dir = path.join(dataDir, 'beijing-pass');
    this.file = path.join(this.dir, 'config.json');
    this.applyDefaultsFile = path.join(this.dir, 'apply-defaults.json');
    this.config = { ...DEFAULTS };
    this.applyDefaults = null;
    this.monitor = null;
    this.monitorTimer = null;
    this.monitorRunning = false;
    this.meta = { updatedAt: '', stateAuthUpdatedAt: '', lastQueryAt: '', lastSuccessAt: '', lastDirectSuccessAt: '', firstDirectFailureAt: '', lastPath: '', lastError: '' };
  }

  async initialize() {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      this.config = Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, saved.config?.[key] || DEFAULTS[key]]));
      this.meta = { ...this.meta, ...(saved.meta || {}) };
    } catch { /* 首次使用由内置默认值初始化。 */ }
    if (!this.config.serverChanSendKey) this.config.serverChanSendKey = String(process.env.BEIJING_PASS_SERVERCHAN_SENDKEY || '').trim();
    try {
      const value = JSON.parse(await readFile(this.applyDefaultsFile, 'utf8'));
      this.applyDefaults = value && typeof value === 'object' ? value : null;
    } catch { this.applyDefaults = null; }
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
    const { stateUrl, stateAuth, ssoUrl, ssoAuth, serverChanSendKey } = this.config;
    return { stateUrl, stateAuth, ssoUrl, ssoAuth, serverChanSendKey, meta: this.meta, monitor: this.publicMonitor() };
  }

  publicMonitor() {
    if (!this.monitor) return null;
    const { status, plate, applyDate, entryType, attempts, startedAt, lastCheckedAt, nextPollAt, lastStatus, lastError, completedAt, notificationStatus } = this.monitor;
    return { status, plate, applyDate, entryType, attempts, maxAttempts: MAX_POLL_ATTEMPTS, startedAt, lastCheckedAt, nextPollAt, lastStatus, lastError, completedAt, notificationStatus };
  }

  startMonitor({ vehicleId, plate, applyDate, entryType }) {
    if (this.monitorTimer) clearTimeout(this.monitorTimer);
    this.monitor = { status: 'active', vehicleId, plate, applyDate, entryType, attempts: 0, startedAt: new Date().toISOString(), lastCheckedAt: '', nextPollAt: new Date(Date.now() + POLL_INTERVAL_MS).toISOString(), lastStatus: '审核中', lastError: '', completedAt: '', notificationStatus: 'pending' };
    this.monitorTimer = setTimeout(() => this.pollMonitor().catch(cause => console.error('进京证轮询失败：', cause.message)), POLL_INTERVAL_MS);
    this.monitorTimer.unref?.();
  }

  scheduleNextPoll() {
    if (!this.monitor || this.monitor.status !== 'active') return;
    this.monitor.nextPollAt = new Date(Date.now() + POLL_INTERVAL_MS).toISOString();
    this.monitorTimer = setTimeout(() => this.pollMonitor().catch(cause => console.error('进京证轮询失败：', cause.message)), POLL_INTERVAL_MS);
    this.monitorTimer.unref?.();
  }

  findMonitoredRecord(data) {
    const vehicles = data?.data?.bzclxx || [];
    const vehicle = vehicles.find(item => String(item.vId) === String(this.monitor?.vehicleId)) || vehicles.find(item => item.hphm === this.monitor?.plate);
    if (!vehicle) return null;
    const records = [...(vehicle.bzxx || []), ...(vehicle.ecbzxx || [])];
    return records.find(record => String(record.jjrq || record.yxqs || '').startsWith(this.monitor.applyDate)) || records[0] || null;
  }

  async pollMonitor() {
    if (this.monitorRunning || !this.monitor || this.monitor.status !== 'active') return;
    this.monitorRunning = true;
    this.monitorTimer = null;
    this.monitor.attempts += 1;
    this.monitor.lastCheckedAt = new Date().toISOString();
    this.monitor.nextPollAt = '';
    try {
      const result = await this.query();
      const record = this.findMonitoredRecord(result.data);
      if (record) {
        const status = String(record.blztmc || record.statusName || record.stateName || '状态未知');
        this.monitor.lastStatus = status;
        this.monitor.lastError = '';
        if (!status.includes('审核中')) return await this.completeMonitor('completed', record);
      } else this.monitor.lastError = '本次查询未找到对应申请记录';
    } catch (cause) { this.monitor.lastError = cause.message; }
    finally { this.monitorRunning = false; }
    if (this.monitor?.status !== 'active') return;
    if (this.monitor.attempts >= MAX_POLL_ATTEMPTS) return this.completeMonitor('stopped');
    this.scheduleNextPoll();
  }

  async completeMonitor(status, record = null) {
    if (!this.monitor || this.monitor.status !== 'active') return;
    this.monitor.status = status;
    this.monitor.completedAt = new Date().toISOString();
    this.monitor.nextPollAt = '';
    if (this.monitorTimer) clearTimeout(this.monitorTimer);
    this.monitorTimer = null;
    await this.notifyMonitor(record);
  }

  async notifyMonitor(record) {
    if (!this.monitor || this.monitor.notificationStatus !== 'pending') return;
    const sendKey = this.config.serverChanSendKey;
    if (!sendKey) { this.monitor.notificationStatus = 'not-configured'; return; }
    this.monitor.notificationStatus = 'sending';
    const stopped = this.monitor.status === 'stopped';
    const finalStatus = stopped ? '轮询已停止，尚未取得最终结果' : this.monitor.lastStatus;
    const reason = record?.shsbyyms || record?.shsbyy || this.monitor.lastError || '';
    const title = stopped ? `进京证查询超时：${this.monitor.plate}` : `进京证审核结果：${this.monitor.plate} ${finalStatus}`;
    const desp = [`- 车辆：${this.monitor.plate}`, `- 状态：${finalStatus}`, `- 生效日期：${this.monitor.applyDate}`, `- 类型：${this.monitor.entryType === '01' ? '六环内' : '六环外'}`, `- 已查询：${this.monitor.attempts}/${MAX_POLL_ATTEMPTS} 次`, reason ? `- 说明：${reason}` : '', `- 检查时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`].filter(Boolean).join('\n');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(`https://sctapi.ftqq.com/${encodeURIComponent(sendKey)}.send`, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, desp }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.code !== 0) throw new Error(data.message || `HTTP ${response.status}`);
      this.monitor.notificationStatus = 'sent';
    } catch (cause) {
      this.monitor.notificationStatus = 'failed';
      this.monitor.lastError = `${this.monitor.lastError ? `${this.monitor.lastError}；` : ''}微信推送失败：${cause.name === 'AbortError' ? '请求超时' : cause.message}`;
    } finally { clearTimeout(timer); }
  }

  shutdown() {
    if (this.monitorTimer) clearTimeout(this.monitorTimer);
    this.monitorTimer = null;
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
          Source: SOURCE,
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

  businessData(response, name) {
    if (response?.code !== 200 && response?.code !== '200') throw httpError(`${name}失败：${response?.msg || response?.message || '未知错误'}`, 502);
    return response.data;
  }

  maskIdentity(value) {
    const text = String(value || '');
    return text.length > 8 ? `${text.slice(0, 4)}********${text.slice(-4)}` : text;
  }

  async prepare() {
    const stateResult = await this.query();
    const baseUrl = new URL(this.config.stateUrl).origin;
    const [vehicleResponse, driverResponse] = await Promise.all([
      this.upstream(`${baseUrl}/pro/vehicleController/getUserIdInfo`, this.config.stateAuth, { method: 'POST', body: {} }),
      this.upstream(`${baseUrl}/pro/applyRecordController/getJsrxx`, this.config.stateAuth, { method: 'POST', body: {} })
    ]);
    const vehicles = this.businessData(vehicleResponse, '读取车辆资料');
    const driver = this.businessData(driverResponse, '读取驾驶人资料') || {};
    const stateData = stateResult.data?.data || {};
    const states = new Map((stateData.bzclxx || []).map(item => [item.hphm, item]));
    return {
      driver: { name: driver.jsrxm || '', identityMasked: this.maskIdentity(driver.jszh), archiveNumberMasked: this.maskIdentity(driver.dabh) },
      vehicles: (Array.isArray(vehicles) ? vehicles : []).map(vehicle => {
        const state = states.get(vehicle.hphm) || {};
        return {
          id: vehicle.vId || '', plate: vehicle.hphm || '', plateType: vehicle.hpzl || '', plateTypeName: vehicle.hpzlmc || '',
          vehicleType: vehicle.cllx || '', vehicleTypeName: vehicle.cllxmc || '', brand: vehicle.ppxh || '', registrationDate: vehicle.zcsj || '',
          engineMasked: this.maskIdentity(vehicle.fdjh), usedTimes: state.ybcs ?? null, remainingTimes: state.sycs ?? '', remainingDays: state.syts ?? '',
          canInner: Boolean(state.ylzsfkb), canOuter: Boolean(state.elzsfkb), cannotApplyReason: state.bnbzyy || '',
          records: [...(state.bzxx || []), ...(state.ecbzxx || [])].map(record => ({ status: record.blztmc || '', validFrom: record.yxqs || '', validTo: record.yxqz || '', applyId: record.applyId || '' }))
        };
      }),
      queryPath: stateResult.path,
      state: { data: stateResult.data, path: stateResult.path, attempts: stateResult.attempts, meta: stateResult.meta },
      destination: this.applyDefaults ? { area: this.applyDefaults.area, address: this.applyDefaults.xxdz, detail: this.applyDefaults.zjxxdz, purpose: this.applyDefaults.jjmdmc } : null,
      capturedFieldsPending: this.applyDefaults ? [] : ['固定目的地配置'],
      submitEnabled: Boolean(this.applyDefaults)
    };
  }

  localDate(offset = 0) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(Date.now() + offset * 86400000));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  async apply(input) {
    if (input?.confirmed !== true) throw httpError('提交办理前必须明确确认');
    if (!this.applyDefaults) throw httpError('尚未配置固定目的地', 409);
    const vehicleId = String(input.vehicleId || '').trim();
    const entryType = String(input.entryType || '');
    const applyDate = String(input.applyDate || '');
    if (!vehicleId || !['01', '02'].includes(entryType)) throw httpError('车辆或进京证类型不正确');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(applyDate) || applyDate < this.localDate() || applyDate > this.localDate(7)) throw httpError('生效日期只能选择今天起 7 天内');

    // 提交前重新查询，避免旧页面重复办理或消耗额度。
    const stateResult = await this.query();
    const stateData = stateResult.data?.data || {};
    const stateVehicle = (stateData.bzclxx || []).find(vehicle => String(vehicle.vId) === vehicleId);
    if (!stateVehicle) throw httpError('状态列表中没有找到所选车辆', 404);
    const records = [...(stateVehicle.bzxx || []), ...(stateVehicle.ecbzxx || [])];
    if (records.some(record => /(审核中|生效中|待生效)/.test(String(record.blztmc || '')))) throw httpError('该车辆已有审核中、生效中或待生效的进京证，不能重复提交', 409);
    if (entryType === '01' && !stateVehicle.ylzsfkb) throw httpError(stateVehicle.bnbzyy || '当前不能办理六环内进京证', 409);
    if (entryType === '02' && !stateVehicle.elzsfkb) throw httpError(stateVehicle.bnbzyy || '当前不能办理六环外进京证', 409);

    const baseUrl = new URL(this.config.stateUrl).origin;
    const [vehicleResponse, driverResponse] = await Promise.all([
      this.upstream(`${baseUrl}/pro/vehicleController/getUserIdInfo`, this.config.stateAuth, { method: 'POST', body: {} }),
      this.upstream(`${baseUrl}/pro/applyRecordController/getJsrxx`, this.config.stateAuth, { method: 'POST', body: {} })
    ]);
    const vehicle = (this.businessData(vehicleResponse, '读取车辆资料') || []).find(item => String(item.vId) === vehicleId);
    const driver = this.businessData(driverResponse, '读取驾驶人资料') || {};
    if (!vehicle) throw httpError('车辆详细资料不存在', 404);
    if (!driver.jsrxm || !driver.jszh) throw httpError('驾驶人资料不完整', 409);
    const fixed = this.applyDefaults;
    const payload = {
      vId: vehicle.vId, hphm: vehicle.hphm, hpzl: vehicle.hpzl,
      ylzsfkb: Boolean(stateVehicle.ylzsfkb), elzsfkb: Boolean(stateVehicle.elzsfkb),
      elzqyms: stateData.elzqyms || '', ylzqyms: stateData.ylzqyms || '', elzmc: stateData.elzmc || '进京证(六环外)', ylzmc: stateData.ylzmc || '进京证(六环内)',
      cllx: vehicle.cllx, jjzzl: entryType, jsrxm: driver.jsrxm, jszh: driver.jszh, dabh: driver.dabh || '', txrxx: [], jjrq: applyDate,
      area: fixed.area, jjdq: fixed.jjdq, xxdz: fixed.xxdz, jjdzgdwd: fixed.jjdzgdwd, jjdzgdjd: fixed.jjdzgdjd,
      jingState: '', jjmd: fixed.jjmd, jjmdmc: fixed.jjmdmc, sqdzgdjd: fixed.sqdzgdjd, sqdzgdwd: fixed.sqdzgdwd, sfzj: '1',
      zjxxdz: fixed.zjxxdz, zjxxdzgdjd: fixed.zjxxdzgdjd, zjxxdzgdwd: fixed.zjxxdzgdwd,
      jjlk: '', jjlkmc: '', jjlkgdjd: '', jjlkgdwd: ''
    };
    const response = await this.upstream(`${baseUrl}/pro//applyRecordController/insertApplyRecord`, this.config.stateAuth, { method: 'POST', body: payload });
    this.businessData(response, '提交办理');
    this.startMonitor({ vehicleId, plate: vehicle.hphm, applyDate, entryType });
    return { success: true, message: response.msg || '信息已提交，正在审核', notices: Array.isArray(response.data?.cgts) ? response.data.cgts : [], monitor: this.publicMonitor() };
  }

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
      credentials.serverChanSendKey = String(input.serverChanSendKey || '').trim();
      if (credentials.serverChanSendKey && (!/^SCT[\w-]+$/.test(credentials.serverChanSendKey) || credentials.serverChanSendKey.length > 256)) throw httpError('Server酱 SendKey 格式不正确');
      this.config = { ...this.config, ...credentials }; this.meta.updatedAt = new Date().toISOString(); await this.save();
      return this.send(res, 200, this.publicConfig());
    }
    if (url.pathname === `${ROOT}/state` && req.method === 'POST') {
      try { return this.send(res, 200, await this.query()); }
      catch (cause) { return this.send(res, cause.status || 502, { error: cause.message, attempts: cause.attempts || [], meta: this.meta }); }
    }
    if (url.pathname === `${ROOT}/prepare` && req.method === 'GET') return this.send(res, 200, await this.prepare());
    if (url.pathname === `${ROOT}/apply` && req.method === 'POST') return this.send(res, 200, await this.apply(await this.body(req)));
    throw httpError('进京证接口不存在', 404);
  }
}
