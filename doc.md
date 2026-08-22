# allinone 技术文档

## 产品结构

第一期将 allinone 定位为 NAS 的统一轻量控制台，界面分为三个稳定入口：

1. **概览**：查看按需系统快照与常用地址。
2. **文件**：浏览被授权的文件根目录并预览内容。
3. **导航**：维护其他 NAS 服务、家庭设备和常用站点。

后续的小工具和迁移进来的程序可以继续作为同级模块扩展，避免把所有功能塞进首页。

## 技术选型

- 服务端：Node.js 20 原生 `http`、`fs`、`os` 模块
- 前端：原生 HTML、CSS、JavaScript
- 数据：地址导航保存为本地 JSON

项目没有运行时第三方依赖，适合常驻 NAS，也降低未来更新与迁移成本。开发与部署均使用 `npm start`。

## 目录结构

```text
allinone/
├── public/
│   ├── index.html        # 页面结构
│   ├── styles.css        # 响应式视觉与移动端安全区
│   └── app.js            # 页面状态、文件预览、导航管理
├── data/
│   ├── bookmarks.json    # 首次修改导航后自动创建
│   └── favorites.json    # 首次收藏目录后自动创建
├── server.mjs            # 静态服务与全部 API
├── .env.example
├── README.md
└── doc.md
```

## 配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `2006` | 服务端口 |
| `DEVSTUDIO_TOKEN` | 空 | 整站共享访问令牌；空值表示无认证模式 |
| `PREVIEW_ORIGINS` | `https://devstudio.xuekai.top:8888` | 允许跨域请求 API 的 Preview 来源，多个值用逗号分隔 |
| `FILE_ROOTS` | `Home:运行用户主目录` | 逗号分隔的 `名称:绝对路径` |
| `TEXT_PREVIEW_LIMIT` | `524288` | 文本预览字节上限 |

托管 Preview 来源为 `https://devstudio.xuekai.top:8888` 时，前端 API 基址为 `https://aio.xuekai.top:8888`。本地 Preview 端口为 `8787` 时，前端连接当前主机的 `2006` 端口；其他情况使用同源 API。服务端仅放行 `PREVIEW_ORIGINS` 中的精确来源及同主机的本地 `8787` Preview。

## 认证与会话

服务启动时会读取项目根目录 `.env`，但不覆盖进程环境中已存在的同名变量。未配置 `DEVSTUDIO_TOKEN` 时所有路由保持无认证访问。配置后，认证在路由分发前统一执行，因此覆盖页面、静态资源、API、文件预览、Range 播放、iframe 以及未来新增的 SSE/代理路由。

- 网页匿名请求使用 `303` 转到 `/login`，API 匿名请求返回 `401` JSON。
- `/login` 接收 URL-encoded POST，成功后写入 `HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000` Cookie。直接 HTTPS 或反向代理传入 `X-Forwarded-Proto: https` 时同时设置 `Secure`。
- Cookie 仅保存令牌的 SHA-256 摘要，并使用定时安全比较；更换环境令牌且重启进程后旧摘要不再匹配。
- API 另支持 `Authorization: Bearer <token>`。`token` URL 参数用于必要的 iframe/SSE 兼容；网页验证后会写 Cookie 并立即从 URL 移除令牌。
- `/logout` 将 Cookie 设为过期并转回登录页。登录后的 `next` 仅允许单斜杠开头的站内路径，拒绝协议相对地址，防止开放重定向。

`.env` 已列入 `.gitignore`，`.env.example` 只提供非真实示例值。令牌是单一共享凭据，当前没有用户管理、权限分级、登录尝试限速、服务端会话撤销列表或 CSRF token。`SameSite=Strict` 降低跨站请求风险，但公网部署仍应强制 HTTPS，在反向代理层限速，并避免使用 URL 令牌。

macOS 外置磁盘通常位于 `/Volumes`，Linux/NAS 挂载目录通常位于 `/mnt`、`/media` 或厂商定义的共享目录。服务进程需要拥有对应目录的读取权限。

## 数据流与接口

