import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

const error = (message, status = 409) => Object.assign(new Error(message), { status });
const statusOf = record => String(record.blztmc || record.statusName || record.stateName || '');
export function permitDate(value) {
  const match = String(value || '').match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\D|$)/);
  if (!match) return '';
  const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const parsed = new Date(`${date}T00:00:00+08:00`);
  return Number.isFinite(parsed.getTime()) && new Date(parsed.getTime() + 8 * 3600000).toISOString().slice(0, 10) === date ? date : '';
}

export function permitDecision(vehicle, applyDate) {
  if ((!('bzxx' in vehicle) && !('ecbzxx' in vehicle)) || [vehicle.bzxx, vehicle.ecbzxx].some(records => records != null && !Array.isArray(records))) return { kind: 'unknown', reason: '进京证记录格式异常，无法确认是否需要申请' };
  const records = [...(vehicle.bzxx || []), ...(vehicle.ecbzxx || [])];
  let unknown = false;
  for (const record of records) {
    if (!record || typeof record !== 'object') { unknown = true; continue; }
    const status = statusOf(record);
    if (/(审核中|办理中|审批中|待审核|申请中)/.test(status)) return { kind: 'pending', reason: '已有正在审核或办理的申请，本次不重复提交' };
    if (/(失败|驳回|不通过|未通过|作废|撤销|取消|过期|失效|到期|无效)/.test(status)) continue;
    const start = permitDate(record.yxqs || record.jjrq), end = permitDate(record.yxqz);
    if (!start || !end || end < start) { unknown = true; continue; }
    if (end < applyDate) continue;
    if (/(生效中|待生效|有效|审核通过|审批通过|办理成功|已办结)/.test(status)) {
      if (start <= applyDate) return { kind: 'covered', reason: `已有覆盖 ${applyDate} 的进京证（有效至 ${end}）` };
      return { kind: 'pending', reason: `已有 ${start} 起生效的进京证，本次不重复提交` };
    }
    unknown = true;
  }
  return unknown ? { kind: 'unknown', reason: '存在无法确认的证件状态或有效期，本次不自动提交' } : { kind: 'needed', reason: '进京证已到期、今天为最后一天或当前无有效证件，需要申请次日进京证' };
}

export class BeijingPassAutomation {
  constructor(owner) {
    this.owner = owner;
    this.file = path.join(owner.dir, 'automation.json');
    this.state = { enabled: false, vehicleId: '', entryType: '01', lastScheduledDate: '', lastRun: null, attempts: {} };
    this.running = false;
    this.configuring = false;
    this.stopped = false;
    this.timer = null;
    this.writeQueue = Promise.resolve();
    this.loadError = '';
  }

