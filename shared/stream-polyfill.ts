/**
 * Polyfill: ReadableStream 异步迭代（for await...of）
 * Chrome/Edge 124 才原生支持，Edge 123 等旧浏览器需要此补丁。
 * 主线程和 Worker 都需要引入。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const proto = (globalThis as any).ReadableStream?.prototype;
if (proto && !proto[Symbol.asyncIterator]) {
  proto.values ??= function (this: ReadableStream, { preventCancel = false } = {}) {
    const reader = this.getReader();
    return {
      async next() {
        try {
          const result = await reader.read();
          if (result.done) reader.releaseLock();
          return result;
        } catch (e) {
          reader.releaseLock();
          throw e;
        }
      },
      async return(value?: any) {
        if (preventCancel) {
          reader.releaseLock();
        } else {
          const cancel = reader.cancel(value);
          reader.releaseLock();
          await cancel;
        }
        return { done: true, value };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  };
  proto[Symbol.asyncIterator] ??= proto.values;
}

export {};
