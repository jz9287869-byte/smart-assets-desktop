# 下载页说明

这是给 GitHub Pages 用的简单下载页。

你只需要做 3 件事：

1. 把安装包上传到 GitHub Releases
2. 打开 `docs/index.html`
3. 把 `YOUR_GITHUB_NAME/YOUR_REPO` 改成你的仓库名

示例：

```js
const repo = "zhangjin/smart-assets";
```

然后去 GitHub 仓库：

1. `Settings`
2. `Pages`
3. `Build and deployment`
4. Source 选择 `Deploy from a branch`
5. Branch 选择 `main`，Folder 选择 `/docs`

保存后，GitHub 会生成一个网页地址。

这个页面的下载按钮会直接指向：

```text
https://github.com/你的用户名/你的仓库名/releases/latest/download/智能素材管理系统-Setup-1.0.0.exe
```
