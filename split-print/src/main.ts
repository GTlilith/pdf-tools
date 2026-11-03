import { readPdfFile } from '../../shared/pdf-file';
import './style.css';
import './stream-polyfill';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import PdfWorker from './pdf.worker?worker&inline';
import { PDFDocument, rgb } from 'pdf-lib';
import { bindUpload, downloadFile, fileInfo, focusContent, formatFileSize, icon, readableError, renderError, renderProcessing, renderSteps, renderUpload, resultActions, toolShell, updateProgress, type ToolStep } from '../../shared/tool-ui';

pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();

type TicketIdentity = { key: string; label: string };
type TicketStat = { ticketNumber: string; ticketKey: string; pages: number[]; needsBlankPage: boolean };
type PdfTextItem = { str?: string; transform?: number[] };
const app = document.querySelector<HTMLDivElement>('#app')!;
let downloadUrl = '';
let outputName = '';
let step: ToolStep = 'upload';
let busy = false;
let selectedFile: File | null = null;
let errorMessage = '';
let resultStats: TicketStat[] = [];
let originalPages = 0;
let outputPages = 0;

function render(moveFocus = false): void {
  const content = step === 'upload' ? renderUpload('split-print')
    : step === 'processing' ? renderProcessing(selectedFile!.name)
    : step === 'error' ? renderError(errorMessage) : renderResult();
  app.innerHTML = toolShell('split-print', renderSteps(step) + content);
  if (step === 'upload') bindUpload(processFile);
  document.getElementById('btn-reset')?.addEventListener('click', reset);
  document.getElementById('btn-retry')?.addEventListener('click', reset);
  document.getElementById('btn-export')?.addEventListener('click', () => {
    if (!downloadUrl) return;
    downloadFile(downloadUrl, outputName);
    document.getElementById('export-feedback')!.textContent = '已发起下载，请在浏览器下载列表中查看文件。';
  });
  if (moveFocus) focusContent();
}

function buildTextLines(items: PdfTextItem[]): string[] {
  const positioned = items
    .map((item, index) => ({ text: item.str || '', index, x: item.transform?.[4], y: item.transform?.[5] }))
    .filter(item => item.text);
  if (!positioned.length) return [];
  if (!positioned.every(item => typeof item.x === 'number' && typeof item.y === 'number')) {
    return [positioned.map(item => item.text).join(' ').replace(/\s+/g, ' ').trim()];
  }

  const rows: Array<{ y: number; items: typeof positioned }> = [];
  for (const item of positioned) {
    const row = rows.find(candidate => Math.abs(candidate.y - item.y!) <= 2);
    if (row) row.items.push(item);
    else rows.push({ y: item.y!, items: [item] });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map(row => row.items
      .sort((a, b) => (a.x! - b.x!) || (a.index - b.index))
      .map(item => item.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim());
}

function extractTicketIdentity(items: PdfTextItem[]): TicketIdentity | null {
  const lines = buildTextLines(items);
  for (let i = 0; i < lines.length; i++) {
    const compactLine = lines[i].replace(/\s/g, '');
    const labelIndex = compactLine.indexOf('票据号码');
    if (labelIndex < 0) continue;
    const packageNumber = compactLine.slice(labelIndex + '票据号码'.length).match(/\d{16,30}/)?.[0];
    if (!packageNumber) continue;

    // 子票据号位于票据包号的紧下方，通常表现为“起始号 - 结束号”。
    const subTicketLine = lines.slice(i + 1, i + 3)
      .map(line => line.replace(/\s/g, ''))
      .find(line => /^\d{1,12}[-—至]\d{1,12}$/.test(line));
    const subTicketNumber = subTicketLine?.replace(/[—至]/, '-') || '';
    return {
      key: subTicketNumber ? `${packageNumber}|${subTicketNumber}` : packageNumber,
      label: subTicketNumber ? `${packageNumber} / ${subTicketNumber}` : packageNumber,
    };
  }

  const joined = items.map(x => x.str || '').join(' ');
  const labeled = joined.match(/(?:No\.?|Ticket\s*No\.?)\s*[.:：]?\s*(\d[\d\s]{14,}\d)/i);
  if (!labeled) return null;
  const packageNumber = labeled[1].replace(/\s/g, '');
  return packageNumber.length <= 30 ? { key: packageNumber, label: packageNumber } : null;
}

async function processFile(file: File): Promise<void> {
  if (busy) return;
  busy = true; selectedFile = file; step = 'processing'; render(true);
  try {
    const buffer = await readPdfFile(file);
    updateProgress(8, '正在读取 PDF…');
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
    const pageTickets: Array<TicketIdentity | null> = [];
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        pageTickets.push(extractTicketIdentity(content.items as PdfTextItem[]));
        updateProgress(10 + Math.round(i / pdf.numPages * 50), `正在识别第 ${i} / ${pdf.numPages} 页`);
      }
    } finally {
      await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.();
    }

    // 未识别页作为前一张票据的续页；第一张票据首张必须能识别，避免误插页。
    const stats: TicketStat[] = [];
    let current: TicketStat | null = null;
    for (let i = 0; i < pageTickets.length; i++) {
      const ticket = pageTickets[i];
      if (ticket && (!current || ticket.key !== current.ticketKey)) {
        current = { ticketKey: ticket.key, ticketNumber: ticket.label, pages: [i], needsBlankPage: false };
        stats.push(current);
      } else if (current) {
        current.pages.push(i);
      } else {
        throw new Error(`第 ${i + 1} 页未识别出票据号码，无法判断票据边界。请确认该文件包含可提取文字的电子汇票。`);
      }
    }
    if (!stats.length) throw new Error('未识别到任何票据号码，请选择包含可提取文字的电子汇票 PDF。');
    stats.forEach(x => x.needsBlankPage = x.pages.length % 2 === 1);

    updateProgress(68, '正在复制页面并插入空白页…');
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
      updateProgress(68 + Math.round((i + 1) / stats.length * 25), `正在生成第 ${i + 1} / ${stats.length} 张票据`);
    }
    const bytes = await output.save();
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    outputName = `${file.name.replace(/\.pdf$/i, '')}-插页打印版.pdf`;
    resultStats = stats; originalPages = source.getPageCount(); outputPages = output.getPageCount();
    step = 'result';
  } catch (error) {
    console.error('PDF 处理失败:', error);
    const message = error instanceof Error ? error.message : '';
    errorMessage = /未识别.*票据号码/.test(message) ? message : readableError(error);
    step = 'error';
  } finally {
    busy = false; render(true);
  }
}

