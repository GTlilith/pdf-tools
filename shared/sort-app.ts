import { readPdfFile } from './pdf-file';
import {
  bindUpload, downloadFile, escapeHtml, fileInfo, focusContent, formatFileSize,
  icon, readableError, renderError, renderProcessing, renderSteps, renderUpload,
  resultActions, toolShell, updateProgress, type ToolId, type ToolStep,
} from './tool-ui';

interface Page { pageIndex: number }
interface SortResult<T> { pages: T[]; sortOrder: number[] }
interface SortTool<T extends Page> {
  id: Exclude<ToolId, 'split-print'>;
  field: string;
  suffix: string;
  extract: (buffer: ArrayBuffer, onProgress: (current: number, total: number) => void) => Promise<T[]>;
  sort: (pages: T[]) => SortResult<T>;
  value: (page: T) => number | Date | null;
  format: (page: T) => string;
  reorder: (buffer: ArrayBuffer, order: number[]) => Promise<Uint8Array>;
}

export function initSortApp<T extends Page>(tool: SortTool<T>): void {
  const app = document.getElementById('app')!;
  let step: ToolStep = 'upload';
  let file: File | null = null;
  let buffer: ArrayBuffer | null = null;
  let result: SortResult<T> | null = null;
  let error = '';
  let busy = false;
  const continuations = new Set<number>();

  function render(moveFocus = false): void {
    const content = step === 'upload' ? renderUpload(tool.id)
      : step === 'processing' ? renderProcessing(file!.name)
      : step === 'error' ? renderError(error) : renderResult();
    app.innerHTML = toolShell(tool.id, renderSteps(step) + content);
    if (step === 'upload') bindUpload(handleFile);
    document.getElementById('btn-reset')?.addEventListener('click', reset);
    document.getElementById('btn-retry')?.addEventListener('click', reset);
    document.getElementById('btn-export')?.addEventListener('click', handleExport);
    if (moveFocus) focusContent();
  }

  function renderResult(): string {
    if (!result || !file) return '';
    const recognized = result.pages.filter(page => tool.value(page) !== null).length;
    const unassigned = result.pages.length - recognized - continuations.size;
    return `<section class="card result-card">
      ${fileInfo(file.name, `${formatFileSize(file.size)} · ${result.pages.length} 页`)}
      <div class="stats"><div class="stat"><span>PDF 总页数</span><strong>${result.pages.length}<small>页</small></strong></div><div class="stat"><span>已识别票据首页</span><strong>${recognized}<small>页</small></strong></div><div class="stat"><span>跟随票据的续页</span><strong>${continuations.size}<small>页</small></strong></div></div>
      ${!recognized ? `<div class="notice notice--warning" role="status">${icon('alert')}<span>未识别到${tool.field}，无法排序。请确认 PDF 包含可提取的汇票文字，扫描件暂不支持。</span></div>` : unassigned ? `<div class="notice notice--warning" role="status">${icon('alert')}<span>${unassigned} 页未能归属票据，将按原顺序置于末尾，请导出前核对。</span></div>` : continuations.size ? `<div class="notice" role="status">${icon('file')}<span>${continuations.size} 页未单独识别到${tool.field}，已按原始顺序跟随前一张票据，请核对续页归属。</span></div>` : ''}
      <div class="section-heading"><h2>排序预览</h2><span>${tool.id === 'amount-sort' ? '金额从大到小' : '到期日从晚到早'}</span></div>
      <div class="result-table-wrapper" tabindex="0" role="region" aria-label="排序结果，可滚动"><table class="result-table"><thead><tr><th scope="col">排序后页码</th><th scope="col">原始页码</th><th scope="col">${tool.field}</th></tr></thead><tbody>${result.pages.map((page, index) => {
        const missing = tool.value(page) === null;
        const continuation = continuations.has(page.pageIndex);
        return `<tr class="${missing ? continuation ? 'row--continuation' : 'row--unparsed' : ''}"><td>${index + 1}</td><td>第 ${page.pageIndex + 1} 页</td><td><span class="value-badge ${missing ? 'value-badge--muted' : ''}">${missing ? continuation ? '续页 · 跟随前票' : '未识别 · 请核对' : escapeHtml(tool.format(page))}</span></td></tr>`;
      }).join('')}</tbody></table></div>
      ${resultActions()}
    </section>`;
  }

  async function handleFile(selected: File): Promise<void> {
    if (busy) return;
    busy = true; file = selected; step = 'processing'; render(true);
    try {
      buffer = await readPdfFile(file);
      const pages = await tool.extract(buffer.slice(0), (current, total) => updateProgress(Math.round(current / total * 100), `正在识别第 ${current} / ${total} 页`));
      continuations.clear();
      let hasAnchor = false;
      for (const page of pages) {
        if (tool.value(page) !== null) hasAnchor = true;
        else if (hasAnchor) continuations.add(page.pageIndex);
      }
      result = tool.sort(pages);
      step = 'result';
    } catch (err) { console.error('PDF 处理失败:', err); error = readableError(err); step = 'error'; }
    finally { busy = false; render(true); }
    if (result && !result.pages.some(page => tool.value(page) !== null)) {
      (document.getElementById('btn-export') as HTMLButtonElement).disabled = true;
    }
  }

  async function handleExport(): Promise<void> {
    if (busy || !buffer || !result || !file) return;
    busy = true;
    const button = document.getElementById('btn-export') as HTMLButtonElement;
    const resetButton = document.getElementById('btn-reset') as HTMLButtonElement;
    const feedback = document.getElementById('export-feedback')!;
    button.disabled = true; resetButton.disabled = true;
    button.textContent = '正在生成 PDF…'; feedback.textContent = ''; feedback.classList.remove('export-feedback--error');
    try {
      // 先让浏览器绘制按钮状态，再开始组装文件。
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      const bytes = await tool.reorder(buffer, result.sortOrder);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
      downloadFile(url, `${file.name.replace(/\.pdf$/i, '')}_${tool.suffix}.pdf`);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      feedback.textContent = '已发起下载，请在浏览器下载列表中查看文件。';
    } catch (err) {
      console.error('PDF 导出失败:', err);
      feedback.textContent = '导出失败，识别结果已保留。请点击「导出 PDF」重试。';
      feedback.classList.add('export-feedback--error');
    } finally {
      busy = false; button.disabled = false; resetButton.disabled = false;
      button.innerHTML = `${icon('download')}导出 PDF`; feedback.focus({ preventScroll: true });
    }
  }

  function reset(): void {
    if (busy) return;
    file = null; buffer = null; result = null; continuations.clear(); error = ''; step = 'upload'; render(true);
  }
  render();
}
