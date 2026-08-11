import './style.css';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument, rgb } from 'pdf-lib';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

type TicketStat = { ticketNumber: string; pages: number[]; needsBlankPage: boolean };
const app = document.querySelector<HTMLDivElement>('#app')!;
let downloadUrl = '';
let outputName = '';

app.innerHTML = `
<header class="header"><div class="header-inner"><div class="brand"><div class="brand-icon">PDF</div><div><h1>拆分汇票 PDF 插页打印工具</h1><p>识别票据号码，奇数页票据后插入空白页，优化双面打印</p></div></div></div></header>
<main>
  <section class="card" id="upload-card"><h2>选择 PDF 文件</h2><div class="upload" id="drop"><div style="font-size:38px;color:#718096">⇧</div><strong>点击或拖拽 PDF 文件至此处</strong><span>仅支持 PDF，文件不会上传至服务器</span><input id="file" type="file" accept=".pdf,application/pdf"></div><p class="local-note">🔒 读取、识别、插页和导出均在当前浏览器本地完成</p></section>
  <section class="card hidden" id="processing"><h2>正在处理</h2><p class="status" id="status">正在读取 PDF…</p><div class="progress"><div id="bar"></div></div></section>
  <div class="alert hidden" id="error"></div>
  <section id="result" class="hidden"><div class="stats"><div class="stat"><span>原始页数</span><strong id="original">0</strong></div><div class="stat"><span>输出页数</span><strong id="output">0</strong></div><div class="stat"><span>插入空白页</span><strong id="inserted">0</strong></div><div class="stat"><span>票据数量</span><strong id="tickets">0</strong></div></div><div class="card"><h2>票据详情</h2><div class="table-wrap"><table><thead><tr><th>序号</th><th>票据号码</th><th>原始页码</th><th>页数</th><th>处理</th></tr></thead><tbody id="tbody"></tbody></table></div><div class="actions"><button class="btn primary" id="download">下载插页 PDF</button><button class="btn" id="reset">重新选择文件</button></div></div></section>
  <section class="card instructions" id="instructions"><h2>使用说明</h2><ol><li>选择包含电子银行承兑汇票的 PDF。</li><li>工具从每页提取票据号码，连续的续页归入同一票据。</li><li>票据总页数为奇数时，在该票据后插入一张同尺寸空白页。</li></ol></section>
</main><footer class="footer">原文件与处理结果仅存在于您的设备内存中，不会上传</footer>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fileInput = $<HTMLInputElement>('file');
const drop = $('drop');

function setProgress(value: number, text: string) {
  $<HTMLDivElement>('bar').style.width = `${value}%`;
  $('status').textContent = text;
}

function extractTicketNumber(items: Array<{ str?: string }>): string | null {
  const keywords = ['票据号码', '票号', '汇票号码'];
  for (let i = 0; i < items.length; i++) {
    const current = items[i].str || '';
    for (const keyword of keywords) {
      const idx = current.indexOf(keyword);
      if (idx < 0) continue;
      const candidates = [current.slice(idx + keyword.length), ...items.slice(i + 1, i + 6).map(x => x.str || '')];
      for (const candidate of candidates) {
        const matches = candidate.match(/\d[\d\s]{14,}\d/g) || [];
        for (const match of matches) {
          const number = match.replace(/\s/g, '');
          if (number.length >= 16 && number.length <= 30) return number;
        }
      }
    }
  }
  const joined = items.map(x => x.str || '').join(' ');
  const labeled = joined.match(/(?:No\.?|Ticket\s*No\.?)\s*[.:：]?\s*(\d[\d\s]{14,}\d)/i);
  if (labeled) {
    const number = labeled[1].replace(/\s/g, '');
    if (number.length <= 30) return number;
  }
  return null;
}

async function processFile(file: File) {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return showError('请选择 PDF 文件。');
  $('error').classList.add('hidden'); $('upload-card').classList.add('hidden'); $('instructions').classList.add('hidden'); $('result').classList.add('hidden'); $('processing').classList.remove('hidden');
  try {
    const buffer = await file.arrayBuffer();
    setProgress(8, '正在读取 PDF…');
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
    const pageTickets: Array<string | null> = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pageTickets.push(extractTicketNumber(content.items as Array<{ str?: string }>));
      setProgress(10 + Math.round(i / pdf.numPages * 50), `正在识别第 ${i}/${pdf.numPages} 页…`);
    }
    // 不再读取页面后释放 PDF.js 资源（不同版本的类型定义未暴露 destroy）。
    (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.();

    // 未识别页作为前一张票据的续页；第一张票据首张必须能识别，避免误插页。
    const stats: TicketStat[] = [];
    let current: TicketStat | null = null;
    for (let i = 0; i < pageTickets.length; i++) {
      const ticket = pageTickets[i];
      if (ticket && (!current || ticket !== current.ticketNumber)) {
        current = { ticketNumber: ticket, pages: [i], needsBlankPage: false };
        stats.push(current);
      } else if (current) {
        current.pages.push(i);
      } else {
        throw new Error(`第 ${i + 1} 页未识别出票据号码，无法安全判断票据边界。请检查该 PDF 是否为标准电子汇票格式。`);
      }
    }
    if (!stats.length) throw new Error('未识别到任何票据号码，未生成文件。');
    stats.forEach(x => x.needsBlankPage = x.pages.length % 2 === 1);

    setProgress(68, '正在复制页面并插入空白页…');
    const source = await PDFDocument.load(buffer);
    const output = await PDFDocument.create();
    for (let i = 0; i < stats.length; i++) {
      const stat = stats[i];
      const copied = await output.copyPages(source, stat.pages);
      copied.forEach(page => output.addPage(page));
      if (stat.needsBlankPage) {
        const size = source.getPage(stat.pages.at(-1)!).getSize();
        const blank = output.addPage([size.width, size.height]);
        blank.drawText('-', { x: size.width - 30, y: 25, size: 8, color: rgb(.9, .9, .9) });
      }
      setProgress(68 + Math.round((i + 1) / stats.length * 25), `正在生成第 ${i + 1}/${stats.length} 张票据…`);
    }
    const bytes = await output.save();
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    outputName = `${file.name.replace(/\.pdf$/i, '')}-插页打印版.pdf`;
    renderResult(stats, source.getPageCount(), output.getPageCount());
    setProgress(100, '处理完成');
    $('processing').classList.add('hidden'); $('result').classList.remove('hidden');
  } catch (error) {
    $('processing').classList.add('hidden');
    showError(error instanceof Error ? error.message : '处理失败，请检查 PDF 文件。');
  }
}

function renderResult(stats: TicketStat[], original: number, output: number) {
  $('original').textContent = String(original); $('output').textContent = String(output);
  $('inserted').textContent = String(output - original); $('tickets').textContent = String(stats.length);
  $('tbody').innerHTML = stats.map((s, i) => `<tr><td>${i + 1}</td><td>${s.ticketNumber}</td><td>${s.pages.map(p => p + 1).join('、')}</td><td>${s.pages.length}</td><td><span class="badge ${s.needsBlankPage ? 'yes' : ''}">${s.needsBlankPage ? '已插入空白页' : '无需插页'}</span></td></tr>`).join('');
}
function showError(message: string) { const el = $('error'); el.textContent = message; el.classList.remove('hidden'); $('upload-card').classList.remove('hidden'); $('instructions').classList.remove('hidden'); }
function reset() { if (downloadUrl) URL.revokeObjectURL(downloadUrl); downloadUrl=''; fileInput.value=''; $('result').classList.add('hidden'); $('error').classList.add('hidden'); $('upload-card').classList.remove('hidden'); $('instructions').classList.remove('hidden'); }
fileInput.addEventListener('change', () => fileInput.files?.[0] && processFile(fileInput.files[0]));
['dragenter','dragover'].forEach(type => drop.addEventListener(type, e => { e.preventDefault(); drop.classList.add('drag'); }));
['dragleave','drop'].forEach(type => drop.addEventListener(type, e => { e.preventDefault(); drop.classList.remove('drag'); }));
drop.addEventListener('drop', e => { const file=(e as DragEvent).dataTransfer?.files[0]; if(file) processFile(file); });
$('download').addEventListener('click', () => { const a=document.createElement('a'); a.href=downloadUrl; a.download=outputName; a.click(); });
$('reset').addEventListener('click', reset);
