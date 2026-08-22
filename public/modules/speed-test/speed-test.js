const speedState = { running: false, controller: null };
const speedNode = id => document.getElementById(id);
// 模块独立解析接口地址，避免托管 Preview 中脚本加载顺序影响请求目标。
const speedPreviewApiBases = { 'devstudio.xuekai.top': 'https://aio.xuekai.top:8888' };
const speedApiBase = speedPreviewApiBases[window.location.hostname]
  || (window.location.port === '8787' ? `${window.location.protocol}//${window.location.hostname}:2006` : '');
const speedEndpoint = path => `${speedApiBase}/api/modules/speed-test/${path}`;

function formatSpeed(bitsPerSecond) {
  if (!Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) return '--';
  const megabytesPerSecond = bitsPerSecond / 8 / 1024 / 1024;
  return `${megabytesPerSecond.toFixed(megabytesPerSecond >= 10 ? 1 : 2)} MB/s`;
}

function setPhase(name, value, detail, active = false) {
  speedNode(`speed-${name}-value`).textContent = value;
  speedNode(`speed-${name}-detail`).textContent = detail;
  speedNode(`speed-${name}-card`).classList.toggle('testing', active);
}

async function measureDownload(controller) {
  const started = performance.now();
  let bytes = 0;
  let rounds = 0;
  while (performance.now() - started < 4000 && rounds < 8) {
    const size = rounds ? 8 * 1024 * 1024 : 2 * 1024 * 1024;
    const response = await fetch(`${speedEndpoint('download')}?bytes=${size}&r=${crypto.randomUUID()}`, { credentials: 'include', cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`下载测速失败（${response.status}）`);
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      setPhase('download', formatSpeed(bytes * 8 / ((performance.now() - started) / 1000)), `已接收 ${(bytes / 1048576).toFixed(1)} MB`, true);
    }
    rounds += 1;
  }
  const seconds = (performance.now() - started) / 1000;
  return { speed: bytes * 8 / seconds, bytes, seconds };
}

async function measureUpload(controller) {
  const block = new Uint8Array(4 * 1024 * 1024);
  for (let offset = 0; offset < block.length; offset += 65536) crypto.getRandomValues(block.subarray(offset, offset + 65536));
  const started = performance.now();
  let bytes = 0;
  let rounds = 0;
  while (performance.now() - started < 4000 && rounds < 8) {
    const response = await fetch(`${speedEndpoint('upload')}?r=${crypto.randomUUID()}`, { method: 'POST', body: block, credentials: 'include', cache: 'no-store', signal: controller.signal, headers: { 'Content-Type': 'application/octet-stream' } });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || `上传测速失败（${response.status}）`);
    bytes += block.byteLength;
    rounds += 1;
    setPhase('upload', formatSpeed(bytes * 8 / ((performance.now() - started) / 1000)), `已发送 ${(bytes / 1048576).toFixed(1)} MB`, true);
  }
  const seconds = (performance.now() - started) / 1000;
  return { speed: bytes * 8 / seconds, bytes, seconds };
}

async function startSpeedTest() {
  if (speedState.running) return speedState.controller?.abort();
  speedState.running = true;
  speedState.controller = new AbortController();
  const button = speedNode('speed-start');
  button.textContent = '停止测试'; button.classList.add('danger');
  speedNode('speed-status').textContent = '正在测试下载速度…';
  setPhase('download', '准备中', '正在建立连接', true); setPhase('upload', '--', '等待下载测试完成');
  try {
    const down = await measureDownload(speedState.controller);
    setPhase('download', formatSpeed(down.speed), `${(down.bytes / 1048576).toFixed(1)} MB · ${down.seconds.toFixed(1)} 秒`);
    speedNode('speed-status').textContent = '正在测试上传速度…'; setPhase('upload', '准备中', '正在生成测试数据', true);
    const up = await measureUpload(speedState.controller);
    setPhase('upload', formatSpeed(up.speed), `${(up.bytes / 1048576).toFixed(1)} MB · ${up.seconds.toFixed(1)} 秒`);
    speedNode('speed-status').textContent = `测试完成 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (error) {
    speedNode('speed-status').textContent = error.name === 'AbortError' ? '测试已停止' : error.message;
    document.querySelectorAll('.speed-result-card').forEach(card => card.classList.remove('testing'));
  } finally {
    speedState.running = false; speedState.controller = null; button.textContent = '开始测速'; button.classList.remove('danger');
  }
}

speedNode('speed-start').addEventListener('click', startSpeedTest);
