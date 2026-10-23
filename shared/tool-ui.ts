export type ToolId = 'split-print' | 'maturity-sort' | 'amount-sort';
export type ToolStep = 'upload' | 'processing' | 'result' | 'error';

const tools: { id: ToolId; name: string; title: string; description: string; rule: string }[] = [
  { id: 'split-print', name: '插页打印', title: '拆分汇票插页打印', description: '按票据号码分组，为奇数页票据补入空白页，方便双面打印。', rule: '同一张票据连续排列 · 奇数页后补空白页' },
  { id: 'maturity-sort', name: '到期日排序', title: '汇票到期日排序', description: '按到期日从晚到早排列汇票，续页随所属票据一起移动。', rule: '到期日从晚到早 · 保留票据与续页关系' },
  { id: 'amount-sort', name: '金额排序', title: '汇票金额排序', description: '按票据金额从大到小排列汇票，续页随所属票据一起移动。', rule: '金额从大到小 · 保留票据与续页关系' },
];

export function icon(name: 'back' | 'file' | 'upload' | 'lock' | 'check' | 'alert' | 'download'): string {
  const paths = {
    back: '<path d="m12 5-7 7 7 7M5 12h14"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 14h8M8 17h5"/>',
    upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  };
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function toolShell(id: ToolId, content: string): string {
  const tool = tools.find(tool => tool.id === id)!;
  return `<a class="skip-link" href="#workspace">跳到文件处理</a>
    <header class="site-header"><nav class="site-nav" aria-label="工具导航">
      <a class="back-link" href="../">${icon('back')}<span>返回首页</span></a>
      <a class="site-brand" href="../">${icon('file')}<span>汇票 PDF 工具</span></a>
      <div class="tool-nav">${tools.map(item => `<a href="../${item.id}/" ${item.id === id ? 'aria-current="page"' : ''}>${item.name}</a>`).join('')}</div>
    </nav></header>
    <main class="app-container" id="workspace" tabindex="-1">
      <header class="app-header"><div><p class="eyebrow">汇票处理工作台</p><h1 class="app-title">${tool.title}</h1><p class="app-subtitle">${tool.description}</p></div><span class="local-badge">${icon('lock')}文件不上传</span></header>
      ${content}
      <footer class="tool-footer"><span>${icon('lock')}文件仅在当前浏览器处理</span><span>Powered by Li Shuo</span></footer>
    </main>`;
}

export function renderSteps(step: ToolStep): string {
  const active = step === 'processing' ? 1 : step === 'result' ? 2 : 0;
  return `<ol class="steps" aria-label="处理步骤">${['导入文件', '识别与处理', '检查并导出'].map((label, index) => `<li class="step ${index === active ? 'step--active' : index < active ? 'step--done' : ''}" ${index === active ? 'aria-current="step"' : ''}><span class="step__number">${index < active ? icon('check') : index + 1}</span><span class="step__label">${label}</span></li>`).join('')}</ol>`;
}

export function renderUpload(id: ToolId): string {
  const tool = tools.find(tool => tool.id === id)!;
  return `<section class="card upload-card" aria-label="导入 PDF">
    <div class="section-heading"><h2>导入汇票文件</h2><span>每次处理一个 PDF</span></div>
    <div class="upload-zone" id="upload-zone">
      <div class="upload-zone__icon">${icon('upload')}</div><p class="upload-zone__text">将 PDF 文件拖到这里</p><p class="upload-zone__subtext">或使用下方按钮选择本机文件</p>
      <label class="btn btn--primary file-picker">${icon('file')}选择 PDF 文件<input id="file-input" type="file" accept=".pdf,application/pdf" aria-label="选择 PDF 文件" /></label>
      <p class="upload-zone__hint">支持电子汇票 PDF · 扫描件暂不支持文字识别</p>
    </div>
    <p class="input-feedback" id="input-feedback" role="alert" hidden></p>
    <div class="upload-notice">${icon('lock')}<span>读取、处理和导出均在本机完成，PDF 不会上传至服务器。</span></div>
    <div class="usage-note"><strong>处理规则</strong><p>${tool.rule}</p></div>
  </section>`;
}

export function bindUpload(onFile: (file: File) => void | Promise<void>): void {
  const zone = document.getElementById('upload-zone')!;
  const input = document.getElementById('file-input') as HTMLInputElement;
  const accept = (files: ArrayLike<File> | null) => {
    const feedback = document.getElementById('input-feedback')!;
    if (!files?.length) return;
    const file = files[0];
    if (files.length !== 1 || (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') || file.size === 0) {
      feedback.textContent = files.length !== 1 ? '请每次选择一个 PDF 文件。' : file.size === 0 ? '文件为空，请选择包含汇票内容的 PDF。' : '文件格式不支持，请选择 PDF 文件。';
      feedback.hidden = false;
      input.value = '';
      return;
    }
    feedback.hidden = true;
    void Promise.resolve().then(() => onFile(file)).catch(error => {
      console.error('文件导入失败:', error);
      feedback.textContent = readableError(error);
      feedback.hidden = false;
    });
  };
  // 使用原生 file input 打开选择器，不在父容器中再次调用 input.click()。
  // 先保存 File，再清空控件，允许重新选择同一文件；input/change 只处理一次。
  const handleSelection = () => {
    const files = Array.from(input.files ?? []);
    if (!files.length) return;
    input.value = '';
    accept(files);
  };
  input.addEventListener('input', handleSelection);
  input.addEventListener('change', handleSelection);
  let dragDepth = 0;
  zone.addEventListener('dragenter', event => { event.preventDefault(); dragDepth++; zone.classList.add('upload-zone--dragover'); });
  zone.addEventListener('dragover', event => event.preventDefault());
  zone.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; zone.classList.remove('upload-zone--dragover'); } });
  zone.addEventListener('drop', event => {
    event.preventDefault(); dragDepth = 0; zone.classList.remove('upload-zone--dragover'); accept(event.dataTransfer?.files ?? null);
  });
}