  async initialize() {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      if (typeof saved.enabled !== 'boolean' || typeof saved.vehicleId !== 'string' || !['01', '02'].includes(saved.entryType) || !saved.attempts || typeof saved.attempts !== 'object' || Array.isArray(saved.attempts)) throw new Error('自动申请配置格式异常');
      this.state = { ...this.state, ...saved };
    } catch (cause) {
      if (cause.code !== 'ENOENT') { this.loadError = `自动申请配置读取失败：${cause.message}`; console.error(this.loadError); }
    }
    if (!this.loadError) {
      if (this.state.lastRun && !this.state.lastRun.completedAt) {
        this.state.lastRun.status = 'interrupted';
        this.state.lastRun.message = '上次检测因服务重启中断；已记录的申请不会再次自动提交，请查询实际状态';
        this.state.lastRun.completedAt = new Date().toISOString();
        try { await this.notify(this.state.lastRun, '进京证检测中断提醒'); await this.save(); }
        catch (cause) { this.loadError = `检测状态恢复失败：${cause.message}`; console.error(this.loadError); }
      }
      this.schedule();
    }
  }

  save() {
    const content = `${JSON.stringify(this.state, null, 2)}\n`;
    const operation = this.writeQueue.then(async () => {
      await mkdir(this.owner.dir, { recursive: true });
      await writeFile(`${this.file}.tmp`, content, { mode: 0o600 });
      await rename(`${this.file}.tmp`, this.file);
    });
    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  nextTime() {
    const today = this.owner.localDate();
    const tonight = new Date(`${today}T22:00:00+08:00`).getTime();
    if (Date.now() < tonight) return tonight;
    if (this.state.lastScheduledDate !== today) return tonight;
    return new Date(`${this.owner.localDate(1)}T22:00:00+08:00`).getTime();
  }

  publicState() {
    return { enabled: this.state.enabled, vehicleId: this.state.vehicleId, entryType: this.state.entryType, running: this.running, lastRun: this.state.lastRun, error: this.loadError, nextCheckAt: this.stopped || this.loadError ? '' : new Date(this.nextTime()).toISOString(), notificationConfigured: Boolean(this.owner.config.serverChanSendKey) };
  }

  schedule() {
    if (this.stopped || this.loadError) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      try { if (Date.now() >= this.nextTime() && !this.running) await this.run(true); }
      catch (cause) { console.error('进京证定时检测失败：', cause.message); }
      finally { this.schedule(); }
    }, Math.max(1000, Math.min(60_000, this.nextTime() - Date.now())));
    this.timer.unref?.();
  }

  shutdown() { this.stopped = true; clearTimeout(this.timer); }

  async configure(input) {
    if (this.loadError) throw error(this.loadError);
    if (this.running || this.configuring) throw error('正在检测或保存，请完成后再修改设置');
    if (typeof input?.enabled !== 'boolean' || !['01', '02'].includes(input.entryType) || typeof input.vehicleId !== 'string' || input.vehicleId.length > 100) throw error('自动申请设置不正确', 400);
    if (input.enabled) {
      if (!input.vehicleId.trim()) throw error('请先选择自动申请车辆');
      if (!this.owner.applyDefaults) throw error('请先配置固定目的地');
      if (!this.owner.config.serverChanSendKey) throw error('请先在接口配置中填写 Server酱 SendKey，以接收微信提醒');
    }
    const previous = this.state;
    this.configuring = true;
    this.state = { ...previous, enabled: input.enabled, vehicleId: input.vehicleId.trim(), entryType: input.entryType };
    try { await this.save(); } catch (cause) { this.state = previous; throw cause; }
    finally { this.configuring = false; }
    return this.publicState();
  }

  async notify(run, title) {
    const result = await this.owner.sendNotification(title, [`- 车辆：${run.plate || '未确定'}`, `- 自动申请：${this.state.enabled ? '已开启' : '未开启'}`, `- 申请日期：${run.applyDate}`, `- 类型：${this.state.entryType === '01' ? '六环内' : '六环外'}`, `- 检测结果：${run.message}`, `- 检测时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`].join('\n'));
    run.notificationStatus = result.status;
    run.notificationError = result.error || '';
  }

  async run(scheduled = false) {
    if (this.loadError) throw error(this.loadError);
    if (this.running || this.configuring) throw error('检测或设置保存正在进行，请稍后查看结果');
    this.running = true;
    const today = this.owner.localDate(), applyDate = this.owner.localDate(1);
    const run = { startedAt: new Date().toISOString(), completedAt: '', applyDate, source: scheduled ? 'scheduled' : 'manual', status: 'checking', message: '正在检测', notificationStatus: 'none' };
    try {
      if (scheduled) this.state.lastScheduledDate = today;
      this.state.lastRun = run;
      await this.save();
      const result = await this.owner.query();
      const vehicles = result.data?.data?.bzclxx;
      if (!Array.isArray(vehicles)) throw error('状态接口返回异常，无法确认车辆和证件状态');
      const vehicle = this.state.vehicleId ? vehicles.find(item => String(item.vId) === this.state.vehicleId) : vehicles.length === 1 ? vehicles[0] : null;
      if (!vehicle) throw error(vehicles.length ? '请在自动申请设置中选择检测车辆' : '账号下未查询到车辆，无法自动申请');
      run.plate = vehicle.hphm;
      const decision = permitDecision(vehicle, applyDate);
      run.status = decision.kind;
      run.message = decision.reason;
      if (decision.kind === 'unknown') throw error(decision.reason);
      if (decision.kind !== 'needed') {
        run.notificationStatus = 'not-needed';
      } else if (!this.state.enabled) {
        run.status = 'disabled';
        run.message += '；自动申请未开启，未提交申请，请手动办理或开启自动申请';
        await this.notify(run, '进京证续办提醒：自动申请未开启');
      } else {
        const key = `${vehicle.vId}:${this.state.entryType}:${applyDate}`;
        if (this.state.attempts[key]) {
          run.status = 'already-attempted';
          run.message = '该车辆和日期已经尝试自动申请，不重复提交；请查询审核状态';
          await this.notify(run, `进京证申请状态提醒：${run.plate}`);
        } else {
          // 先持久化尝试记录，防止超时、重启或重复点击再次提交。
          this.state.attempts = Object.fromEntries(Object.entries(this.state.attempts).filter(([, date]) => date >= today));
          this.state.attempts[key] = applyDate;
          await this.save();
          const applied = await this.owner.apply({ confirmed: true, vehicleId: String(vehicle.vId), entryType: this.state.entryType, applyDate });
          run.status = 'submitted';
          run.message = `${applied.message}；后台每分钟检查审核结果，最多 15 次，结束后发送微信提醒`;
          await this.notify(run, `进京证自动申请已提交：${run.plate}`);
        }
      }
    } catch (cause) {
      run.status = 'failed';
      run.message = `${cause.message}；未确认申请成功，请查询状态${this.state.enabled ? '' : '；自动申请未开启'}`;
      console.error('进京证检测失败：', cause.message);
      await this.notify(run, '进京证检测或自动申请失败');
    } finally {
      run.completedAt = new Date().toISOString();
      try { await this.save(); } finally { this.running = false; }
    }
    return this.publicState();
  }
}
