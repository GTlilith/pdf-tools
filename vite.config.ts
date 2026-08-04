import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // 相对资源路径同时兼容 GitHub Pages 项目站点和自定义域名。
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        home: resolve(rootDir, 'index.html'),
        splitPrint: resolve(rootDir, 'split-print/index.html'),
        maturitySort: resolve(rootDir, 'maturity-sort/index.html'),
        amountSort: resolve(rootDir, 'amount-sort/index.html'),
      },
    },
  },
});
