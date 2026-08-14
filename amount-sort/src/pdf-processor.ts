/**
 * PDF处理核心模块
 * 负责PDF文本提取、金额解析、页面重排序
 * 全部在浏览器本地运行，不涉及任何网络请求
 */

import './stream-polyfill';
import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import PdfWorker from './pdf.worker?worker&inline';

// 将 PDF.js Worker 内联，避免托管平台阻止动态加载独立的 .mjs Worker。
pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();

/** 页面解析结果 */
export interface PageAmountInfo {
  pageIndex: number;       // 原始页码（0-based）
  amount: number | null;   // 解析出的金额（数值，单位：元）
  rawAmountText: string;   // 原始金额文本
  pageText: string;        // 页面提取文本（用于调试）
}

/** 排序结果 */
export interface SortResult {
  pages: PageAmountInfo[];
  sortOrder: number[];     // 排序后的页码索引数组
  hasUnparsed: boolean;    // 是否有未能识别金额的页面
}

// ========== 中文数字转换 ==========

const CN_DIGIT_MAP: Record<string, number> = {
  '零': 0, '〇': 0,
  '壹': 1, '一': 1,
  '贰': 2, '二': 2,
  '叁': 3, '三': 3,
  '肆': 4, '四': 4,
  '伍': 5, '五': 5,
  '陆': 6, '六': 6,
  '柒': 7, '七': 7,
  '捌': 8, '八': 8,
  '玖': 9, '九': 9,
};

/** 中文大写金额单位 */
const CN_AMOUNT_UNITS: Record<string, number> = {
  '仟': 1000, '千': 1000,
  '佰': 100, '百': 100,
  '拾': 10, '十': 10,
};

// ========== 中文大写金额解析 ==========

/**
 * 解析一个节（个级/万级/亿级）内的中文数字
 * 例如: 壹佰贰拾叁 → 123, 肆仟伍佰 → 4500
 */
function parseChineseSection(text: string): number {
  let value = 0;
  let current = 0;
  let hasDigit = false;

  for (const ch of text) {
    const digit = CN_DIGIT_MAP[ch];
    if (digit !== undefined) {
      current = digit;
      hasDigit = true;
    } else {
      const unit = CN_AMOUNT_UNITS[ch];
      if (unit !== undefined) {
        // 拾/十 前面没有数字则视为 1
        value += (unit === 10 && !hasDigit ? 1 : current) * unit;
        current = 0;
        hasDigit = false;
      }
      // 零 不做任何处理，仅占位
    }
  }
  // 剩余的个位数字
  value += current;
  return value;
}

/**
 * 解析中文大写金额为数值
 * 支持格式:
 * - 壹佰贰拾叁万肆仟伍佰陆拾柒元捌角玖分
 * - 壹佰万元整
 * - 零元整
 * - 人民币壹佰贰拾叁元肆角伍分
 */
export function parseChineseAmount(text: string): number | null {
  // 清理：去掉"人民币"前缀和"整"/"正"后缀
  let cleaned = text.replace(/人民币/g, '').replace(/[整正]$/, '').trim();
  if (!cleaned) return null;

  // 必须包含"元"
  const yuanIndex = cleaned.indexOf('元');
  if (yuanIndex < 0) return null;

  const intPart = cleaned.substring(0, yuanIndex);
  const decPart = cleaned.substring(yuanIndex + 1);

  // 解析整数部分
  let intValue = 0;

  // 处理亿级
  const yiIndex = intPart.indexOf('亿');
  if (yiIndex >= 0) {
    const yiSection = intPart.substring(0, yiIndex);
    intValue += parseChineseSection(yiSection) * 100000000;
    const remainder = intPart.substring(yiIndex + 1);
    // 处理万级和个级
    const wanIndex = remainder.indexOf('万');
    if (wanIndex >= 0) {
      intValue += parseChineseSection(remainder.substring(0, wanIndex)) * 10000;
      intValue += parseChineseSection(remainder.substring(wanIndex + 1));
    } else {
      intValue += parseChineseSection(remainder);
    }
  } else {
    // 没有亿级，处理万级和个级
    const wanIndex = intPart.indexOf('万');
    if (wanIndex >= 0) {
      intValue += parseChineseSection(intPart.substring(0, wanIndex)) * 10000;
      intValue += parseChineseSection(intPart.substring(wanIndex + 1));
    } else {
      intValue += parseChineseSection(intPart);
    }
  }

  // 解析小数部分
  let decValue = 0;
  const jiaoMatch = decPart.match(/([零壹贰叁肆伍陆柒捌玖])\s*角/);
  if (jiaoMatch) {
    decValue += (CN_DIGIT_MAP[jiaoMatch[1]] ?? 0) * 0.1;
  }
  const fenMatch = decPart.match(/([零壹贰叁肆伍陆柒捌玖])\s*分/);
  if (fenMatch) {
    decValue += (CN_DIGIT_MAP[fenMatch[1]] ?? 0) * 0.01;
  }

  const result = Math.round((intValue + decValue) * 100) / 100;
  return result >= 0 ? result : null;
}

