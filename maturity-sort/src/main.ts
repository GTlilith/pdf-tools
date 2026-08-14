/**
 * 电子银行承兑汇票PDF页面排序工具
 * 主界面逻辑
 */

import {
  extractMaturityDates,
  sortByMaturityDate,
  reorderPdf,
  formatDate,
  type PageDateInfo,
  type SortResult,
} from './pdf-processor';

// ========== 状态管理 ==========

interface AppError {
  title: string;
  description: string;
  type: string;
  detail: string;
}

interface AppState {
  fileName: string;
  fileSize: number;
  fileBuffer: ArrayBuffer | null;
  pageInfos: PageDateInfo[];
  sortResult: SortResult | null;
  isProcessing: boolean;
  step: 'upload' | 'sorting' | 'result' | 'error';
  error: AppError | null;
}

const state: AppState = {
  fileName: '',
  fileSize: 0,
  fileBuffer: null,
  pageInfos: [],
  sortResult: null,
  isProcessing: false,
  step: 'upload',
  error: null,
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

// ========== 渲染函数 ==========

function render(): void {
  const app = $('#app');
  app.innerHTML = `
    <div class="app-container">
      <header class="app-header">
        <h1 class="app-title">汇票到期日排序工具</h1>
        <p class="app-subtitle">按汇票到期日对PDF页面重新排序，本地处理无需联网</p>
      </header>

      <div class="steps">
        <div class="step ${state.step === 'upload' ? 'step--active' : 'step--done'}">
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
    default:
      return renderUploadStep();
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
  const parsed = total - (hasUnparsed ? pages.filter((p) => p.maturityDate === null).length : 0);

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
          <span>部分页面未识别到"汇票到期日"，这些页面将作为续页紧跟其所属的有日期页面</span>
        </div>
      ` : ''}

      <div class="result-table-wrapper">
        <table class="result-table">
          <thead>
            <tr>
              <th>排序后位置</th>
              <th>原始页码</th>
              <th>汇票到期日</th>
            </tr>
          </thead>
          <tbody>
            ${pages.map((page, idx) => `
              <tr class="${page.maturityDate === null ? 'row--unparsed' : ''}">
                <td>${idx + 1}</td>
                <td>第 ${page.pageIndex + 1} 页</td>
                <td>
                  <span class="date-badge ${page.maturityDate === null ? 'date-badge--none' : ''}">
                    ${formatDate(page.maturityDate)}
                  </span>
                </td>
              </tr>
            `).join('')}
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

// ========== 错误展示 ==========

function renderErrorStep(): string {
  const err = state.error;
  if (!err) return '';

  const iconColors: Record<string, string> = {
    invalid: '#DC2626',
    encrypted: '#DC2626',
    worker: '#D97706',
    network: '#D97706',
    unknown: '#6B7280',
  };
  const color = iconColors[err.type] || iconColors.unknown;

  return `
    <div class="card">
      <div style="display:flex;align-items:flex-start;gap:12px;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;margin-top:2px;">
          <circle cx="12" cy="12" r="10" stroke="${color}" stroke-width="2"/>
          <path d="M12 8v4M12 16h.01" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <div style="flex:1;">
          <div style="font-size:16px;font-weight:600;color:#1F2937;margin-bottom:6px;">${err.title}</div>
          <div style="font-size:13px;color:#6B7280;line-height:1.6;">${err.detail}</div>
        </div>
      </div>
      <div style="margin-top:20px;text-align:center;">
        <button id="btn-retry" class="btn btn--primary">重新选择文件</button>
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
    if (file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) {
      handleFile(file);
    }
  });
}

function bindErrorEvents(): void {
  const btnRetry = document.getElementById('btn-retry');
  btnRetry?.addEventListener('click', () => {
    state.error = null;
    state.step = 'upload';
    render();
  });
}

function bindResultEvents(): void {
  const btnReset = document.getElementById('btn-reset');
  const btnExport = document.getElementById('btn-export');

  btnReset?.addEventListener('click', resetApp);
  btnExport?.addEventListener('click', handleExport);
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

    // 提取到期日
    state.pageInfos = await extractMaturityDates(
      arrayBuffer.slice(0),
      (current: number, total: number) => {
        const progressEl = document.getElementById('progress-text');
        if (progressEl) {
          progressEl.textContent = `正在解析第 ${current}/${total} 页`;
        }
      },
    );

    // 排序
    state.sortResult = sortByMaturityDate(state.pageInfos);
    state.step = 'result';
  } catch (err) {
    console.error('PDF处理失败:', err);
    const error = err instanceof Error ? err : new Error(String(err));
    const msg = error.message || '';
    if (error.name === 'InvalidPDFException' || /Invalid PDF structure/i.test(msg)) {
      state.error = {
        title: '无效的PDF文件',
        description: '该文件不是有效的PDF，或文件已损坏。',
        type: 'invalid-pdf',
        detail: '请确认文件为有效的电子银行承兑汇票PDF。',
      };
    } else if (error.name === 'PasswordException' || /password/i.test(msg)) {
      state.error = {
        title: 'PDF文件已加密',
        description: '该PDF需要密码才能打开，暂不支持加密文件。',
        type: 'encrypted',
        detail: '如需处理加密PDF，请联系开发人员添加解密支持。',
      };
    } else if (/worker/i.test(msg) || /Worker/i.test(msg)) {
      state.error = {
        title: 'PDF解析组件加载失败',
        description: '浏览器无法加载PDF解析引擎，请刷新页面重试。',
        type: 'worker',
        detail: '如使用企业内网，可能是网络策略限制了Worker加载。',
      };
    } else if (/network/i.test(msg) || /fetch/i.test(msg) || /Failed to fetch/i.test(msg)) {
      state.error = {
        title: '网络加载异常',
        description: 'PDF解析所需的组件加载失败，请检查网络连接后刷新页面重试。',
        type: 'network',
        detail: '可能原因：网络不稳定或安全策略阻止了资源加载。',
      };
    } else {
      state.error = {
        title: 'PDF处理失败',
        description: `处理过程中发生未预期错误：${msg || error.name || '未知错误'}`,
        type: 'unknown',
        detail: '请尝试刷新页面或更换浏览器后重试。',
      };
    }
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
    const newPdfBytes = await reorderPdf(
      state.fileBuffer,
      state.sortResult.sortOrder,
    );

    // 创建下载
    const blob = new Blob([newPdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // 在原文件名中插入 "_sorted"
    const baseName = state.fileName.replace(/\.pdf$/i, '');
    a.download = `${baseName}_按到期日排序.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('导出失败:', err);
    const error = err instanceof Error ? err : new Error(String(err));
    state.error = {
      title: 'PDF导出失败',
      description: `生成排序PDF时发生错误：${error.message || '未知错误'}`,
      type: 'export',
      detail: '请重新上传文件再试。',
    };
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