### 文件管理

- `GET /api/config`：返回公开的根目录 ID 和名称，不向浏览器暴露服务器真实路径。
- `GET /api/files?root=<id>&path=<relative>`：最多读取前 5000 个目录项。
- `GET /api/file?root=<id>&path=<relative>`：预览文件，支持 HTTP Range。
- `GET /api/file?...&download=1`：以附件方式下载。
- `GET /api/text?root=<id>&path=<relative>`：在大小上限内读取文本。
- `GET /api/favorites`：读取目录收藏。
- `POST /api/favorites`：收藏受控根目录内的目录。
- `DELETE /api/favorites/:id`：取消目录收藏。

API 路由兼容尾部斜杠。未匹配的接口会在服务端日志和响应中返回具体请求方法及路径，便于定位反向代理配置问题。前端静态资源使用协商缓存，更新服务后浏览器会主动确认资源版本。

文件路径先通过 `realpath` 解析，再校验结果仍位于配置根目录下，可阻止 `..` 与指向外部的符号链接越界。目录收藏只记录根目录 ID 和相对路径，进入时仍执行相同校验。第一期不提供上传、重命名、移动和删除，避免误操作 NAS 数据。

### 系统状态

- `GET /api/system`：返回 CPU 单次采样、内存、各文件根目录所在文件系统的空间、主机名和运行时间。

服务端没有定时器和后台监控任务。浏览器仅在首次打开概览、页面重新可见且数据超过 60 秒，或用户手动刷新时请求快照。CPU 使用率只在请求内进行约 180 毫秒的两点采样，请求结束后即停止。内存在 macOS 使用系统内存压力的可用比例，避免把可回收缓存误判为占用；Linux 使用 `/proc/meminfo` 的 `MemAvailable`，其他系统回退到 Node.js 通用口径。多个根目录位于同一个磁盘时，概览会重复累计对应文件系统，这是当前已知限制。

### 地址导航

- `GET /api/bookmarks`
- `POST /api/bookmarks`
- `PUT /api/bookmarks/:id`
- `DELETE /api/bookmarks/:id`

服务端仅接受 HTTP/HTTPS 地址，并限制字段长度。写入采用临时文件加原子替换；用户数据文件被 Git 忽略。

## 移动端设计

- 宽度不超过 680px 时切换为底部三栏导航，主要操作触控区域不小于 42px。
- 文件路径可横向滚动，文件列表隐藏次要日期信息，支持双列网格。
- 预览和表单采用底部抽屉，兼容 `env(safe-area-inset-*)`。
- 音视频使用原生控件，视频启用 `playsinline`，避免手机端不必要的强制全屏。

## 部署建议

生产环境使用 PM2 的 `allinone` fork 进程，入口为 `server.mjs`，工作目录固定为项目根目录。`ecosystem.config.cjs` 启用异常自动重启、2 秒重启延迟和 512 MB 内存上限重启，不启用文件监视。应用自行读取项目 `.env`，PM2 配置不包含真实令牌。

`pm2-xuekai.service` 负责开机恢复 `/home/xuekai/.pm2/dump.pm2` 中保存的进程列表。日常更新后执行 `npm run pm2:restart`；更改应用列表后执行 `pm2 save`。可通过 `npm run pm2:logs` 查看应用日志，日志中不应输出访问令牌。

Lucky 或其他反向代理应转发到 `127.0.0.1:2006`，传递 `Host`、`X-Forwarded-For` 和 `X-Forwarded-Proto`。应用已提供共享令牌鉴权，但仍推荐在反向代理层强制 HTTPS 并配置请求限速。

## 已知限制与规划

- 当前是只读文件管理器；写操作、重复文件扫描与硬链接需要在后续加入任务队列、确认流程和审计记录。
- 未提供缩略图缓存，大型照片目录当前显示文件类型图标，点开后加载原图。
- 未提供实时网速、温度和网络流量；这类功能应按需启动并限制采样窗口。
- 当前只提供单一共享令牌，没有多用户账号、权限分级和登录限速。
