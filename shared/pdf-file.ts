/** 兼容缺少 Blob.arrayBuffer() 的浏览器，读取失败交由页面显示错误。 */
export function readPdfFile(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error('文件读取未返回二进制内容。'));
    };
    reader.onerror = () => reject(reader.error ?? new DOMException('文件读取失败。', 'NotReadableError'));
    reader.onabort = () => reject(new DOMException('文件读取已取消。', 'AbortError'));
    reader.readAsArrayBuffer(file);
  });
}
