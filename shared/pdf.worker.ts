/**
 * 三个工具共用的 PDF.js Worker 入口，构建为可独立缓存的 .js 文件。
 * 先加载 ReadableStream 异步迭代补丁，保留 Edge 123 等旧浏览器兼容性。
 */
import './stream-polyfill';
// @ts-ignore - 该文件无类型声明，仅作为副作用执行 Worker 逻辑
import 'pdfjs-dist/legacy/build/pdf.worker.min.mjs';
