# Windows 首次上传操作

当前电脑未检测到 Git、Node.js 和 GitHub CLI。最省事的办法是安装 GitHub Desktop；它自带 Git，并可通过浏览器登录 GitHub，不必使用命令行令牌。

## 推荐：GitHub Desktop

1. 打开 <https://desktop.github.com/> 下载并安装 GitHub Desktop。
2. 启动后选择 **Sign in to GitHub.com**，在浏览器登录账号 `GTlilith`。
3. GitHub Desktop 菜单选择 **File → Add local repository**。
4. 选择目录：
   `C:\Users\glitt\gtlish\GitHub_tools\pdf-tools`
5. 如果提示“不是 Git 仓库”，点击 **create a repository**：
   - Name：`pdf-tools`
   - Local path：`C:\Users\glitt\gtlish\GitHub_tools`
   - Git ignore：None（项目已有 `.gitignore`）
   - License：None
6. 提交信息输入：`Initial migration from Coze`，点击 **Commit to main**。
7. 点击 **Publish repository**：
   - Name：`pdf-tools`
   - 不要勾选 **Keep this code private**（免费 GitHub Pages 建议公开仓库）
   - 点击 **Publish Repository**。
8. 浏览器打开 `https://github.com/GTlilith/pdf-tools/settings/pages`。
9. **Source** 选择 **GitHub Actions**。
10. 打开 `https://github.com/GTlilith/pdf-tools/actions`，等待部署变绿。
11. 访问 `https://gtlilith.github.io/pdf-tools/`。

## 命令行方案（可选）

安装 Git 与 GitHub CLI 后，在项目目录运行：

```powershell
git init
git add .
git commit -m "Initial migration from Coze"
git branch -M main
gh auth login
gh repo create GTlilith/pdf-tools --public --source=. --remote=origin --push
```

然后到仓库 Settings → Pages，把 Source 设为 GitHub Actions。

## 域名

只有您拥有主域名时才能创建子域名。`pdftools.com` 当前已有第三方网站解析，除非该域名确为您所有，否则不能使用 `hy.pdftools.com`。

在阿里云购买新域名后，可设置 `hy.您的域名` 的 CNAME 到 `gtlilith.github.io`。具体步骤见 README。
