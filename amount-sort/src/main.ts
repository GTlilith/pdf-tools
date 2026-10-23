import { initSortApp } from '../../shared/sort-app';
import { extractAmounts, sortByAmount, reorderPdf, formatAmount } from './pdf-processor';

export function initApp(): void {
  initSortApp({
    id: 'amount-sort', field: '票据金额', suffix: '按金额排序',
    extract: extractAmounts, sort: sortByAmount, reorder: reorderPdf,
    value: page => page.amount, format: page => formatAmount(page.amount),
  });
}