// ========== 金额提取（策略1：文本模式匹配） ==========

/**
 * 从页面文本中提取金额
 * 支持多种格式:
 * - ¥1,000,000.00 / ￥1000000.00
 * - 票据金额（小写）¥1,000,000.00
 * - 中文大写: 壹佰万元整
 */
function extractAmountOnce(text: string): { amount: number | null; raw: string } {
  // 策略1: 匹配 "票据金额" 或 "出票金额" 后的 ¥xxx,xxx.xx 格式
  const currencyRegex = /(?:票据金额|出票金额|金额)\s*[（(]?\s*小写\s*[）)]?\s*[：:]*\s*[¥￥]\s*([\d,]+\.?\d*)/;
  const currencyMatch = text.match(currencyRegex);
  if (currencyMatch) {
    const amountStr = currencyMatch[1].replace(/,/g, '');
    const amount = parseFloat(amountStr);
    if (!isNaN(amount) && amount > 0) {
      return { amount, raw: `¥${currencyMatch[1]}` };
    }
  }

  // 策略2: 匹配 ¥xxx,xxx.xx（不依赖关键词，带千分位逗号）
  const standaloneCurrency = /[¥￥]\s*([\d]{1,3}(?:,\d{3})*\.\d{1,2})/;
  const standaloneMatch = text.match(standaloneCurrency);
  if (standaloneMatch) {
    const amountStr = standaloneMatch[1].replace(/,/g, '');
    const amount = parseFloat(amountStr);
    if (!isNaN(amount) && amount > 0) {
      return { amount, raw: `¥${standaloneMatch[1]}` };
    }
  }

  // 策略3: 匹配 ¥xxxxx.xx（无逗号的纯数字格式）
  const plainCurrency = /[¥￥]\s*([\d]+\.\d{1,2})\b/;
  const plainMatch = text.match(plainCurrency);
  if (plainMatch) {
    const amount = parseFloat(plainMatch[1]);
    if (!isNaN(amount) && amount > 0) {
      return { amount, raw: `¥${plainMatch[1]}` };
    }
  }

  // 策略4: 匹配中文大写金额（带关键词前缀）
  const cnAmountRegex = /(?:票据金额|出票金额|金额)\s*(?:人民币)?\s*[（(]?\s*大写\s*[）)]?\s*[：:]*\s*(?:人民币)?\s*([零壹贰叁肆伍陆柒捌玖拾佰仟万亿元角分整正]+)/;
  const cnMatch = text.match(cnAmountRegex);
  if (cnMatch) {
    const amount = parseChineseAmount(cnMatch[1]);
    if (amount !== null && amount > 0) {
      return { amount, raw: cnMatch[1] };
    }
  }

  // 策略5: 更宽松的中文大写匹配（"人民币"前缀）
  const looseCnRegex = /人民币\s*[（(]?\s*(?:大写)?\s*[）)]?\s*[：:]*\s*([零壹贰叁肆伍陆柒捌玖拾佰仟万亿元角分整正]+)/;
  const looseCnMatch = text.match(looseCnRegex);
  if (looseCnMatch) {
    const amount = parseChineseAmount(looseCnMatch[1]);
    if (amount !== null && amount > 0) {
      return { amount, raw: `人民币${looseCnMatch[1]}` };
    }
  }

  // 策略6: 匹配纯数字金额（xxx,xxx.xx 格式，无¥符号，带关键词前缀）
  const plainNumberRegex = /(?:票据金额|出票金额|金额)\s*[：:]*\s*([\d]{1,3}(?:,\d{3})*\.\d{2})/;
  const plainNumberMatch = text.match(plainNumberRegex);
  if (plainNumberMatch) {
    const amountStr = plainNumberMatch[1].replace(/,/g, '');
    const amount = parseFloat(amountStr);
    if (!isNaN(amount) && amount > 0) {
      return { amount, raw: plainNumberMatch[1] };
    }
  }

  return { amount: null, raw: '未识别' };
}

