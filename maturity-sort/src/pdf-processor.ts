export { reorderPdf } from '../../shared/pdf-reorder';
/**
 * PDF处理核心模块
 * 负责PDF文本提取、日期解析、页面重排序
 * 全部在浏览器本地运行，不涉及任何网络请求
 */

import { normalizePdfText } from '../../shared/pdf-text';
import './stream-polyfill';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import PdfWorker from '../../shared/pdf.worker?worker';

// 使用共享的独立 .js Worker，让三个工具复用同一资源的浏览器缓存。
pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();

/** 页面解析结果 */
export interface PageDateInfo {
  pageIndex: number;       // 原始页码（0-based）
  maturityDate: Date | null; // 解析出的到期日
  rawDateText: string;     // 原始日期文本
  pageText: string;        // 页面提取文本（用于调试）
}

/** 排序结果 */
export interface SortResult {
  pages: PageDateInfo[];
  sortOrder: number[];     // 排序后的页码索引数组
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

/**
 * 解析中文数字字符串为阿拉伯数字
 * 支持格式: 贰零贰肆(年) → 2024, 壹拾贰(月) → 12, 叁拾壹(日) → 31
 */
function parseChineseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // 纯阿拉伯数字
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  // 年份格式: 逐字对应 (贰零贰肆 → 2024)
  if (/^[零〇壹贰叁肆伍陆柒捌玖一二三四五六七八九]+$/.test(trimmed)) {
    let result = 0;
    for (const ch of trimmed) {
      const digit = CN_DIGIT_MAP[ch];
      if (digit === undefined) return null;
      result = result * 10 + digit;
    }
    return result;
  }

  // 月/日格式: 壹拾贰 → 12, 叁拾壹 → 31, 零壹 → 1
  let value = 0;
  let i = 0;
  const chars = [...trimmed];

  while (i < chars.length) {
    const ch = chars[i];
    if (ch === '拾' || ch === '十') {
      // 拾/十 前面没有数字则视为 10，有数字则为 *10
      value = value === 0 ? 10 : value * 10;
      i++;
    } else if (CN_DIGIT_MAP[ch] !== undefined) {
      value += CN_DIGIT_MAP[ch];
      i++;
    } else {
      break;
    }
  }

  return value > 0 ? value : null;
}

/**
 * 从文本中提取"汇票到期日"后的日期
 * 支持多种格式:
 * - 2024年12月31日
 * - 贰零贰肆年壹拾贰月叁拾壹日
 * - 2024-12-31 / 2024/12/31
 */
function extractDateOnce(text: string): { date: Date | null; raw: string } {
  // 策略1: 匹配 "汇票到期日" 后的中文日期 (阿拉伯数字)
  const arabicDateRegex = /汇票到期日\s*[：:]*\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/;
  const arabicMatch = text.match(arabicDateRegex);
  if (arabicMatch) {
    const [, y, m, d] = arabicMatch;
    const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
    return { date, raw: `${y}年${m}月${d}日` };
  }

  // 策略2: 匹配 "汇票到期日" 后的中文数字日期 (大写中文)
  const cnDateRegex = /汇票到期日\s*[：:]*\s*([零〇壹贰叁肆伍陆柒捌玖一二三四五六七八九十拾]+)\s*年\s*([零〇壹贰叁肆伍陆柒捌玖一二三四五六七八九十拾]+)\s*月\s*([零〇壹贰叁肆伍陆柒捌玖一二三四五六七八九十拾]+)\s*日/;
  const cnMatch = text.match(cnDateRegex);
  if (cnMatch) {
    const [, yStr, mStr, dStr] = cnMatch;
    const year = parseChineseNumber(yStr);
    const month = parseChineseNumber(mStr);
    const day = parseChineseNumber(dStr);
    if (year && month && day) {
      const date = new Date(year, month - 1, day);
      return { date, raw: `${yStr}年${mStr}月${dStr}日` };
    }
  }

  // 策略3: 匹配 "汇票到期日" 后的数字日期 (2024-12-31 或 2024/12/31)
  const numericDateRegex = /汇票到期日\s*[：:]*\s*(\d{4})[-/](\d{1,2})[-/](\d{1,2})/;
  const numericMatch = text.match(numericDateRegex);
  if (numericMatch) {
    const [, y, m, d] = numericMatch;
    const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
    return { date, raw: `${y}-${m}-${d}` };
  }

  // 策略4: 更宽松匹配 - 查找"到期日"关键词
  const looseRegex = /到期日\s*[：:]*\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/;
  const looseMatch = text.match(looseRegex);
  if (looseMatch) {
    const [, y, m, d] = looseMatch;
    const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
    return { date, raw: `${y}年${m}月${d}日` };
  }

  return { date: null, raw: '未识别' };
}

