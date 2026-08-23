import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

const apiPrefix = '/api/modules/xiaoai-assistant';
const categories = new Set(['light', 'aircon', 'scene', 'custom']);

function json(res, status, value) {
  const payload = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload), 'Cache-Control': 'no-store' });
  res.end(payload);
}

function httpError(message, status = 400) { return Object.assign(new Error(message), { status }); }

async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 64 * 1024) throw httpError('请求内容不能超过 64 KB', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw httpError('请求内容不是有效 JSON'); }
}

export class XiaoAiAssistantModule {
  constructor({ dataDir, xiaoAiMusic }) {
    this.dataDir = path.join(dataDir, 'xiaoai-assistant');
    this.dataFile = path.join(this.dataDir, 'state.json');
    this.xiaoAiMusic = xiaoAiMusic;
    this.state = { controls: [], history: {} };
    this.writeQueue = Promise.resolve();
  }

  async initialize() {
    await mkdir(this.dataDir, { recursive: true });
    try { this.state = JSON.parse(await readFile(this.dataFile, 'utf8')); } catch {}
    this.state = {
      controls: Array.isArray(this.state.controls) ? this.state.controls.map(item => this.normalizeControl(item, item.id)).slice(0, 30) : [],
      history: this.state.history && typeof this.state.history === 'object' ? this.state.history : {}
    };
  }

  normalizeControl(input, id = crypto.randomUUID()) {
    const name = String(input.name || '').trim().slice(0, 30);
    const category = categories.has(input.category) ? input.category : 'custom';
    const mode = input.mode === 'action' ? 'action' : 'pair';
    const command = value => String(value || '').trim().slice(0, 200);
    const control = {
      id, name, category, mode,
      onLabel: String(input.onLabel || '开启').trim().slice(0, 10), offLabel: String(input.offLabel || '关闭').trim().slice(0, 10),
      onCommand: command(input.onCommand), offCommand: command(input.offCommand), command: command(input.command)
    };
    if (!name) throw httpError('快捷控制名称不能为空');
    if (mode === 'pair' && (!control.onCommand || !control.offCommand)) throw httpError('开关控制需要填写开启和关闭指令');
    if (mode === 'action' && !control.command) throw httpError('单次执行控制需要填写指令');
    return control;
  }

  history(profileId) {
    if (!Array.isArray(this.state.history[profileId])) this.state.history[profileId] = [];
    return this.state.history[profileId];
  }

  async save() {
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      const temporary = `${this.dataFile}.tmp`;
      await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
      await rename(temporary, this.dataFile);
    });
    return this.writeQueue;
  }

  async handle(req, res, url) {
    if (!url.pathname.startsWith(apiPrefix)) return false;
    if (url.pathname === `${apiPrefix}/state` && req.method === 'GET') {
      json(res, 200, { profiles: await this.xiaoAiMusic.assistantProfiles(), controls: this.state.controls, history: this.state.history }); return true;
    }
    if (url.pathname === `${apiPrefix}/send` && req.method === 'POST') {
      const input = await readBody(req); const mode = input.mode === 'speak' ? 'speak' : 'ask';
      const text = String(input.text || '').trim();
      await this.xiaoAiMusic.assistantCommand(String(input.profileId || ''), mode, text);
      const history = this.history(String(input.profileId || ''));
      const duplicate = history.findIndex(item => item.text === text && item.mode === mode);
      if (duplicate >= 0) history.splice(duplicate, 1);
      history.unshift({ text, mode, usedAt: new Date().toISOString() }); history.splice(5);
      await this.save(); json(res, 200, { success: true, history }); return true;
    }
    if (url.pathname === `${apiPrefix}/execute` && req.method === 'POST') {
      const input = await readBody(req); const control = this.state.controls.find(item => item.id === input.controlId);
      if (!control) throw httpError('快捷控制不存在', 404);
      const command = control.mode === 'action' ? control.command : input.operation === 'off' ? control.offCommand : control.onCommand;
      await this.xiaoAiMusic.assistantCommand(String(input.profileId || ''), 'ask', command);
      json(res, 200, { success: true }); return true;
    }
    if (url.pathname === `${apiPrefix}/volume` && req.method === 'POST') {
      const input = await readBody(req);
      const result = await this.xiaoAiMusic.assistantVolume(String(input.profileId || ''), input.volume);
      json(res, 200, result); return true;
    }
    if (url.pathname === `${apiPrefix}/controls` && req.method === 'POST') {
      if (this.state.controls.length >= 30) throw httpError('最多配置 30 个快捷控制');
      const control = this.normalizeControl(await readBody(req)); this.state.controls.push(control); await this.save(); json(res, 201, { control }); return true;
    }
    const controlMatch = url.pathname.match(/^\/api\/modules\/xiaoai-assistant\/controls\/([^/]+)$/);
    if (controlMatch && ['PUT', 'DELETE'].includes(req.method)) {
      const id = decodeURIComponent(controlMatch[1]); const index = this.state.controls.findIndex(item => item.id === id);
      if (index < 0) throw httpError('快捷控制不存在', 404);
      if (req.method === 'DELETE') this.state.controls.splice(index, 1);
      else this.state.controls[index] = this.normalizeControl(await readBody(req), id);
      await this.save(); json(res, 200, { controls: this.state.controls }); return true;
    }
    const historyMatch = url.pathname.match(/^\/api\/modules\/xiaoai-assistant\/history\/([^/]+)$/);
    if (historyMatch && req.method === 'DELETE') {
      this.history(decodeURIComponent(historyMatch[1])).splice(0); await this.save(); json(res, 200, { history: [] }); return true;
    }
    json(res, 405, { error: '请求方法不支持' }); return true;
  }
}