function renderResult(): string {
  return `<section class="card result-card">
    ${fileInfo(selectedFile!.name, `${formatFileSize(selectedFile!.size)} · ${originalPages} 页`)}
    <div class="stats stats--four">
      <div class="stat"><span>原始页数</span><strong>${originalPages}<small>页</small></strong></div>
      <div class="stat"><span>输出页数</span><strong>${outputPages}<small>页</small></strong></div>
      <div class="stat"><span>插入空白页</span><strong>${outputPages - originalPages}<small>页</small></strong></div>
      <div class="stat"><span>票据数量</span><strong>${resultStats.length}<small>张</small></strong></div>
    </div>
    <div class="notice">${icon('check')}<span>已为奇数页票据补入空白页。打印时请选择双面打印，每张票据将从新的一张纸开始。</span></div>
    <div class="section-heading"><h2>插页预览</h2><span>按票据包号与子票据号分组，保持原始顺序</span></div>
    <div class="result-table-wrapper" tabindex="0" role="region" aria-label="插页结果，可滚动"><table class="result-table"><thead><tr><th scope="col">序号</th><th scope="col">票据号码</th><th scope="col">原始页码</th><th scope="col">页数</th><th scope="col">插页结果</th></tr></thead><tbody>${resultStats.map((stat, index) => `<tr><td>${index + 1}</td><td class="ticket-number">${stat.ticketNumber}</td><td>${stat.pages.map(page => page + 1).join('、')}</td><td>${stat.pages.length}</td><td><span class="value-badge ${stat.needsBlankPage ? 'value-badge--success' : 'value-badge--muted'}">${stat.needsBlankPage ? '已插入空白页' : '无需插页'}</span></td></tr>`).join('')}</tbody></table></div>
    ${resultActions()}
  </section>`;
}

function reset(): void {
  if (busy) return;
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = ''; outputName = ''; selectedFile = null;
  resultStats = []; errorMessage = ''; step = 'upload'; render(true);
}

window.addEventListener('pagehide', event => { if (!event.persisted && downloadUrl) URL.revokeObjectURL(downloadUrl); });
render();