/**
 * 提取到期日入口：先按原始文本匹配；失败后去除全部空白重试，
 * 兼容字段标签逐字分离的新版票据（如"汇 票 到 期 日 2027-02-06"）。
 */
export function extractDateFromText(text: string): { date: Date | null; raw: string } {
  const normalizedText = normalizePdfText(text);
  const first = extractDateOnce(normalizedText);
  if (first.date) return first;
  return extractDateOnce(normalizedText.replace(/\s+/g, ''));
}

/**
 * 从PDF文件的ArrayBuffer中提取每页的"汇票到期日"
 */
export async function extractMaturityDates(
  arrayBuffer: ArrayBuffer,
  onProgress?: (current: number, total: number) => void,
): Promise<PageDateInfo[]> {
  const data = new Uint8Array(arrayBuffer);
  const loadingTask = pdfjsLib.getDocument({ data });
  try {
    const pdf = await loadingTask.promise;
    const totalPages = pdf.numPages;
    const results: PageDateInfo[] = [];

    for (let i = 1; i <= totalPages; i++) {
      if (onProgress) onProgress(i, totalPages);

      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();

      // 拼接页面文本
      const pageText = textContent.items
        .map((item) => ('str' in item ? String((item as Record<string, unknown>).str) : ''))
        .join(' ');

      const { date, raw } = extractDateFromText(pageText);

      results.push({
        pageIndex: i - 1,
        maturityDate: date,
        rawDateText: raw,
        pageText,
      });
    }

    return results;
  } finally {
    await loadingTask.destroy();
  }
}

/**
 * 对页面按到期日排序（从早到晚）
 * 无法识别日期的页面视为前一个有日期页面的续页，紧跟其所属页面
 *
 * 分组逻辑：从原始顺序遍历，每个有日期的页面开启一个新组，
 * 后续无日期页面归入该组，直到遇到下一个有日期的页面。
 * 排序时按组首（有日期页面）的到期日升序排列，组内保持原始顺序。
 */
export function sortByMaturityDate(pages: PageDateInfo[]): SortResult {
  // 1. 按原始顺序分组：有日期的页面作为组首，后续无日期页面归入同组
  interface PageGroup {
    anchorDate: Date;
    pages: PageDateInfo[];
  }

  const groups: PageGroup[] = [];
  let currentGroup: PageGroup | null = null;

  for (const page of pages) {
    if (page.maturityDate !== null) {
      // 有日期 → 开启新组
      currentGroup = {
        anchorDate: page.maturityDate,
        pages: [page],
      };
      groups.push(currentGroup);
    } else if (currentGroup !== null) {
      // 无日期但有前序组 → 归入当前组（续页）
      currentGroup.pages.push(page);
    } else {
      // 无日期且无前序组（文件开头就没识别到日期）→ 单独成组，排在最后
      currentGroup = {
        anchorDate: new Date(8640000000000000), // 远未来日期，确保排到最后
        pages: [page],
      };
      groups.push(currentGroup);
    }
  }

  // 2. 按组首到期日降序排列（从晚到早）
  groups.sort((a, b) => b.anchorDate.getTime() - a.anchorDate.getTime());

  // 3. 展平为排序结果
  const sorted = groups.flatMap((g) => g.pages);
  const sortOrder = sorted.map((p) => p.pageIndex);

  return {
    pages: sorted,
    sortOrder,
  };
}

/**
 * 格式化日期为可读字符串
 */
export function formatDate(date: Date | null): string {
  if (!date) return '未识别';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
