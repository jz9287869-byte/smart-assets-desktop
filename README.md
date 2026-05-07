# 智能图库

这是一个本地桌面图片管理项目，包含：

- 前端界面
- Electron 桌面程序逻辑
- Python AI 后端
- 后端回归测试

如果你只是想先看懂项目，从这 3 个文件开始：

- [PROJECT_STRUCTURE.md](/D:/张槿-项目/智能图库/PROJECT_STRUCTURE.md)
- [STARTUP.md](/D:/张槿-项目/智能图库/STARTUP.md)
- [MAINTENANCE_GUIDE.md](/D:/张槿-项目/智能图库/MAINTENANCE_GUIDE.md)

## 目录怎么认

- `frontend/`
  页面和界面
- `electron/`
  桌面程序逻辑
- `python-backend/`
  Python AI
- `tests/backend/`
  后端测试
- `scripts/`
  辅助脚本

## 常用命令

```bash
npm install
npm start
npm run dev
npm run test:backend
```

## 发布下载页

如果你想让别人通过网页下载安装包，可以直接使用：

- [docs/index.html](/D:/张槿-项目/智能图库/docs/index.html)
- [docs/README.md](/D:/张槿-项目/智能图库/docs/README.md)

这套方式适合：

- 代码放 GitHub
- 安装包放 GitHub Releases
- 下载页面用 GitHub Pages

## 你后续维护时最重要的判断

- 改界面：去 `frontend/`
- 改业务逻辑：去 `electron/main/`
- 改 AI：去 `python-backend/`
- 验证有没有改坏：跑 `npm run test:backend`
