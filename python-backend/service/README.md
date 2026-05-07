# python-backend/service

这是一个历史遗留的 HTTP 服务目录。

## 现在怎么理解它

- 它不是当前桌面应用的主入口
- 它更像是早期/扩展用途的服务化尝试
- 如果只是维护当前桌面版，优先关注 `frontend/`、`electron/`、`python-backend/`

## 如果你确实要看这个目录

启动方式：

```bash
cd python-backend/service
npm install
npm start
```

## 维护建议

- 当前项目主流程并不依赖这里
- 如果后面要继续维护它，建议单独做一次专项整理
- 在没有确认用途前，不建议优先修改这里
