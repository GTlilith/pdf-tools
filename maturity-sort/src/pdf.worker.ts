/**
 * 自定义 PDF.js Worker 入口：先加载 ReadableStream 异步迭代 polyfill，
 * 再执行 pdf.js legacy Worker，保证旧浏览器（如 Edge 123）可用。
 */
import './stream-polyfill';
// @ts-ignore - 该文件无类型声明，仅作为副作用执行 Worker 逻辑
import 'pdfjs-dist/legacy/build/pdf.worker.min.mjs';