export function renderProcessing(fileName: string): string {
  return `<section class="card processing" aria-label="文件处理中" aria-busy="true"><div class="spinner" aria-hidden="true"></div><h2>正在处理汇票</h2><p class="processing__filename">${escapeHtml(fileName)}</p><p id="progress-text" role="status">正在读取 PDF…</p><progress id="progress-bar" max="100" value="0" aria-label="文件处理进度"></progress><p class="processing__hint">请保持页面打开，完成后可检查并导出结果。</p></section>`;
}

export function updateProgress(value: number, text: string): void {
  const bar = document.getElementById('progress-bar') as HTMLProgressElement | null;
  if (bar) bar.value = value;
  const label = document.getElementById('progress-text');
  if (label) label.textContent = text;
}

export function renderError(message: string): string {
  return `<section class="card error-display" role="alert"><div class="error-icon">${icon('alert')}</div><h2>文件处理失败</h2><p>${escapeHtml(message)}</p><button class="btn btn--primary" id="btn-retry">重新选择文件</button></section>`;
}

export function fileInfo(name: string, meta: string): string {
  return `<div class="file-info"><span class="file-icon">${icon('file')}</span><div class="file-info__details"><h2 class="file-info__name">${escapeHtml(name)}</h2><p class="file-info__meta">${escapeHtml(meta)}</p></div><span class="completion-badge">${icon('check')}处理完成</span></div>`;
}

export function resultActions(): string {
  return `<div class="actions"><button class="btn btn--secondary" id="btn-reset">重新选择文件</button><button class="btn btn--primary" id="btn-export">${icon('download')}导出 PDF</button></div><p class="export-feedback" id="export-feedback" role="status" tabindex="-1"></p>`;
}

export function downloadFile(url: string, name: string): void {
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
}

export function focusContent(): void {
  const target = document.querySelector<HTMLElement>('.card');
  if (target) { target.tabIndex = -1; target.focus({ preventScroll: true }); }
}

export function readableError(error: unknown): string {
  if (error instanceof Error && error.name === 'NotReadableError') return '无法读取所选文件。请确认文件已下载到本机、仍可访问，再重新选择。';
  const message = error instanceof Error ? error.message : String(error);
  if (/password|encrypted/i.test(message)) return '此 PDF 已加密。请先保存为无需密码的 PDF，再重新选择。';
  if (/invalid.*pdf|pdf.*invalid/i.test(message)) return '无法读取此 PDF，文件可能已损坏。请确认文件可以正常打开，或重新导出后再试。';
  if (/worker|fetch|network/i.test(message)) return '处理组件加载失败。请刷新页面后重试，或使用较新版本的 Edge / Chrome 浏览器。';
  return '无法完成处理。请确认文件为可提取文字的电子汇票 PDF，或重新导出文件后再试。';
}
