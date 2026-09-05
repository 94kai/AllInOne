const view = document.querySelector('#terminal-view');
if (view) {
  const screen = document.querySelector('#terminal-screen');
  const empty = document.querySelector('#terminal-empty');
  const sessionSelect = document.querySelector('#terminal-session');
  const connection = document.querySelector('#terminal-connection');
  const dot = document.querySelector('#terminal-dot');
  const keyboard = document.querySelector('#terminal-keyboard');
  const fontKey = 'allinone-terminal-font-size';
  let socket = null, reconnectTimer = 0, reconnectAttempts = 0;
  let ctrlPending = false, altPending = false, shiftPending = false, symbolLayer = false;
  let fontSize = Math.max(11, Math.min(24, Number(localStorage.getItem(fontKey) || 14)));

  const terminal = new window.Terminal({
    cursorBlink: true, cursorStyle: 'block', fontSize, scrollback: 6000,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    theme: { background: '#0f141a', foreground: '#d9e2ec', cursor: '#7db7ff', selectionBackground: '#4c6d9155', black: '#151b22', brightBlack: '#617080' },
    allowProposedApi: false
  });
  const fit = new window.FitAddon.FitAddon();
  terminal.loadAddon(fit);
  terminal.loadAddon(new window.WebLinksAddon.WebLinksAddon());
  terminal.open(screen);
  // 手机和平板只使用页面内键盘，桌面仍可使用物理键盘。
  if (matchMedia('(pointer: coarse)').matches) {
    terminal.textarea.inputMode = 'none';
    terminal.textarea.readOnly = true;
    terminal.textarea.setAttribute('virtualkeyboardpolicy', 'manual');
  }

  function active() { return view.classList.contains('active'); }
  function setState(text, connected = false) {
    connection.textContent = text;
    dot.classList.toggle('connected', connected);
    empty.hidden = connected;
  }
  function wsUrl() {
    const base = window.allinoneApiBase || location.origin;
    const url = new URL('/api/modules/terminal/connect', base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('session', sessionSelect.value || 'main');
    url.searchParams.set('cols', String(terminal.cols));
    url.searchParams.set('rows', String(terminal.rows));
    return url;
  }
  function send(data) {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type: 'input', data }));
    return true;
  }
  function disconnect() {
    clearTimeout(reconnectTimer);
    if (socket) { socket.onclose = null; socket.close(); socket = null; }
    setState('已断开');
  }
  function scheduleReconnect() {
    if (!active()) return;
    const delay = Math.min(10000, 800 * 2 ** Math.min(reconnectAttempts++, 4));
    setState(`${Math.ceil(delay / 1000)} 秒后重连…`);
    clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, delay);
  }
  function connect() {
    if (!active()) return;
    disconnect();
    requestAnimationFrame(() => { try { fit.fit(); } catch {} });
    setState('正在连接…'); empty.hidden = false;
    const current = new WebSocket(wsUrl()); socket = current;
    current.onmessage = event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'ready') {
        reconnectAttempts = 0; setState(`已连接 · ${message.session}`, true); loadStatus();
      } else if (message.type === 'output') terminal.write(message.data);
      else if (message.type === 'error') { empty.textContent = message.message; setState(message.message); }
      else if (message.type === 'exit') setState(`会话连接已结束（${message.exitCode}）`);
    };
    current.onerror = () => setState('连接失败');
    current.onclose = () => { if (socket === current) { socket = null; scheduleReconnect(); } };
  }
  async function loadStatus() {
    try {
      const response = await fetch(`${window.allinoneApiBase || ''}/api/modules/terminal/status`, { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '读取终端状态失败');
      const current = sessionSelect.value || localStorage.getItem('allinone-terminal-session') || 'main';
      const names = [...new Set([current, ...data.sessions.map(item => item.name)])];
      sessionSelect.innerHTML = names.map(name => `<option value="${name.replace(/[&<>"']/g, '')}">${name}</option>`).join('');
      sessionSelect.value = current;
      if (!data.ready) { empty.hidden = false; empty.textContent = `${data.error}。请设置 TERMINAL_ENABLED=true 并确认已安装 tmux。`; setState(data.error); }
      return data;
    } catch (cause) { empty.hidden = false; empty.textContent = cause.message; setState(cause.message); return null; }
  }
  function activate() {
    document.body.classList.add('terminal-active');
    empty.textContent = '正在准备终端…';
    loadStatus().then(status => { if (status?.ready && !socket) connect(); });
    requestAnimationFrame(() => fit.fit());
  }
  function deactivate() { document.body.classList.remove('terminal-active'); disconnect(); }

  terminal.onData(data => {
    if (ctrlPending && data.length === 1) {
      const character = data.toUpperCase();
      const code = character.charCodeAt(0);
      if (code >= 64 && code <= 95) data = String.fromCharCode(code - 64);
      ctrlPending = false; renderKeyboard();
    }
    send(data);
  });
  terminal.onResize(({ cols, rows }) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resize', cols, rows }));
  });

  function decodeKey(value) {
    return value.replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/\\r/g, '\r').replace(/\\t/g, '\t');
  }
  view.addEventListener('click', event => {
    const key = event.target.closest('[data-terminal-send]');
    if (key) send(decodeKey(key.dataset.terminalSend));
  });
  sessionSelect.addEventListener('change', () => { localStorage.setItem('allinone-terminal-session', sessionSelect.value); terminal.clear(); connect(); });
  document.querySelector('#terminal-reconnect').addEventListener('click', () => { reconnectAttempts = 0; connect(); });
  document.querySelector('#terminal-new').addEventListener('click', () => {
    const name = prompt('新会话名称（字母、数字、_ 或 -）', 'vim');
    if (!name) return;
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) return alert('会话名格式不正确');
    if (![...sessionSelect.options].some(option => option.value === name)) sessionSelect.add(new Option(name, name));
    sessionSelect.value = name; sessionSelect.dispatchEvent(new Event('change'));
  });
  document.querySelector('#terminal-delete').addEventListener('click', async () => {
    const name = sessionSelect.value;
    if (!confirm(`关闭并永久结束终端会话“${name}”？其中运行的程序也会终止。`)) return;
    try {
      const response = await fetch(`${window.allinoneApiBase || ''}/api/modules/terminal/sessions/${encodeURIComponent(name)}`, { method: 'DELETE', credentials: 'include' });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '关闭失败');
      disconnect(); sessionSelect.value = data.sessions[0]?.name || 'main'; await loadStatus(); connect();
    } catch (cause) { alert(cause.message); }
  });
  document.querySelector('#terminal-paste').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      if ((text.match(/\n/g) || []).length > 0 && !confirm(`将粘贴 ${text.split(/\r?\n/).length} 行内容，可能直接执行命令。继续吗？`)) return;
      send(`\u001b[200~${text}\u001b[201~`);
    } catch { alert('浏览器未允许读取剪贴板，请长按终端使用系统粘贴。'); }
  });
  function changeFont(delta) {
    fontSize = Math.max(11, Math.min(24, fontSize + delta)); terminal.options.fontSize = fontSize;
    localStorage.setItem(fontKey, String(fontSize)); requestAnimationFrame(() => fit.fit());
  }
  document.querySelector('#terminal-font-down').addEventListener('click', () => changeFont(-1));
  document.querySelector('#terminal-font-up').addEventListener('click', () => changeFont(1));

  const shiftedKeys = { '`': '~', '1': '!', '2': '@', '3': '#', '4': '$', '5': '%', '6': '^', '7': '&', '8': '*', '9': '(', '0': ')', '-': '_', '=': '+', '[': '{', ']': '}', '\\': '|', ';': ':', "'": '"', ',': '<', '.': '>', '/': '?' };
  // 标点位置与标准电脑键盘一致，Vim 中无需切层即可输入常用命令。
  const letterRows = [['`','1','2','3','4','5','6','7','8','9','0','-','='], ['q','w','e','r','t','y','u','i','o','p','[',']','\\'], ['a','s','d','f','g','h','j','k','l',';',"'"], ['z','x','c','v','b','n','m',',','.','/']];
  const symbolRows = [['`','~','!','@','#','$','%','^','&','*'], ['(',')','-','_','=','+','[',']','{','}'], [';',':',"'",'"',',','.','<','>','?','/'], ['\\','|','&','*','+','-','_','=']];
  const escapeKey = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  function keyButton(label, action, value = '', classes = '') {
    return `<button type="button" class="terminal-kb-key ${classes}" data-kb-action="${action}" data-kb-value="${escapeKey(value)}">${escapeKey(label)}</button>`;
  }
  function renderKeyboard() {
    const rows = symbolLayer ? symbolRows : letterRows;
    const html = rows.map((row, rowIndex) => {
      const keys = row.map(key => {
        let value = key;
        if (!symbolLayer && shiftPending) value = shiftedKeys[key] || key.toUpperCase();
        return keyButton(value, 'send', value);
      });
      if (rowIndex === 0) keys.push(keyButton('⌫', 'send', '\\u007f', 'function wide repeat'));
      if (rowIndex === 1) keys.unshift(keyButton('Tab', 'send', '\\t', 'function wide'));
      if (rowIndex === 2) keys.push(keyButton('Enter', 'send', '\\r', 'enter'));
      if (rowIndex === 3 && !symbolLayer) {
        keys.unshift(keyButton(shiftPending ? '⇧' : 'Shift', 'shift', '', `function wide modifier${shiftPending ? ' active' : ''}`));
      }
      return `<div class="terminal-kb-row">${keys.join('')}</div>`;
    });
    const arrows = ['←','↓','↑','→'].map((label, index) => keyButton(label, 'send', ['\\u001b[D','\\u001b[B','\\u001b[A','\\u001b[C'][index], 'function repeat')).join('');
    html.push(`<div class="terminal-kb-row">${keyButton(symbolLayer ? 'ABC' : '#+=', 'symbols', '', `function wide modifier${symbolLayer ? ' active' : ''}`)}${keyButton('Ctrl', 'ctrl', '', `function modifier${ctrlPending ? ' active' : ''}`)}${keyButton('Alt', 'alt', '', `function modifier${altPending ? ' active' : ''}`)}${keyButton('Space', 'send', ' ', 'space')}${arrows}</div>`);
    keyboard.innerHTML = html.join('');
  }
  function pressKeyboardKey(button) {
    const action = button.dataset.kbAction;
    if (action === 'shift') { shiftPending = !shiftPending; renderKeyboard(); return; }
    if (action === 'symbols') { symbolLayer = !symbolLayer; shiftPending = false; renderKeyboard(); return; }
    if (action === 'ctrl') { ctrlPending = !ctrlPending; renderKeyboard(); return; }
    if (action === 'alt') { altPending = !altPending; renderKeyboard(); return; }
    let value = decodeKey(button.dataset.kbValue || '');
    if (ctrlPending && value.length === 1) {
      const code = value.toUpperCase().charCodeAt(0);
      if (code >= 64 && code <= 95) value = String.fromCharCode(code - 64);
    }
    if (altPending) value = `\u001b${value}`;
    send(value);
    if (ctrlPending || altPending || shiftPending) {
      ctrlPending = false; altPending = false; shiftPending = false; renderKeyboard();
    }
  }
  let repeatDelay = 0, repeatTimer = 0;
  function stopRepeat() { clearTimeout(repeatDelay); clearInterval(repeatTimer); repeatDelay = 0; repeatTimer = 0; }
  keyboard.addEventListener('pointerdown', event => {
    const button = event.target.closest('.terminal-kb-key');
    if (!button) return;
    event.preventDefault(); button.classList.add('pressed'); pressKeyboardKey(button);
    if (button.classList.contains('repeat')) repeatDelay = setTimeout(() => { repeatTimer = setInterval(() => pressKeyboardKey(button), 65); }, 380);
  });
  ['pointerup','pointercancel','pointerleave'].forEach(type => keyboard.addEventListener(type, event => {
    event.target.closest?.('.terminal-kb-key')?.classList.remove('pressed'); stopRepeat();
  }));
  keyboard.addEventListener('click', event => {
    if (event.detail !== 0) return;
    const button = event.target.closest('.terminal-kb-key'); if (button) pressKeyboardKey(button);
  });
  renderKeyboard();

  // Android 浏览器的布局视口不会总随软键盘缩小，直接使用 visualViewport 保证快捷栏留在键盘上方。
  const resize = () => {
    const viewport = window.visualViewport;
    document.documentElement.style.setProperty('--terminal-viewport-height', `${Math.round(viewport?.height || window.innerHeight)}px`);
    document.documentElement.style.setProperty('--terminal-viewport-top', `${Math.round(viewport?.offsetTop || 0)}px`);
    if (active()) requestAnimationFrame(() => { try { fit.fit(); } catch {} });
  };
  new ResizeObserver(resize).observe(screen);
  window.visualViewport?.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('scroll', resize);

  // xterm 在部分 Android WebView 中不会产生惯性滚动，单指纵向拖动时按终端行滚动。
  let touchY = 0, touchRemainder = 0, touchMoved = false;
  screen.addEventListener('touchstart', event => {
    if (event.touches.length !== 1) return;
    touchY = event.touches[0].clientY; touchRemainder = 0; touchMoved = false;
  }, { passive: true });
  screen.addEventListener('touchmove', event => {
    if (event.touches.length !== 1) return;
    const nextY = event.touches[0].clientY;
    touchRemainder += touchY - nextY; touchY = nextY;
    const lineHeight = Math.max(12, fontSize * 1.2);
    const lines = touchRemainder > 0 ? Math.floor(touchRemainder / lineHeight) : Math.ceil(touchRemainder / lineHeight);
    if (!lines) return;
    terminal.scrollLines(lines); touchRemainder -= lines * lineHeight; touchMoved = true;
    event.preventDefault();
  }, { passive: false });
  screen.addEventListener('touchend', event => {
    if (touchMoved) event.preventDefault();
  }, { passive: false });
  resize();
  new MutationObserver(() => active() ? activate() : deactivate()).observe(view, { attributes: true, attributeFilter: ['class'] });
  if (active()) activate();
}