/**
 * 金额提取入口：先按原始文本匹配；失败后去除全部空白重试，
 * 兼容字段标签逐字分离的新版票据（如"票 据 金 额"）。
 */
function extractAmountFromText(text: string): { amount: number | null; raw: string } {
  const first = extractAmountOnce(text);
  if (first.amount !== null) return first;
  return extractAmountOnce(text.replace(/\s+/g, ''));
}

// ========== 网格提取（策略2：位置感知） ==========

/**
 * 12格网格标准序列及其对应位值
 * 十亿 亿 千万 百万 十万 万 千 百 十 元 角 分
 */
const GRID_SEQUENCE: readonly { label: string; value: number }[] = [
  { label: '十亿', value: 1e9 },
  { label: '亿', value: 1e8 },
  { label: '千万', value: 1e7 },
  { label: '百万', value: 1e6 },
  { label: '十万', value: 1e5 },
  { label: '万', value: 1e4 },
  { label: '千', value: 1e3 },
  { label: '百', value: 1e2 },
  { label: '十', value: 1e1 },
  { label: '元', value: 1e0 },
  { label: '角', value: 1e-1 },
  { label: '分', value: 1e-2 },
];

/** 带位置的文本项 */
interface PositionedItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 从PDF页面的网格中提取金额（策略2：位置感知提取）
 * 网格格式: 十亿 亿 千万 百万 十万 万 千 百 十 元 角 分
 * 每个格子包含一个数字（阿拉伯或中文大写）
 */
async function extractAmountFromGrid(
  page: PDFPageProxy,
): Promise<{ amount: number | null; raw: string }> {
  const textContent = await page.getTextContent();

  // 构建带位置的文本项列表
  const items: PositionedItem[] = [];
  for (const item of textContent.items) {
    if (!('str' in item)) continue;
    const ti = item as { str: string; transform: Array<number>; width: number; height: number };
    const str = ti.str.trim();
    if (!str) continue;
    items.push({
      str,
      x: ti.transform[4],
      y: ti.transform[5],
      width: ti.width,
      height: ti.height,
    });
  }

  if (items.length === 0) {
    return { amount: null, raw: '未识别' };
  }

  // 查找网格表头项
  // 表头可能是 "十亿" 或单独的 "十" + "亿"
  // 也可能是 "千万" "百万" "十万" "千" "百" "十" "万" "元" "角" "分" 等单/双字
  const headerLabels = ['十亿', '千万', '百万', '十万', '亿', '千', '百', '十', '万', '元', '角', '分'];

  // 找到所有可能是表头的项
  const headerItems: { item: PositionedItem; label: string }[] = [];
  for (const item of items) {
    for (const label of headerLabels) {
      if (item.str === label && item.str.length <= 2) {
        headerItems.push({ item, label });
        break;
      }
    }
  }

  // 至少找到5个表头才认为是网格格式
  if (headerItems.length < 5) {
    return { amount: null, raw: '未识别' };
  }

  // 按 x 坐标排序表头（从左到右）
  headerItems.sort((a, b) => a.item.x - b.item.x);

  // 确定表头的 y 坐标（取中位数）
  const headerYValues = headerItems.map((h) => h.item.y).sort((a, b) => a - b);
  const headerY = headerYValues[Math.floor(headerYValues.length / 2)];

  // 找到数字行：在表头下方、x 位置相近的数字项
  const allDigits = /^[0-9零壹贰叁肆伍陆柒捌玖]$/;
  const digitItems: PositionedItem[] = [];

  for (const item of items) {
    // 数字项应该在表头下方（y 更小，因为 PDF y 轴从下到上）
    // 且 y 差距不能太大（同一行或下一行）
    if (item.y < headerY && headerY - item.y < 50) {
      // 是单个数字
      if (allDigits.test(item.str)) {
        digitItems.push(item);
      }
    }
  }

  if (digitItems.length === 0) {
    return { amount: null, raw: '未识别' };
  }

  // 贪心二分图匹配：按距离升序排列所有(表头,数字)配对，最近优先匹配
  // 避免左到右逐表头贪心导致远距表头"抢"走数字（如亿位抢走千万位数字）
  const usedHeaders = new Set<number>();
  const usedDigits = new Set<number>();
  const pairDistances: Array<{ hi: number; di: number; dist: number }> = [];

  for (let hi = 0; hi < headerItems.length; hi++) {
    for (let di = 0; di < digitItems.length; di++) {
      const xDist = Math.abs(digitItems[di].x - headerItems[hi].item.x);
      // 格子宽度约17px，超过此距离不可能属于同一格
      if (xDist < 17) {
        pairDistances.push({ hi, di, dist: xDist });
      }
    }
  }
  pairDistances.sort((a, b) => a.dist - b.dist);

  // 记录每个表头匹配的数字项索引
  const headerToDigit = new Map<number, number>();
  for (const { hi, di } of pairDistances) {
    if (usedHeaders.has(hi) || usedDigits.has(di)) continue;
    headerToDigit.set(hi, di);
    usedHeaders.add(hi);
    usedDigits.add(di);
  }

  // 按表头顺序计算金额
  let totalAmount = 0;
  let matchedCount = 0;
  const digitChars: string[] = [];

  for (let hi = 0; hi < headerItems.length; hi++) {
    const di = headerToDigit.get(hi);
    if (di !== undefined) {
      const ch = digitItems[di].str;
      const arabicDigit = CN_DIGIT_MAP[ch] !== undefined ? CN_DIGIT_MAP[ch] : parseInt(ch, 10);
      if (!isNaN(arabicDigit)) {
        const multiplier = getMultiplierByIndex(hi, headerItems.length);
        totalAmount += arabicDigit * multiplier;
        digitChars.push(ch);
        matchedCount++;
      } else {
        digitChars.push('0');
      }
    } else {
      digitChars.push('0');
    }
  }

  if (matchedCount === 0) {
    return { amount: null, raw: '未识别' };
  }

  const rawText = digitChars.join('');
  return {
    amount: Math.round(totalAmount * 100) / 100,
    raw: `¥${totalAmount.toFixed(2)}`,
  };
}

