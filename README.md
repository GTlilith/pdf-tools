# PDF 工具汇总

面向电子银行承兑汇票的三个浏览器端 PDF 工具。PDF 的读取、文本提取、排序、插页和导出全部在浏览器本地完成，不上传文件。

## 在线地址（部署后）

- 汇总页：`https://gtlilith.github.io/pdf-tools/`
- 插页打印：`https://gtlilith.github.io/pdf-tools/split-print/`
- 到期日排序：`https://gtlilith.github.io/pdf-tools/maturity-sort/`
- 金额排序：`https://gtlilith.github.io/pdf-tools/amount-sort/`

> GitHub URL 中用户名不区分大小写，通常会显示为小写。

## 功能

1. **插页打印**：按票据包号和子票据号识别票据边界，兼容“子票区间”等标签及独立的“起-止”区间行；同包号不同子票据分别分组，票据页数为奇数时在其后插入同尺寸空白页。未识别到子票据号时按包号分组，并在结果中标黄提醒核对，未识别出票号的页面作为前一张票据的续页。
2. **到期日排序**：提取“汇票到期日”，按日期从晚到早重排；未识别页面作为前一张票据的续页。
3. **金额排序**：提取票据金额，按金额从大到小重排；未识别页面作为前一张票据的续页。

## 本地开发

需要 Node.js 22：

```powershell
npm ci
npm run dev
```

构建：

```powershell
npm run build
```

生成文件在 `dist` 目录。

## 回归检查

```powershell
npm test
```

测试覆盖子票据号格式、包号回退标记、二进制重排的页序与 xref 偏移，以及对象流 PDF 的回退导出。测试直接转译项目源码，不增加依赖；CI 安装锁定依赖后会先测试再构建。

真实汇票样本不入库。可通过环境变量传入本机样本及预期值，再运行同一测试入口：

```powershell
$env:PDF_REGRESSION_SAMPLES = '[{"path":"C:/samples/example.pdf","groups":22,"blanks":13,"outputPages":74,"packageOnlyGroups":0}]'
npm test
Remove-Item Env:PDF_REGRESSION_SAMPLES
```

`groups` 为分组数，`blanks` 为补空白页数，`outputPages` 为预期输出总页数；`packageOnlyGroups` 可选，用于核对缺少子票号的分组数。


## GitHub Pages 部署

仓库包含 `.github/workflows/deploy-pages.yml`。推送到 `main` 后：

1. 打开仓库 **Settings → Pages**。
2. 在 **Build and deployment → Source** 选择 **GitHub Actions**。
3. 打开 **Actions** 查看 `Deploy GitHub Pages`。
4. 完成后访问 `https://gtlilith.github.io/pdf-tools/`。

## 自定义域名

`hy.pdftools.com` 不能直接使用，除非您是 `pdftools.com` 的所有者。应先购买并持有一个主域名，例如 `your-domain.com`，然后使用 `hy.your-domain.com`。

确定域名后：

1. 在仓库 **Settings → Pages → Custom domain** 输入完整子域名，例如 `hy.your-domain.com`。
2. GitHub 会在发布内容中管理 `CNAME`。也可在项目的 `public/CNAME` 中写入该域名，但不要在尚未持有域名时提前写入。
3. 在阿里云 DNS 添加：
   - 记录类型：`CNAME`
   - 主机记录：`hy`
   - 记录值：`gtlilith.github.io`
   - TTL：默认
4. 等待解析生效，回到 GitHub Pages 勾选 **Enforce HTTPS**。

三个工具不需要三个域名，建议统一使用：

- `https://hy.your-domain.com/`
- `https://hy.your-domain.com/split-print/`
- `https://hy.your-domain.com/maturity-sort/`
- `https://hy.your-domain.com/amount-sort/`

这样最稳定，也更方便维护。

## 注意事项

- 建议使用新版 Chrome 或 Edge。
- PDF 必须包含可提取文本；纯扫描图片 PDF 无法直接识别，除非另行加入 OCR。
- 插页工具在首张页面无法识别票据号码时会停止处理，避免误判票据边界并插入错误空白页。
- 排序工具沿用原项目的二进制页面引用重排方式，主要适配当前银行导出的 PDF 结构；遇到其他复杂 PDF 结构可能提示不支持。
