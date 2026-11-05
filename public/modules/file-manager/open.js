const $ = selector => document.querySelector(selector);
const parameters = new URLSearchParams(location.search);
const root = parameters.get('root') || '';
const path = parameters.get('path') || '';
const labels = { title: '歌曲', artists: '歌手', album: '专辑', netease_query_status: '查询结果', source_query_status: '查询结果', genres: '风格', name: '分类', tracks: '歌曲数', basis: '推断依据', confidence: '置信度', support_count: '参考曲目数', risk: '说明', is_inferred: '是否推断', added: '新增曲风', new: '当前曲风', sources: '来源', risk_flags: '备注' };
let rows = [], headings = [], visibleColumns = [], filtered = [], shown = 100;

function status(message, error = false) {
  $('#status').textContent = message;
  $('#status').classList.toggle('error', error);
}

// CSV 的引号内可以含逗号、换行和转义引号，不能按行与逗号直接切分。
function parseCSV(text) {
  const result = [];
  let row = [], field = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index++; }
      else quoted = !quoted;
    } else if (!quoted && (character === ',' || character === '\n' || character === '\r')) {
      row.push(field); field = '';
      if (character !== ',') {
        result.push(row); row = [];
        if (character === '\r' && text[index + 1] === '\n') index++;
      }
    } else field += character;
  }
  if (quoted) throw new Error('CSV 引号未闭合，请下载原文件查看');
  if (field || row.length) { row.push(field); result.push(row); }
  return result;
}

function cell(tag, content) {
  const node = document.createElement(tag);
  node.textContent = content;
  return node;
}

function render() {
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  visibleColumns.forEach(index => head.append(cell('th', labels[headings[index]] || headings[index])));
  const body = table.createTBody();
  filtered.slice(0, shown).forEach(values => {
    const row = body.insertRow();
    visibleColumns.forEach(index => row.append(cell('td', values[index] || '—')));
  });
  $('#content').replaceChildren(table);
  status(`共 ${rows.length} 条 · 匹配 ${filtered.length} 条 · 已显示 ${Math.min(shown, filtered.length)} 条`);
  $('#more').hidden = shown >= filtered.length;
}

$('#search').addEventListener('input', event => {
  const query = event.target.value.trim().toLocaleLowerCase();
  filtered = rows.filter(row => row.some(value => value.toLocaleLowerCase().includes(query)));
  shown = 100; render();
});
$('#more').addEventListener('click', () => { shown += 100; render(); });
$('#copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); status('查看链接已复制'); }
  catch { status('复制失败，请从浏览器地址栏复制链接', true); }
});

async function open() {
  if (!root || !path || root.length > 100 || path.length > 4096) throw new Error('文件链接不完整，请检查目录与文件参数');
  $('#title').textContent = path.split('/').pop() || '文件查看';
  document.title = `${$('#title').textContent} · Allinone`;
  const query = new URLSearchParams({ root, path });
  $('#download').href = `/api/file?${query}&download=1`;
  $('#download').hidden = false;
  const response = await fetch(`/api/text?${query}`, { credentials: 'same-origin', cache: 'no-store' });
  if (response.status === 401) {
    location.replace(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
    return;
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '读取文件失败，可尝试下载原文件');
  if (/\.csv$/i.test(path)) {
    const parsed = parseCSV(data.content);
    headings = parsed.shift() || [];
    rows = parsed.filter(row => row.some(value => value.trim()));
    visibleColumns = headings.map((_, index) => index).filter(index => !['id', 'guid', 'path', 'isrc', 'duration_ms'].includes(headings[index]));
    if (!visibleColumns.length) visibleColumns = headings.map((_, index) => index);
    filtered = rows;
    $('#search').hidden = false;
    render();
  } else {
    $('#content').replaceChildren(cell('pre', data.content));
    status('文件已载入');
  }
}
open().catch(error => status(error.message, true));
