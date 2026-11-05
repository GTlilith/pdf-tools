/**
 * 根据排序结果生成新的PDF文件
 *
 * 核心策略：直接在PDF二进制数据中替换 Pages/Kids 数组的页面引用顺序。
 * 不使用 pdf-lib 重新序列化，因为：
 * 1. pdf-lib 的 copyPages 会丢失表单字段、注解、嵌入字体等内容
 * 2. pdf-lib 的 save（即使 useObjectStreams:false）重新序列化字典时，
 *    对于存在重复对象编号的PDF，会用后一个覆盖前一个，导致映射表丢失
 *
 * 二进制替换方案仅修改 Kids 数组中页面引用的排列顺序，
 * 文件其余部分（xref、对象流、字体子集等）完全原样保留。
 */
export async function reorderPdf(
  originalBuffer: ArrayBuffer,
  sortOrder: number[],
): Promise<Uint8Array> {
  if (new Set(sortOrder).size !== sortOrder.length || sortOrder.some(index => !Number.isInteger(index) || index < 0 || index >= sortOrder.length)) {
    throw new Error('排序页码必须完整且不重复，不能包含越界页码。');
  }
  // 优先尝试二进制重排（快、且完整保留原文件结构）；
  // 对多层页面树或压缩结构的新版PDF会失败，此时回退到 pdf-lib 重新组装。
  try {
    return reorderPdfBinary(originalBuffer, sortOrder);
  } catch (err) {
    console.warn('二进制重排失败，回退 pdf-lib：', err);
    return reorderPdfWithPdfLib(originalBuffer, sortOrder);
  }
}

/**
 * 使用 pdf-lib 复制页面并按排序重新组装，兼容多层页面树 / 新版式PDF。
 */
async function reorderPdfWithPdfLib(
  originalBuffer: ArrayBuffer,
  sortOrder: number[],
): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const src = await PDFDocument.load(originalBuffer, { ignoreEncryption: true });
  const pageCount = src.getPageCount();
  if (sortOrder.length !== pageCount) {
    throw new Error(
      `页面数量不匹配: PDF有${pageCount}页, 排序规则有${sortOrder.length}项`,
    );
  }
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, sortOrder);
  copied.forEach((pg) => out.addPage(pg));
  return out.save({ useObjectStreams: false });
}

/**
 * 二进制级别重排：直接改写单层 Pages/Kids 数组的页面引用顺序。
 */
function reorderPdfBinary(
  originalBuffer: ArrayBuffer,
  sortOrder: number[],
): Uint8Array {
  // 将 ArrayBuffer 转为二进制字符串进行操作
  const bytes = new Uint8Array(originalBuffer);
  // 分块转换，避免为每个字节创建独立字符串。
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  }
  const pdfStr = chunks.join('');

  // 1. 定位 Pages 字典中的 Kids 数组（兼容 'Kids[' 与 'Kids ['）
  const kidsMatch = /Kids\s*\[/.exec(pdfStr);
  if (!kidsMatch) {
    throw new Error('无法在PDF中找到Pages/Kids数组');
  }
  const kidsStart = kidsMatch.index;

  // 找到 Kids[ 的结束位置
  const arrayContentStart = kidsStart + kidsMatch[0].length;
  let bracketDepth = 1;
  let arrayContentEnd = arrayContentStart;
  while (arrayContentEnd < pdfStr.length && bracketDepth > 0) {
    if (pdfStr[arrayContentEnd] === '[') bracketDepth++;
    else if (pdfStr[arrayContentEnd] === ']') bracketDepth--;
    if (bracketDepth > 0) arrayContentEnd++;
  }
  if (bracketDepth !== 0) throw new Error('Kids数组未闭合');
  // arrayContentEnd 现在指向 ']' 字符

  const kidsContent = pdfStr.substring(arrayContentStart, arrayContentEnd);

  // 2. 解析 Kids 数组中的页面引用（格式: "X Y R"）
  const refRegex = /(\d+)\s+(\d+)\s+R/g;
  const pageRefs: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = refRegex.exec(kidsContent)) !== null) {
    pageRefs.push(match[0]);
  }

  if (pageRefs.length === 0) {
    throw new Error('Kids数组中未找到页面引用');
  }

  if (pageRefs.length !== sortOrder.length) {
    throw new Error(
      `页面数量不匹配: Kids数组有${pageRefs.length}个引用, 排序规则有${sortOrder.length}项`,
    );
  }

  if (kidsContent.replace(/(\d+)\s+(\d+)\s+R/g, '').trim()) {
    throw new Error('Kids数组包含无法直接重排的内容');
  }

  // 3. 压缩引用间空白，再补齐原长度，确保所有xref和startxref偏移保持有效。
  const reordered = sortOrder.map(index => pageRefs[index]).join(' ');
  if (reordered.length > kidsContent.length) {
    throw new Error('重排后的Kids数组无法保持原长度');
  }
  const newKidsContent = reordered.padEnd(kidsContent.length, ' ');

  // 4. 仅覆盖原数组所在字节，数组之外（包括xref）完全保留。
  const result = bytes.slice();
  for (let i = 0; i < newKidsContent.length; i++) {
    result[arrayContentStart + i] = newKidsContent.charCodeAt(i);
  }

  return result;
}
