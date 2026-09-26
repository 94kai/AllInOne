import path from 'node:path';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import XLSX from 'xlsx';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

function httpError(message, status = 400) { return Object.assign(new Error(message), { status }); }
const fixedTemplateRules = {
  'bill-template': {
    '优惠': { mode: 'delete', value: '', locked: true },
    '标签': { mode: 'delete', value: '', locked: true },
    '地址': { mode: 'delete', value: '', locked: true },
    '所属账本': { mode: 'fixed', value: '日常账本', locked: true }
  },
  'wechat': {
    '交易类型': { mode: 'delete', value: '', locked: true },
    '交易时间': { mode: 'keep', value: '', locked: true },
    '金额(元)': { mode: 'keep', value: '', locked: true },
    '收/支': { mode: 'keep', value: '', locked: true },
    '商品': { mode: 'keep', value: '', locked: true },
    '交易对方': { mode: 'keep', value: '', locked: true }
  }
};
const billMappings = [
  { target: '日期', sources: ['交易时间'], transform: '保留完整日期时间' },
  { target: '金额', sources: ['金额(元)'], transform: '原值映射' },
  { target: '收支类型', sources: ['收/支'], transform: '原值映射' },
  { target: '类别', sources: ['收/支'], transform: '支出映射为临时支出，收入映射为临时收入' },
  { target: '备注', sources: ['商品', '交易对方'], transform: '按顺序使用空格拼接' },
  { target: '收支账户', sources: [], transform: '固定值：凯的微信钱包' }
];
const alipayMappings = [
  { target: '筛选', sources: ['收/付款方式'], transform: '命中自定义过滤规则时排除' },
  { target: '日期', sources: ['交易时间'], transform: '保留完整日期时间' },
  { target: '收支类型', sources: ['收/支'], transform: '原值映射' },
  { target: '金额', sources: ['金额'], transform: '原值映射' },
  { target: '类别', sources: ['收/支'], transform: '支出映射为临时支出，收入映射为临时收入；自定义规则可覆盖' },
  { target: '备注', sources: ['商品说明', '交易对方', '交易分类'], transform: '按顺序使用空格拼接' },
  { target: '所属账本', sources: [], transform: '固定值：日常账本' },
  { target: '收支账户', sources: [], transform: '固定值：凯的支付宝' }
];
const cmbMappings = [
  { target: '日期', sources: ['记账日期'], transform: '原值映射' },
  { target: '收支类型', sources: ['交易金额'], transform: '正数映射为收入，负数映射为支出' },
  { target: '金额', sources: ['交易金额'], transform: '取绝对值' },
  { target: '类别', sources: ['交易金额'], transform: '支出映射为临时支出，收入映射为临时收入；自定义规则可覆盖' },
  { target: '备注', sources: ['交易摘要', '对手信息'], transform: '按顺序使用空格拼接' },
  { target: '所属账本', sources: [], transform: '固定值：日常账本' },
  { target: '收支账户', sources: [], transform: '固定值：凯的招商银行' }
];
const spreadsheetLimit = 20 * 1024 * 1024;

export class BillManagerModule {
  constructor({ dataDir }) {
    this.dir = path.join(dataDir, 'bill-manager');
    this.sourceDir = path.join(this.dir, 'source');
    this.configFile = path.join(this.dir, 'config.json');
    this.sources = [];
    this.config = { fieldRules: {}, recordActions: {}, categoryRules: [], alipayFilterRules: [] };
  }

  async initialize() {
    await mkdir(this.sourceDir, { recursive: true });
    try {
      const saved = JSON.parse(await readFile(this.configFile, 'utf8'));
      this.config.fieldRules = saved?.fieldRules && typeof saved.fieldRules === 'object' ? saved.fieldRules : {};
      this.config.recordActions = saved?.recordActions && typeof saved.recordActions === 'object' ? saved.recordActions : {};
      this.config.categoryRules = Array.isArray(saved?.categoryRules) ? this.validateCategoryRules(saved.categoryRules) : [];
      this.config.alipayFilterRules = Array.isArray(saved?.alipayFilterRules) ? this.validateAlipayFilterRules(saved.alipayFilterRules) : [];
    } catch {}
    await this.reload();
  }

