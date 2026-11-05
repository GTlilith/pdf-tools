import { extractTicketIdentity, type TicketIdentity, type PdfTextItem } from './ticket-identity';
import { readPdfFile } from '../../shared/pdf-file';
import './style.css';
import './stream-polyfill';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import PdfWorker from '../../shared/pdf.worker?worker';
import { PDFDocument, rgb } from 'pdf-lib';
import { bindUpload, downloadFile, escapeHtml, fileInfo, focusContent, formatFileSize, icon, readableError, renderError, renderProcessing, renderSteps, renderUpload, resultActions, toolShell, updateProgress, type ToolStep } from '../../shared/tool-ui';

pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();

type TicketStat = { ticketNumber: string; ticketKey: string; hasSubTicket: boolean; pages: number[]; needsBlankPage: boolean };
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

async function processFile(file: File): Promise<void> {
  if (busy) return;
  busy = true; selectedFile = file; step = 'processing'; render(true);
  try {
    const buffer = await readPdfFile(file);
    updateProgress(8, '正在读取 PDF…');
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer.slice(0)) });
    const pageTickets: Array<TicketIdentity | null> = [];
    try {
      const pdf = await loadingTask.promise;
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        pageTickets.push(extractTicketIdentity(content.items as PdfTextItem[]));
        updateProgress(10 + Math.round(i / pdf.numPages * 50), `正在识别第 ${i} / ${pdf.numPages} 页`);
      }
    } finally {
      await loadingTask.destroy();
    }

    // 未识别页作为前一张票据的续页；第一张票据首张必须能识别，避免误插页。
    const stats: TicketStat[] = [];
    let current: TicketStat | null = null;
    for (let i = 0; i < pageTickets.length; i++) {
      const ticket = pageTickets[i];
      if (ticket && (!current || ticket.key !== current.ticketKey)) {
        current = { ticketKey: ticket.key, ticketNumber: ticket.label, hasSubTicket: ticket.hasSubTicket, pages: [i], needsBlankPage: false };
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
  const packageOnlyCount = resultStats.filter(stat => !stat.hasSubTicket).length;
  return `<section class="card result-card">
    ${fileInfo(selectedFile!.name, `${formatFileSize(selectedFile!.size)} · ${originalPages} 页`)}
    <div class="stats stats--four">
      <div class="stat"><span>原始页数</span><strong>${originalPages}<small>页</small></strong></div>
      <div class="stat"><span>输出页数</span><strong>${outputPages}<small>页</small></strong></div>
      <div class="stat"><span>插入空白页</span><strong>${outputPages - originalPages}<small>页</small></strong></div>
      <div class="stat"><span>票据数量</span><strong>${resultStats.length}<small>张</small></strong></div>
    </div>
    <div class="notice">${icon('check')}<span>已为奇数页票据补入空白页。打印时请选择双面打印，每张票据将从新的一张纸开始。</span></div>
    ${packageOnlyCount ? `<div class="notice notice--warning" role="status">${icon('alert')}<span>${packageOnlyCount} 组未识别到子票据号，已仅按包号分组。同一包号内的不同子票据可能合并，请核对标黄分组的原始页码及插页位置。</span></div>` : ''}
    <div class="section-heading"><h2>插页预览</h2><span>按票据包号与子票据号分组，保持原始顺序</span></div>
    <div class="result-table-wrapper" tabindex="0" role="region" aria-label="插页结果，可滚动"><table class="result-table"><thead><tr><th scope="col">序号</th><th scope="col">票据号码</th><th scope="col">原始页码</th><th scope="col">页数</th><th scope="col">插页结果</th></tr></thead><tbody>${resultStats.map((stat, index) => `<tr class="${stat.hasSubTicket ? '' : 'row--unparsed'}"><td>${index + 1}</td><td class="ticket-number">${escapeHtml(stat.ticketNumber)}${stat.hasSubTicket ? '' : '<br><span class="value-badge value-badge--warning">未识别子票号 · 仅按包号分组</span>'}</td><td>${stat.pages.map(page => page + 1).join('、')}</td><td>${stat.pages.length}</td><td><span class="value-badge ${stat.needsBlankPage ? 'value-badge--success' : 'value-badge--muted'}">${stat.needsBlankPage ? '已插入空白页' : '无需插页'}</span></td></tr>`).join('')}</tbody></table></div>
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
