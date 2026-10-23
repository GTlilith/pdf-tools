import { initSortApp } from '../../shared/sort-app';
import { extractMaturityDates, sortByMaturityDate, reorderPdf, formatDate } from './pdf-processor';

export function initApp(): void {
  initSortApp({
    id: 'maturity-sort', field: '汇票到期日', suffix: '按到期日排序',
    extract: extractMaturityDates, sort: sortByMaturityDate, reorder: reorderPdf,
    value: page => page.maturityDate, format: page => formatDate(page.maturityDate),
  });
}