/**
 * 根据表头在排序后序列中的位置索引映射位值
 *
 * 网格标准序列（12格）:
 *   十亿(1e9) 亿(1e8) 千万(1e7) 百万(1e6) 十万(1e5) 万(1e4) 千(1e3) 百(1e2) 十(1e1) 元(1e0) 角(1e-1) 分(1e-2)
 *
 * 实际PDF的表头可能缺少某些位（如去掉"十亿""亿"等高位），
 * 此时表头总数 < 12，需要根据序列长度和索引推断位值。
 *
 * 策略：右对齐映射——角分元始终在最右侧，高位按需截断。
 * 例如 9 格: 千万 百万 十万 万 千 百 十 元 角 分（去掉十亿、亿）
 * 例如 10 格: 亿 千万 百万 十万 万 千 百 十 元 角 分（去掉十亿）
 */
function getMultiplierByIndex(
  idx: number,
  totalHeaders: number,
): number {
  // 标准序列（从高位到低位）
  const FULL: readonly number[] = [1e9, 1e8, 1e7, 1e6, 1e5, 1e4, 1e3, 1e2, 1e1, 1e0, 1e-1, 1e-2];

  if (totalHeaders >= 12) {
    // 表头数量 >= 12，直接按索引映射
    return FULL[idx] ?? 1;
  }

  // 右对齐映射：角(1e-1)和分(1e-2)始终在最右两位
  // 从右侧数起，最后3位固定为 元/角/分
  const offset = 12 - totalHeaders; // 高位缺少的位数
  const mappedIdx = offset + idx;
  if (mappedIdx >= 0 && mappedIdx < FULL.length) {
    return FULL[mappedIdx];
  }
  return 1;
}

// ========== 主提取函数 ==========

/**
 * 从PDF文件的ArrayBuffer中提取每页的票据金额
 * 使用多策略：先尝试文本模式匹配，失败后尝试网格位置提取
 */
export async function extractAmounts(
  arrayBuffer: ArrayBuffer,
  onProgress?: (current: number, total: number) => void,
): Promise<PageAmountInfo[]> {
  const data = new Uint8Array(arrayBuffer);
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const totalPages = pdf.numPages;
  const results: PageAmountInfo[] = [];

  for (let i = 1; i <= totalPages; i++) {
    if (onProgress) onProgress(i, totalPages);

    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    // 拼接页面文本（用于文本模式匹配）
    const pageText = textContent.items
      .map((item) => ('str' in item ? String((item as Record<string, unknown>).str) : ''))
      .join(' ');

    // 策略1: 文本模式匹配
    let { amount, raw } = extractAmountFromText(pageText);

    // 策略2: 如果文本匹配失败，尝试网格位置提取
    if (amount === null) {
      const gridResult = await extractAmountFromGrid(page);
      if (gridResult.amount !== null) {
        amount = gridResult.amount;
        raw = gridResult.raw;
      }
    }

    results.push({
      pageIndex: i - 1,
      amount,
      rawAmountText: raw,
      pageText,
    });
  }

  return results;
}

