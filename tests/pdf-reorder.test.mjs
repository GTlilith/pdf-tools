import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { reorderPdf } from '../shared/pdf-reorder.ts';

const toBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

async function pageTexts(bytes) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), stopAtErrors: true });
  try {
    const pdf = await task.promise;
    const texts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      texts.push((await (await pdf.getPage(i)).getTextContent()).items.filter(item => 'str' in item).map(item => item.str).join(''));
    }
    return texts;
  } finally {
    await task.destroy();
  }
}

async function fixture(useObjectStreams) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const label of ['Page A', 'Page B', 'Page C']) {
    pdf.addPage([200, 200]).drawText(label, { x: 20, y: 100, font, size: 12 });
  }
  return pdf.save({ useObjectStreams });
}

test('二进制重排保持 xref、文件长度和数组外字节，实际页面顺序正确', async () => {
  const bytes = await fixture(false);
  const before = bytes.slice();
  const output = await reorderPdf(toBuffer(bytes), [2, 0, 1]);
  assert.deepEqual(bytes, before, '不修改调用者输入');
  assert.equal(output.length, bytes.length);
  const text = Buffer.from(bytes).toString('latin1');
  const match = /Kids\s*\[/.exec(text);
  assert.ok(match);
  const from = match.index + match[0].length;
  const end = text.indexOf(']', from);
  assert.deepEqual(output.slice(0, from), bytes.slice(0, from));
  assert.deepEqual(output.slice(end), bytes.slice(end));
  assert.deepEqual(await pageTexts(output), ['Page C', 'Page A', 'Page B']);
});

test('对象流 PDF 回退后仍能读取并保持页序', async () => {
  const bytes = await fixture(true);
  assert.deepEqual(await pageTexts(await reorderPdf(toBuffer(bytes), [1, 2, 0])), ['Page B', 'Page C', 'Page A']);
});

test('拒绝重复、越界、非整数以及页数不符的排序规则', async () => {
  const bytes = await fixture(false);
  for (const order of [[0, 0, 2], [-1, 0, 1], [0, 1, 3], [0, 1, 1.5], [NaN]]) {
    await assert.rejects(reorderPdf(toBuffer(bytes), order), /排序页码/);
  }
  await assert.rejects(reorderPdf(toBuffer(bytes), [0]), /页面数量不匹配/);
});