  async reload() {
    const names = (await readdir(this.sourceDir)).filter(name => /\.(xlsx?|xlsb|csv|pdf)$/i.test(name)).sort();
    const sources = [];
    for (const name of names) {
      try { sources.push(await this.parseFile(name)); }
      catch (cause) { sources.push({ id: name, name, role: 'unknown', label: '无法识别', error: cause.message, columns: [], rows: [] }); }
    }
    const roleOrder = ['bill-template', 'transfer-template', 'wechat', 'alipay', 'cmb'];
    this.sources = sources.sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role));
    this.ensureRules();
  }

  async parseFile(name) {
    const sourcePath = path.join(this.sourceDir, name);
    const [buffer, sourceInfo] = await Promise.all([readFile(sourcePath), stat(sourcePath)]);
    if (buffer.length > spreadsheetLimit) throw httpError('账单文件超过 20 MB 解析上限', 413);
    if (path.extname(name).toLowerCase() === '.pdf') return this.parseCmbPdf(name, buffer, sourceInfo.mtime.toISOString());
    const isCsv = path.extname(name).toLowerCase() === '.csv';
    const workbook = isCsv
      ? XLSX.read(new TextDecoder('gb18030').decode(buffer), { type: 'string', dense: true, cellDates: false })
      : XLSX.read(buffer, { type: 'buffer', dense: true, cellDates: false });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error('工作簿没有工作表');
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false, blankrows: false });
    let role = 'unknown', label = '未识别表格', headerIndex = 0;
    if (sheetName === '账单' && matrix[0]?.includes('收支类型')) { role = 'bill-template'; label = '账单模板'; }
    else if (sheetName === '转账' && matrix[0]?.includes('转出账户')) { role = 'transfer-template'; label = '转账模板'; }
    else {
      const index = matrix.findIndex(row => row.includes('交易时间') && row.includes('交易单号'));
      if (index >= 0) { role = 'wechat'; label = '微信账单'; headerIndex = index; }
      const alipayIndex = matrix.findIndex(row => row.includes('交易时间') && row.includes('交易分类') && row.includes('交易订单号'));
      if (alipayIndex >= 0) { role = 'alipay'; label = '支付宝账单'; headerIndex = alipayIndex; }
    }
    const columns = (matrix[headerIndex] || []).map(value => String(value).trim()).filter(Boolean);
    let rows = matrix.slice(headerIndex + 1).filter(row => row.some(value => String(value).trim())).map((row, rowIndex) => {
      const values = Object.fromEntries(columns.map((column, index) => [column, String(row[index] ?? '').trim()]));
      const transactionId = role === 'wechat' ? values['交易单号'] : role === 'alipay' ? values['交易订单号'] : '';
      return { id: transactionId || `row-${rowIndex + 1}`, values };
    });
    return { id: role, name, role, label, sheetName, headerRow: headerIndex + 1, uploadedAt: sourceInfo.mtime.toISOString(), columns, rows };
  }

  async parseCmbPdf(name, buffer, uploadedAt) {
    let document;
    try { document = await getDocument({ data: new Uint8Array(buffer), disableWorker: true }).promise; }
    catch { throw httpError('无法读取招商银行 PDF，请确认文件未加密且来源正确', 422); }
    const columns = ['记账日期', '货币', '交易金额', '联机余额', '交易摘要', '对手信息'];
    const rows = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items.map(item => ({ text: String(item.str || '').trim(), x: item.transform[4], y: item.transform[5] })).filter(item => item.text);
      const dates = items.filter(item => item.x < 90 && /^\d{4}-\d{2}-\d{2}$/.test(item.text)).sort((a, b) => b.y - a.y);
      for (let index = 0; index < dates.length; index += 1) {
        const dateItem = dates[index];
        const upper = index === 0 ? dateItem.y + 18 : (dates[index - 1].y + dateItem.y) / 2;
        const lower = index === dates.length - 1 ? dateItem.y - 18 : (dateItem.y + dates[index + 1].y) / 2;
        const nearby = items.filter(item => item.y <= upper && item.y >= lower);
        const sameLine = (from, to) => nearby.find(item => Math.abs(item.y - dateItem.y) < 2 && item.x >= from && item.x < to)?.text || '';
        const joined = (from, to) => nearby.filter(item => item.x >= from && item.x < to).sort((a, b) => b.y - a.y || a.x - b.x).map(item => item.text).join('');
        const values = {
          '记账日期': dateItem.text,
          '货币': sameLine(90, 145),
          '交易金额': sameLine(145, 225),
          '联机余额': sameLine(225, 300),
          '交易摘要': joined(300, 410),
          '对手信息': joined(410, 590)
        };
        rows.push({ id: `page-${pageNumber}-row-${index + 1}`, values });
      }
    }
    if (!rows.length) throw httpError('未识别到招商银行流水记录', 422);
    return { id: 'cmb', name, role: 'cmb', label: '招商银行流水', sheetName: `PDF · ${document.numPages} 页`, headerRow: 1, uploadedAt, columns, rows };
  }

  ensureRules() {
    for (const source of this.sources) {
      if (!source.columns.length) continue;
      const rules = this.config.fieldRules[source.role] ||= {};
      for (const column of source.columns) {
        if (!rules[column] || !['keep', 'delete', 'fixed'].includes(rules[column].mode)) rules[column] = { mode: 'keep', value: '' };
      }
    }
    for (const [role, rules] of Object.entries(fixedTemplateRules)) {
      this.config.fieldRules[role] ||= {};
      for (const [column, rule] of Object.entries(rules)) this.config.fieldRules[role][column] = { ...rule };
    }
  }

  publicData() {
    return {
      sources: this.sources.map(source => ({ ...source, rows: ['wechat', 'alipay', 'cmb'].includes(source.role) ? source.rows : source.rows.slice(0, 5) })),
      config: this.config,
      mappings: { wechat: billMappings, alipay: alipayMappings, cmb: cmbMappings },
      exportPreview: this.buildExportPreview()
    };
  }

  buildExportPreview() {
    const wechat = this.sources.find(source => source.role === 'wechat');
    const billTemplate = this.sources.find(source => source.role === 'bill-template');
    const alipay = this.sources.find(source => source.role === 'alipay');
    const cmb = this.sources.find(source => source.role === 'cmb');
    const bills = [];
    const billRules = this.config.fieldRules['bill-template'] || {};
    const billColumns = billTemplate?.columns.filter(column => billRules[column]?.mode !== 'delete') || [];
    const applyCategoryRule = mapped => {
      const rule = this.config.categoryRules.find(item => mapped['备注'].includes(item.keyword));
      if (rule) { mapped['类别'] = rule.primary; mapped['二级分类'] = rule.secondary; }
      return mapped;
    };
    if (wechat && billTemplate) {
      const note = values => [values['商品'], values['交易对方']].map(value => String(value || '').trim()).filter(Boolean).join(' ');
      const date = value => String(value || '').trim();
      for (const row of wechat.rows) {
        const mapped = {
          '日期': date(row.values['交易时间']),
          '收支类型': row.values['收/支'],
          '金额': row.values['金额(元)'],
          '类别': row.values['收/支'] === '支出' ? '临时支出' : row.values['收/支'] === '收入' ? '临时收入' : '',
          '所属账本': '日常账本',
          '收支账户': '凯的微信钱包',
          '备注': note(row.values)
        };
        applyCategoryRule(mapped);
        bills.push(Object.fromEntries(billColumns.map(column => [column, mapped[column] || ''])));
      }
    }
    const alipayRows = alipay && billColumns.length ? alipay.rows
      .filter(row => !this.config.alipayFilterRules.some(rule => row.values['收/付款方式'].includes(rule.keyword)))
      .map(row => {
        const mapped = {
          '日期': String(row.values['交易时间'] || '').trim(),
          '收支类型': row.values['收/支'],
          '金额': row.values['金额'],
          '类别': row.values['收/支'] === '支出' ? '临时支出' : row.values['收/支'] === '收入' ? '临时收入' : '',
          '所属账本': '日常账本',
          '收支账户': '凯的支付宝',
          '备注': [row.values['商品说明'], row.values['交易对方'], row.values['交易分类']]
            .map(value => String(value || '').trim()).filter(Boolean).join(' ')
        };
        applyCategoryRule(mapped);
        return Object.fromEntries(billColumns.map(column => [column, mapped[column] || '']));
      }) : [];
    const cmbRows = cmb && billColumns.length ? cmb.rows.map(row => {
      const amount = Number(String(row.values['交易金额'] || '').replaceAll(',', ''));
      const mapped = {
        '日期': row.values['记账日期'],
        '收支类型': amount > 0 ? '收入' : amount < 0 ? '支出' : '',
        '金额': Number.isFinite(amount) ? Math.abs(amount).toFixed(2) : '',
        '类别': amount > 0 ? '临时收入' : amount < 0 ? '临时支出' : '',
        '所属账本': '日常账本',
        '收支账户': '凯的招商银行',
        '备注': [row.values['交易摘要'], row.values['对手信息']]
          .map(value => String(value || '').trim()).filter(Boolean).join(' ')
      };
      applyCategoryRule(mapped);
      return Object.fromEntries(billColumns.map(column => [column, mapped[column] || '']));
    }) : [];
    return {
      bills: { columns: billColumns, rows: bills },
      alipay: { columns: billColumns, rows: alipayRows },
      cmb: { columns: billColumns, rows: cmbRows }
    };
  }

  async body(req) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 256 * 1024) throw httpError('请求内容过大', 413); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw httpError('请求内容不是有效 JSON'); }
  }

  async uploadBody(req) {
    const declaredSize = Number(req.headers['content-length']);
    if (Number.isFinite(declaredSize) && declaredSize > spreadsheetLimit) throw httpError('账单超过 20 MB 上传上限', 413);
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > spreadsheetLimit) throw httpError('账单超过 20 MB 上传上限', 413);
      chunks.push(chunk);
    }
    if (!size) throw httpError('上传文件为空');
    return Buffer.concat(chunks);
  }

  async uploadWechat(req, fileName) {
    const name = String(fileName || '').normalize('NFC');
    if (!/^[^\\/\0-\x1f\x7f]+\.(xls|xlsx)$/i.test(name) || Buffer.byteLength(name) > 255) throw httpError('请选择 .xls 或 .xlsx 微信账单');
    const buffer = await this.uploadBody(req);
    const temporaryName = `.wechat-upload-${Date.now()}.xlsx`;
    const temporary = path.join(this.sourceDir, temporaryName);
    try {
      await writeFile(temporary, buffer, { flag: 'wx', mode: 0o600 });
      const parsed = await this.parseFile(temporaryName);
      if (parsed.role !== 'wechat') throw httpError('未识别到微信账单表头，请上传微信支付导出的账单文件', 422);
      await rename(temporary, path.join(this.sourceDir, '当前微信账单.xlsx'));
    } catch (cause) {
      await unlink(temporary).catch(() => {});
      throw cause;
    }
    await this.reload();
    return this.publicData();
  }

  async uploadAlipay(req, fileName) {
    const name = String(fileName || '').normalize('NFC');
    if (!/^[^\\/\0-\x1f\x7f]+\.csv$/i.test(name) || Buffer.byteLength(name) > 255) throw httpError('请选择支付宝导出的 .csv 账单');
    const buffer = await this.uploadBody(req);
    const temporaryName = `.alipay-upload-${Date.now()}.csv`;
    const temporary = path.join(this.sourceDir, temporaryName);
    try {
      await writeFile(temporary, buffer, { flag: 'wx', mode: 0o600 });
      const parsed = await this.parseFile(temporaryName);
      if (parsed.role !== 'alipay') throw httpError('未识别到支付宝账单表头，请上传支付宝导出的交易明细 CSV', 422);
      await rename(temporary, path.join(this.sourceDir, '当前支付宝账单.csv'));
    } catch (cause) {
      await unlink(temporary).catch(() => {});
      throw cause;
    }
    await this.reload();
    return this.publicData();
  }

  async uploadCmb(req, fileName) {
    const name = String(fileName || '').normalize('NFC');
    if (!/^[^\\/\0-\x1f\x7f]+\.pdf$/i.test(name) || Buffer.byteLength(name) > 255) throw httpError('请选择招商银行导出的 .pdf 流水');
    const buffer = await this.uploadBody(req);
    if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw httpError('上传文件不是有效的 PDF', 422);
    const temporaryName = `.cmb-upload-${Date.now()}.pdf`;
    const temporary = path.join(this.sourceDir, temporaryName);
    try {
      await writeFile(temporary, buffer, { flag: 'wx', mode: 0o600 });
      const parsed = await this.parseFile(temporaryName);
      if (parsed.role !== 'cmb') throw httpError('未识别到招商银行流水', 422);
      await rename(temporary, path.join(this.sourceDir, '当前招商银行流水.pdf'));
    } catch (cause) {
      await unlink(temporary).catch(() => {});
      throw cause;
    }
    await this.reload();
    return this.publicData();
  }

  exportWorkbook() {
    const preview = this.buildExportPreview();
    const columns = preview.bills.columns.length ? preview.bills.columns : preview.alipay.columns.length ? preview.alipay.columns : preview.cmb.columns;
    const rows = [...preview.bills.rows, ...preview.alipay.rows, ...preview.cmb.rows];
    if (!rows.length) throw httpError('当前没有可导出的账单', 409);
    const matrix = [columns, ...rows.map(row => columns.map(column => row[column] || ''))];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(matrix), '账单');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  async save() {
    const temporary = `${this.configFile}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.configFile);
  }

  validateCategoryRules(rules) {
    if (!Array.isArray(rules)) throw httpError('分类规则格式不正确');
    if (rules.length > 100) throw httpError('分类规则最多 100 条');
    return rules.map((rule, index) => {
      const keyword = String(rule?.keyword || '').trim().slice(0, 100);
      const primary = String(rule?.primary || '').trim().slice(0, 100);
      const secondary = String(rule?.secondary || '').trim().slice(0, 100);
      if (!keyword || !primary) throw httpError(`第 ${index + 1} 条规则必须填写匹配字符串和一级分类`);
      return { id: `category-${index + 1}`, keyword, primary, secondary };
    });
  }

  validateAlipayFilterRules(rules) {
    if (!Array.isArray(rules)) throw httpError('支付宝过滤规则格式不正确');
    if (rules.length > 50) throw httpError('支付宝过滤规则最多 50 条');
    return rules.map((rule, index) => {
      const keyword = String(rule?.keyword || '').trim().slice(0, 100);
      if (!keyword) throw httpError(`第 ${index + 1} 条过滤规则必须填写匹配字符串`);
      return { id: `alipay-filter-${index + 1}`, keyword };
    });
  }

  updateConfig(input) {
    const validColumns = new Map(this.sources.map(source => [source.role, new Set(source.columns)]));
    const fieldRules = {};
    for (const [role, rules] of Object.entries(input.fieldRules || {})) {
      if (!validColumns.has(role) || !rules || typeof rules !== 'object') continue;
      if (role !== 'wechat') continue;
      fieldRules[role] = {};
      for (const [column, rule] of Object.entries(rules)) {
        if (!validColumns.get(role).has(column)) continue;
        if (fixedTemplateRules[role]?.[column]?.locked) continue;
        const mode = ['keep', 'delete', 'fixed'].includes(rule?.mode) ? rule.mode : 'keep';
        fieldRules[role][column] = { mode, value: mode === 'fixed' ? String(rule.value || '').slice(0, 500) : '' };
      }
    }
    const wechatIds = new Set(this.sources.find(source => source.role === 'wechat')?.rows.map(row => row.id) || []);
    const recordActions = {};
    for (const [id, action] of Object.entries(input.recordActions || {})) {
      if (wechatIds.has(id) && ['bill', 'delete', 'transfer'].includes(action) && action !== 'bill') recordActions[id] = action;
    }
    this.config = { fieldRules, recordActions }; this.ensureRules();
  }

  send(res, status, value) {
    const body = JSON.stringify(value);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
    res.end(body); return true;
  }

  async handle(req, res, url) {
    const root = '/api/modules/bill-manager';
    if (!url.pathname.startsWith(root)) return false;
    if (url.pathname === root && req.method === 'GET') return this.send(res, 200, this.publicData());
    if (url.pathname === `${root}/reload` && req.method === 'POST') { await this.reload(); return this.send(res, 200, this.publicData()); }
    if (url.pathname === `${root}/category-rules` && req.method === 'PUT') {
      const input = await this.body(req);
      this.config.categoryRules = this.validateCategoryRules(input.rules);
      await this.save();
      return this.send(res, 200, this.publicData());
    }
    if (url.pathname === `${root}/alipay-filter-rules` && req.method === 'PUT') {
      const input = await this.body(req);
      this.config.alipayFilterRules = this.validateAlipayFilterRules(input.rules);
      await this.save();
      return this.send(res, 200, this.publicData());
    }
    if (url.pathname === `${root}/upload` && req.method === 'POST') {
      const role = url.searchParams.get('role');
      const upload = role === 'alipay' ? this.uploadAlipay(req, url.searchParams.get('name')) : role === 'cmb' ? this.uploadCmb(req, url.searchParams.get('name')) : this.uploadWechat(req, url.searchParams.get('name'));
      return this.send(res, 201, await upload);
    }
    if (url.pathname === `${root}/export` && req.method === 'GET') {
      const body = this.exportWorkbook();
      const fileName = `账单-${new Date().toISOString().slice(0, 10)}.xlsx`;
      res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Length': body.length, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`, 'Cache-Control': 'no-store' });
      res.end(body); return true;
    }
    throw httpError('账单管理接口不存在', 404);
  }
}