// ========== 排序 ==========

/**
 * 对页面按金额排序（从大到小，降序）
 * 无法识别金额的页面视为前一个有金额页面的续页，紧跟其所属页面
 *
 * 分组逻辑：从原始顺序遍历，每个有金额的页面开启一个新组，
 * 后续无金额页面归入该组，直到遇到下一个有金额的页面。
 * 排序时按组首（有金额页面）的金额降序排列，组内保持原始顺序。
 */
export function sortByAmount(pages: PageAmountInfo[]): SortResult {
  interface PageGroup {
    anchorAmount: number;
    pages: PageAmountInfo[];
  }

  const groups: PageGroup[] = [];
  let currentGroup: PageGroup | null = null;

  for (const page of pages) {
    if (page.amount !== null) {
      // 有金额 → 开启新组
      currentGroup = {
        anchorAmount: page.amount,
        pages: [page],
      };
      groups.push(currentGroup);
    } else if (currentGroup !== null) {
      // 无金额但有前序组 → 归入当前组（续页）
      currentGroup.pages.push(page);
    } else {
      // 无金额且无前序组（文件开头就没识别到金额）→ 单独成组，排在最后
      currentGroup = {
        anchorAmount: -1, // 负值确保排到最后
        pages: [page],
      };
      groups.push(currentGroup);
    }
  }

  // 按组首金额降序排列（从大到小）
  groups.sort((a, b) => b.anchorAmount - a.anchorAmount);

  // 展平为排序结果
  const sorted = groups.flatMap((g) => g.pages);
  const sortOrder = sorted.map((p) => p.pageIndex);
  const hasUnparsed = sorted.some((p) => p.amount === null);

  return {
    pages: sorted,
    sortOrder,
    hasUnparsed,
  };
}

// ========== PDF重排序（二进制级别，原样复用） ==========

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
export function reorderPdf(
  originalBuffer: ArrayBuffer,
  sortOrder: number[],
): Uint8Array {
  // 将 ArrayBuffer 转为二进制字符串进行操作
  const bytes = new Uint8Array(originalBuffer);
  const pdfStr = Array.from(bytes)
    .map((b) => String.fromCharCode(b))
    .join('');

  // 1. 定位 Pages 字典中的 Kids 数组
  const kidsStart = pdfStr.indexOf('Kids[');
  if (kidsStart < 0) {
    throw new Error('无法在PDF中找到Pages/Kids数组');
  }

  // 找到 Kids[ 的结束位置
  const arrayContentStart = kidsStart + 5; // 'Kids[' 的长度
  let bracketDepth = 1;
  let arrayContentEnd = arrayContentStart;
  while (arrayContentEnd < pdfStr.length && bracketDepth > 0) {
    if (pdfStr[arrayContentEnd] === '[') bracketDepth++;
    else if (pdfStr[arrayContentEnd] === ']') bracketDepth--;
    if (bracketDepth > 0) arrayContentEnd++;
  }
  // arrayContentEnd 现在指向 ']' 字符

  const kidsContent = pdfStr.substring(arrayContentStart, arrayContentEnd);

  // 2. 解析 Kids 数组中的页面引用（格式: "X Y R"）
  const refRegex = /(\d+)\s+(\d+)\s+R/g;
  const pageRefs: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = refRegex.exec(kidsContent)) !== null) {
    pageRefs.push(`${match[1]} ${match[2]} R`);
  }

  if (pageRefs.length === 0) {
    throw new Error('Kids数组中未找到页面引用');
  }

  if (pageRefs.length !== sortOrder.length) {
    throw new Error(
      `页面数量不匹配: Kids数组有${pageRefs.length}个引用, 排序规则有${sortOrder.length}项`,
    );
  }

  // 3. 按排序结果重排页面引用
  const newKidsContent =
    ' ' + sortOrder.map((idx) => pageRefs[idx]).join('  ') + ' ';

  // 4. 替换 Kids 数组内容，保留文件其余部分不变
  const newPdfStr =
    pdfStr.substring(0, arrayContentStart) +
    newKidsContent +
    pdfStr.substring(arrayContentEnd);

  // 转回 Uint8Array
  const result = new Uint8Array(newPdfStr.length);
  for (let i = 0; i < newPdfStr.length; i++) {
    result[i] = newPdfStr.charCodeAt(i);
  }

  return result;
}

// ========== 格式化工具 ==========

/**
 * 格式化金额为可读字符串（带千分位逗号）
 */
export function formatAmount(amount: number | null): string {
  if (amount === null) return '未识别（续页）';
  return `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
