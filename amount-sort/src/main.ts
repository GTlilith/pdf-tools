/**
 * 电子银行承兑汇票PDF页面排序工具
 * 按票据金额从大到小排序，主界面逻辑
 */

import {
  extractAmounts,
  sortByAmount,
  reorderPdf,
  formatAmount,
  type PageAmountInfo,
  type SortResult,
} from './pdf-processor';

// ========== 状态管理 ==========

interface AppState {
  fileName: string;
  fileSize: number;
  fileBuffer: ArrayBuffer | null;
  pageInfos: PageAmountInfo[];
  sortResult: SortResult | null;
  isProcessing: boolean;
  step: 'upload' | 'sorting' | 'result' | 'error';
  errorMessage: string;
}

const state: AppState = {
  fileName: '',
  fileSize: 0,
  fileBuffer: null,
  pageInfos: [],
  sortResult: null,
  isProcessing: false,
  step: 'upload',
  errorMessage: '',
};

// ========== DOM 工具 ==========

function $(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  return el;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * 判断某页是否为续页（紧跟在上一张有金额的票据之后、本身无金额的页面）
 * 用于 UI 中区分主票页面与续页
 */
function isContinuationPage(pages: PageAmountInfo[], index: number): boolean {
  if (pages[index].amount !== null) return false;
  // 找到前一个有金额的页面
  for (let i = index - 1; i >= 0; i--) {
    if (pages[i].amount !== null) return true;
    // 如果前面的也是无金额页面，仍然算续页（同组的续页）
  }
  return false;
}

// ========== 渲染函数 ==========

function render(): void {
  const app = $('#app');
  app.innerHTML = `
    <div class="app-container">
      <header class="app-header">
        <h1 class="app-title">汇票金额排序工具</h1>
        <p class="app-subtitle">按票据金额从大到小对PDF页面重新排序，本地处理无需联网</p>
      </header>

      <div class="steps">
        <div class="step ${state.step === 'upload' ? 'step--active' : state.step === 'error' ? 'step--active' : 'step--done'}">
          <span class="step__number">1</span>
          <span class="step__label">导入文件</span>
        </div>
        <div class="step__line"></div>
        <div class="step ${state.step === 'sorting' ? 'step--active' : state.step === 'result' ? 'step--done' : ''}">
          <span class="step__number">2</span>
          <span class="step__label">解析排序</span>
        </div>
        <div class="step__line"></div>
        <div class="step ${state.step === 'result' ? 'step--active' : ''}">
          <span class="step__number">3</span>
          <span class="step__label">导出文件</span>
        </div>
      </div>

      ${renderStepContent()}
    </div>
  `;

  bindEvents();
}

function renderStepContent(): string {
  switch (state.step) {
    case 'upload':
      return renderUploadStep();
    case 'sorting':
      return renderSortingStep();
    case 'result':
      return renderResultStep();
    case 'error':
      return renderErrorStep();
  }
}

function renderUploadStep(): string {
  return `
    <div class="card">
      <div class="upload-zone" id="upload-zone">
        <svg class="upload-zone__icon" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M24 32V16M24 16L18 22M24 16L30 22" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M8 32V36C8 38.2091 9.79086 40 12 40H36C38.2091 40 40 38.2091 40 36V32" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <p class="upload-zone__text">拖拽PDF文件到此处</p>
        <p class="upload-zone__subtext">或点击选择文件</p>
        <input type="file" id="file-input" accept=".pdf" class="upload-zone__input" />
      </div>
      <div class="upload-notice">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 5V8.5M8 11H8.007M14 8C14 11.3137 11.3137 14 8 14C4.68629 14 2 11.3137 2 8C2 4.68629 4.68629 2 8 2C11.3137 2 14 4.68629 14 8Z" stroke="#6B7280" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <span>所有处理均在浏览器本地完成，文件不会上传至任何服务器</span>
      </div>
    </div>
  `;
}

function renderSortingStep(): string {
  return `
    <div class="card">
      <div class="processing">
        <div class="spinner"></div>
        <p class="processing__text">正在解析PDF文件...</p>
        <p class="processing__subtext" id="progress-text">读取中</p>
      </div>
    </div>
  `;
}

function renderResultStep(): string {
  if (!state.sortResult) return '';

  const { pages, hasUnparsed } = state.sortResult;
  const total = pages.length;
  const unparsedCount = pages.filter((p) => p.amount === null).length;
  const parsed = total - unparsedCount;

  return `
    <div class="card">
      <div class="file-info">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M6 2H12L16 6V17C16 17.5523 15.5523 18 15 18H5C4.44772 18 4 17.5523 4 17V3C4 2.44772 4.44772 2 5 2H6Z" stroke="#1E40AF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M12 2V6H16" stroke="#1E40AF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div class="file-info__details">
          <span class="file-info__name">${state.fileName}</span>
          <span class="file-info__meta">${total} 页 · ${formatFileSize(state.fileSize)} · 已识别 ${parsed}/${total} 页</span>
        </div>
      </div>

      ${hasUnparsed ? `
        <div class="warning-banner">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 5V8.5M8 11H8.007M14 8C14 11.3137 11.3137 14 8 14C4.68629 14 2 11.3137 2 8C2 4.68629 4.68629 2 8 2C11.3137 2 14 4.68629 14 8Z" stroke="#DC2626" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <span>${unparsedCount} 页未识别到"票据金额"，将作为续页紧跟其所属票据</span>
        </div>
      ` : ''}

      <div class="result-table-wrapper">
        <table class="result-table">
          <thead>
            <tr>
              <th>排序后位置</th>
              <th>原始页码</th>
              <th>票据金额</th>
            </tr>
          </thead>
          <tbody>
            ${pages.map((page, idx) => {
              const isCont = isContinuationPage(pages, idx);
              const rowClass = isCont ? 'row--continuation' : (page.amount === null ? 'row--unparsed' : '');
              return `
                <tr class="${rowClass}">
                  <td>${idx + 1}</td>
                  <td>第 ${page.pageIndex + 1} 页</td>
                  <td>
                    <span class="amount-badge ${page.amount === null ? 'amount-badge--none' : ''}">
                      ${formatAmount(page.amount)}
                    </span>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>

      <div class="actions">
        <button class="btn btn--secondary" id="btn-reset">重新选择文件</button>
        <button class="btn btn--primary" id="btn-export">导出排序后的PDF</button>
      </div>
    </div>
  `;
}

// ========== 事件绑定 ==========

function renderErrorStep(): string {
  return `
    <div class="card">
      <div class="error-display">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="#DC2626" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <p class="error-display__title">文件处理失败</p>
        <p class="error-display__message">${state.errorMessage}</p>
        <button class="btn btn--primary" id="btn-retry">重新选择文件</button>
      </div>
    </div>
  `;
}

// ========== 事件绑定 ==========

function bindEvents(): void {
  switch (state.step) {
    case 'upload':
      bindUploadEvents();
      break;
    case 'result':
      bindResultEvents();
      break;
    case 'error':
      bindErrorEvents();
      break;
  }
}

function bindUploadEvents(): void {
  const zone = $('#upload-zone');
  const input = document.getElementById('file-input') as HTMLInputElement;

  // 点击上传
  zone.addEventListener('click', () => input.click());

  // 文件选择
  input.addEventListener('change', (e: Event) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) handleFile(file);
  });

  // 拖拽事件
  zone.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    zone.classList.add('upload-zone--dragover');
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('upload-zone--dragover');
  });

  zone.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    zone.classList.remove('upload-zone--dragover');
    const file = e.dataTransfer?.files[0];
    // 某些操作系统（如 Linux）拖拽时 file.type 可能为空，
    // 因此同时检查 MIME 类型和文件扩展名
    if (file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) {
      handleFile(file);
    }
  });
}

function bindResultEvents(): void {
  const btnReset = document.getElementById('btn-reset');
  const btnExport = document.getElementById('btn-export');

  btnReset?.addEventListener('click', resetApp);
  btnExport?.addEventListener('click', handleExport);
}

function bindErrorEvents(): void {
  const btnRetry = document.getElementById('btn-retry');
  btnRetry?.addEventListener('click', resetApp);
}

// ========== 业务逻辑 ==========

async function handleFile(file: File): Promise<void> {
  if (state.isProcessing) return;
  state.isProcessing = true;
  state.fileName = file.name;
  state.fileSize = file.size;

  // 切换到排序步骤
  state.step = 'sorting';
  render();

  try {
    const arrayBuffer = await file.arrayBuffer();
    state.fileBuffer = arrayBuffer;

    // 提取金额
    state.pageInfos = await extractAmounts(
      arrayBuffer.slice(0),
      (current: number, total: number) => {
        const progressEl = document.getElementById('progress-text');
        if (progressEl) {
          progressEl.textContent = `正在解析第 ${current}/${total} 页`;
        }
      },
    );

    // 排序（按金额从大到小）
    state.sortResult = sortByAmount(state.pageInfos);
    state.step = 'result';
  } catch (err: unknown) {
    console.error('PDF处理失败:', err);
    // 根据错误类型生成可读的错误信息
    let message = '请确认文件为有效的电子银行承兑汇票PDF。';
    if (err instanceof Error) {
      const errMsg = err.message || '';
      if (errMsg.includes('InvalidPDF') || errMsg.includes('Invalid PDF')) {
        message = '文件不是有效的PDF格式，请检查文件是否损坏。';
      } else if (errMsg.includes('password')) {
        message = 'PDF文件已加密，暂不支持加密PDF。';
      } else if (errMsg.includes('Worker') || errMsg.includes('worker')) {
        message = 'PDF处理引擎加载失败，请刷新页面重试。如持续失败，请尝试使用Chrome浏览器。';
      } else if (errMsg.includes('Kids')) {
        message = 'PDF结构解析失败，该PDF格式暂不支持。';
      } else if (errMsg.includes('fetch') || errMsg.includes('network') || errMsg.includes('Failed')) {
        message = 'PDF处理引擎加载失败，请检查网络连接后刷新页面重试。';
      }
    }
    state.errorMessage = message;
    state.step = 'error';
  } finally {
    state.isProcessing = false;
    render();
  }
}

async function handleExport(): Promise<void> {
  if (!state.fileBuffer || !state.sortResult) return;

  const btnExport = document.getElementById('btn-export') as HTMLButtonElement;
  if (btnExport) {
    btnExport.disabled = true;
    btnExport.textContent = '正在生成...';
  }

  try {
    const newPdfBytes = reorderPdf(
      state.fileBuffer,
      state.sortResult.sortOrder,
    );

    // 创建下载
    const blob = new Blob([newPdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // 在原文件名中插入 "_按金额排序"
    const baseName = state.fileName.replace(/\.pdf$/i, '');
    a.download = `${baseName}_按金额排序.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err: unknown) {
    console.error('导出失败:', err);
    state.errorMessage = 'PDF导出失败，请重试。如持续失败，请尝试使用Chrome浏览器。';
    state.step = 'error';
  } finally {
    if (btnExport) {
      btnExport.disabled = false;
      btnExport.textContent = '导出排序后的PDF';
    }
  }
}

function resetApp(): void {
  state.fileName = '';
  state.fileSize = 0;
  state.fileBuffer = null;
  state.pageInfos = [];
  state.sortResult = null;
  state.isProcessing = false;
  state.step = 'upload';
  render();
}

// ========== 初始化 ==========

export function initApp(): void {
  render();
}
