import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// 用项目已有的 TypeScript 转译真实源码，兼容 Node 22，无需额外测试依赖。
export async function load(url, context, nextLoad) {
  if (!url.endsWith('.ts')) return nextLoad(url, context);
  const source = await readFile(new URL(url), 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    fileName: new URL(url).pathname,
  });
  return { format: 'module', source: result.outputText, shortCircuit: true };
}
