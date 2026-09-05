import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import { WebSocketServer } from 'ws';
import * as pty from 'node-pty';

const execFileAsync = promisify(execFile);
const sessionPrefix = 'allinone-';

function httpError(message, status = 400) { return Object.assign(new Error(message), { status }); }

export class TerminalModule {
  constructor({ roots, isAuthenticated, isAllowedOrigin }) {
    this.roots = roots;
    this.isAuthenticated = isAuthenticated;
    this.isAllowedOrigin = isAllowedOrigin;
    this.enabled = String(process.env.TERMINAL_ENABLED || '').toLowerCase() === 'true';
    this.maxSessions = Math.max(1, Math.min(20, Number(process.env.TERMINAL_MAX_SESSIONS || 8)));
    this.defaultCwd = process.env.TERMINAL_CWD?.trim() || roots[0]?.path || os.homedir();
    this.clients = new Set();
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
  }

  send(res, status, value) {
    const body = JSON.stringify(value);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
    res.end(body);
    return true;
  }

  cleanName(value) {
    const name = String(value || '').trim();
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) throw httpError('会话名仅支持 1–32 位字母、数字、下划线和短横线');
    return name;
  }

  async available() {
    if (!this.enabled) return { enabled: false, ready: false, error: '终端功能尚未开启' };
    try {
      await execFileAsync('tmux', ['-V'], { timeout: 1500 });
      return { enabled: true, ready: true, error: '' };
    } catch {
      return { enabled: true, ready: false, error: '服务器未安装 tmux' };
    }
  }

  async sessions() {
    const status = await this.available();
    if (!status.ready) return [];
    try {
      const { stdout } = await execFileAsync('tmux', ['list-sessions', '-F', '#{session_name}\t#{session_windows}\t#{session_attached}\t#{session_created}\t#{session_activity}'], { timeout: 2000 });
      return stdout.trim().split('\n').filter(Boolean).map(line => {
        const [fullName, windows, attached, created, activity] = line.split('\t');
        if (!fullName.startsWith(sessionPrefix)) return null;
        return { name: fullName.slice(sessionPrefix.length), windows: Number(windows), attached: Number(attached), createdAt: Number(created) * 1000, activeAt: Number(activity) * 1000 };
      }).filter(Boolean).sort((a, b) => b.activeAt - a.activeAt);
    } catch (cause) {
      if (cause.code === 1) return [];
      throw cause;
    }
  }

  async handle(req, res, url) {
    const root = '/api/modules/terminal';
    if (!url.pathname.startsWith(root)) return false;
    if (url.pathname === `${root}/status` && req.method === 'GET') {
      const status = await this.available();
      return this.send(res, 200, { ...status, sessions: await this.sessions(), maxSessions: this.maxSessions });
    }
    const match = url.pathname.match(new RegExp(`^${root}/sessions/([^/]+)$`));
    if (match && req.method === 'DELETE') {
      if (!(await this.available()).ready) throw httpError('终端当前不可用', 503);
      const name = this.cleanName(decodeURIComponent(match[1]));
      try { await execFileAsync('tmux', ['kill-session', '-t', `${sessionPrefix}${name}`], { timeout: 2000 }); }
      catch (cause) { if (cause.code === 1) throw httpError('会话不存在', 404); throw cause; }
      return this.send(res, 200, { success: true, sessions: await this.sessions() });
    }
    throw httpError('终端接口不存在', 404);
  }

  attach(server) {
    server.on('upgrade', (req, socket, head) => {
      let url;
      try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); } catch { socket.destroy(); return; }
      if (url.pathname !== '/api/modules/terminal/connect') return;
      if (!this.enabled || !this.isAuthenticated(req, url) || !this.isAllowedOrigin(req)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
      }
      this.wss.handleUpgrade(req, socket, head, ws => this.wss.emit('connection', ws, req, url));
    });
    this.wss.on('connection', (ws, req, url) => this.connect(ws, url));
  }

  async connect(ws, url) {
    let terminal;
    try {
      const status = await this.available();
      if (!status.ready) throw new Error(status.error);
      const name = this.cleanName(url.searchParams.get('session') || 'main');
      const existing = await this.sessions();
      const exists = existing.some(item => item.name === name);
      if (!exists && existing.length >= this.maxSessions) throw new Error(`最多创建 ${this.maxSessions} 个会话`);
      const fullName = `${sessionPrefix}${name}`;
      if (!exists) {
        try { await execFileAsync('tmux', ['new-session', '-d', '-s', fullName, '-c', this.defaultCwd], { timeout: 2000 }); }
        catch (cause) { if (cause.code !== 1) throw cause; }
      }
      // 用户级 tmux 配置可能开启 destroy-unattached；模块会话必须在网页断线后继续运行。
      await execFileAsync('tmux', ['set-option', '-t', fullName, 'destroy-unattached', 'off'], { timeout: 2000 });
      const cols = Math.max(20, Math.min(400, Number(url.searchParams.get('cols') || 80)));
      const rows = Math.max(5, Math.min(200, Number(url.searchParams.get('rows') || 24)));
      terminal = pty.spawn('tmux', ['attach-session', '-t', fullName], {
        name: 'xterm-256color', cols, rows, cwd: this.defaultCwd,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
      });
      this.clients.add(terminal);
      ws.send(JSON.stringify({ type: 'ready', session: name }));
      const output = terminal.onData(data => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'output', data })); });
      terminal.onExit(({ exitCode }) => {
        output.dispose(); this.clients.delete(terminal);
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'exit', exitCode }));
        ws.close();
      });
      ws.on('message', raw => {
        if (raw.length > 64 * 1024) return ws.close(1009, '消息过大');
        try {
          const message = JSON.parse(raw.toString());
          if (message.type === 'input' && typeof message.data === 'string') terminal.write(message.data.slice(0, 65536));
          if (message.type === 'resize') terminal.resize(Math.max(20, Math.min(400, Number(message.cols))), Math.max(5, Math.min(200, Number(message.rows))));
          if (message.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
        } catch { ws.close(1003, '消息格式不正确'); }
      });
      ws.on('close', () => { try { terminal.kill(); } catch {} });
    } catch (cause) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'error', message: cause.message || '终端连接失败' }));
      ws.close();
    }
  }

  shutdown() {
    for (const terminal of this.clients) { try { terminal.kill(); } catch {} }
    this.clients.clear();
    this.wss.close();
  }
}
