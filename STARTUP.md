# 启动说明

## 环境要求

- Node.js 18+
- npm
- Python 3.8+
  Python 主要用于 AI 能力，不是所有基础功能都依赖它

## 启动项目

### 首次安装

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

说明：
- 会启动前端开发服务
- 会启动 Electron 桌面程序

### 正常启动

```bash
npm start
```

或者直接运行：

```bash
quick-start.bat
```

说明：
- `quick-start.bat` 会先检查 `frontend/build` 是否缺失或过期
- 如有需要会自动重建前端，再以生产模式启动 Electron

## UI 启动冒烟检查

```bash
npm run test:ui-smoke
```

说明：
- 脚本会先构建 `frontend/`，再启动 Electron 做界面级截图检查
- 需要可用的桌面会话；在无 GUI 的远程/沙箱环境中会失败

## 后端测试

```bash
npm run test:backend
```

## 项目结构

```text
智能图库/
├── frontend/         前端界面
├── electron/         Electron 桌面程序
├── python-backend/   Python AI 后端
├── tests/
│   └── backend/      后端测试
├── scripts/          辅助脚本
├── PROJECT_STRUCTURE.md
├── MAINTENANCE_GUIDE.md
└── package.json
```

## 常见入口

- 前端代码：`frontend/src/`
- Electron 主逻辑：`electron/main/`
- Electron 预加载：`electron/preload/`
- Python AI：`python-backend/`
- 后端测试：`tests/backend/`
