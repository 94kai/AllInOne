# allinone 技术文档

## 产品结构

allinone 定位为 NAS 的统一轻量控制台，界面包含五个稳定入口：

1. **概览**：查看按需系统快照与常用地址。
2. **文件**：浏览被授权的文件根目录并预览内容。
3. **导航**：维护其他 NAS 服务、家庭设备和常用站点。
4. **测速**：按需测试浏览器与 Allinone 服务之间的上传、下载链路速度。
5. **小爱音乐**：搜索本地曲库并控制两台小爱音箱的播放、监听和配置。

后续的小工具和迁移进来的程序可以继续作为同级模块扩展，避免把所有功能塞进首页。

## 模块化扩展边界

音乐下载、小爱同学音乐播放等属于后续规划模块，尚未实现。实现时必须遵守以下架构边界：

| 边界 | 约定 |
| --- | --- |
| 后端路由 | 每个模块使用 `/api/modules/<module-id>/...`，由统一请求入口先执行鉴权和通用安全检查 |
| 前端代码 | 模块拥有独立视图、状态和样式作用域，不直接操作其他模块 DOM 或状态 |
| 持久化 | 模块数据放在 `data/<module-id>/`，不与其他模块共用可写 JSON/数据库表 |
| 配置 | 环境变量使用模块前缀，在 `.env.example` 分组记录，缺失时只禁用对应模块 |
| 后台任务 | 下载、播放等长任务由所属模块管理生命周期、并发限制、取消和错误，不使用无归属的全局定时器 |
| 模块通信 | 仅通过公开接口或明确事件协作，不读写对方内部文件、私有函数或全局变量 |
| 故障隔离 | 模块初始化和外部服务失败只影响本模块，不阻止核心服务与其他模块启动 |

测速模块已按以下目录形态落地，后续业务模块继续遵守相同边界：

```text
modules/<module-id>/        # 后端路由、服务、校验与模块元数据
public/modules/<module-id>/ # 前端视图、状态与局部样式
data/<module-id>/           # 模块私有持久化数据
shared/                     # 经明确设计的通用服务，不放业务状态
```

## 技术选型

- 服务端：Node.js 20 原生 `http`、`fs`、`os` 模块
- 前端：原生 HTML、CSS、JavaScript
- 数据：地址导航保存为本地 JSON

项目没有运行时第三方依赖，适合常驻 NAS，也降低未来更新与迁移成本。开发与部署均使用 `npm start`。

## 目录结构

```text
allinone/
├── modules/
│   └── speed-test/
│       └── index.mjs    # 测速接口、输入边界和流式传输
│   └── xiaoai-music/
│       ├── index.mjs    # 双实例配置、进程监管与 API 代理
│       ├── worker_bridge.py # worker 生命周期与本地管理接口
│       └── runtime/     # 曲库、播放服务、语音处理及纯 Python 小爱协议
├── public/
│   ├── index.html        # 页面结构
│   ├── styles.css        # 响应式视觉与移动端安全区
│   └── app.js            # 页面状态、文件预览、导航管理
│   └── modules/speed-test/ # 测速模块前端逻辑与局部样式
│   └── modules/xiaoai-music/ # 小爱音乐控制台逻辑与局部样式
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
| `SMARTCTL_PATH` | `/usr/sbin/smartctl` | 硬盘 SMART 温度读取程序或受控包装脚本路径 |
| `XIAOAI_PYTHON` | `python3` | 小爱音乐 worker 使用的 Python 3 可执行文件 |

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

当前部署的 `FILE_ROOTS` 包含 `Home:/home/xuekai` 和 `xuekai-master:/vol3/1000/master`。

## 数据流与接口

### 文件管理

- `GET /api/config`：返回公开的根目录 ID 和名称，不向浏览器暴露服务器真实路径。
- `GET /api/files?root=<id>&path=<relative>&hidden=0|1`：最多读取前 5000 个目录项；默认过滤名称以 `.` 开头的隐藏项。认证后的响应包含当前目录和各目录项的服务器绝对路径，用于复制操作。
- `GET /api/file?root=<id>&path=<relative>`：预览文件，支持 HTTP Range。
- `GET /api/file?...&download=1`：以附件方式下载。
- `GET /api/text?root=<id>&path=<relative>`：在大小上限内读取 UTF-8 文本，含 NUL 字节或非 UTF-8 内容返回 `415`。
- `GET /api/favorites`：读取目录收藏。
- `POST /api/favorites`：收藏受控根目录内的目录。
- `DELETE /api/favorites/:id`：取消目录收藏。

API 路由兼容尾部斜杠。未匹配的接口会在服务端日志和响应中返回具体请求方法及路径，便于定位反向代理配置问题。前端静态资源使用协商缓存，更新服务后浏览器会主动确认资源版本。

文件路径先通过 `realpath` 解析，再校验结果仍位于配置根目录下，可阻止 `..` 与指向外部的符号链接越界。目录收藏只记录根目录 ID 和相对路径，进入时仍执行相同校验。第一期不提供上传、重命名、移动和删除，避免误操作 NAS 数据。

文件页的眼睛按钮可切换隐藏项显示，默认关闭。选项保存在浏览器 `localStorage`，只影响当前浏览器；服务端在关闭时不向前端返回隐藏项。

文本识别覆盖 Markdown、JSON/JSONC、YAML、TOML、XML、CSV、日志、字幕、Shell 脚本、常见前后端源码与 `Dockerfile`、`Makefile`、`.env`、`.gitignore` 等无常规扩展名文件。其他未知类型在点击时也会尝试作为 UTF-8 文本预览；二进制、非 UTF-8 或超过 `TEXT_PREVIEW_LIMIT` 的文件不会以文本打开。

### 系统状态

- `GET /api/system`：返回 CPU 单次采样与温度、内存、各本地物理硬盘的型号/挂载点/用量/温度、主机名和运行时间。

服务端没有定时器和后台监控任务。浏览器仅在首次打开概览、页面重新可见且数据超过 60 秒，或用户手动刷新时请求快照。CPU 使用率只在请求内进行约 180 毫秒的两点采样，请求结束后即停止。内存在 macOS 使用系统内存压力的可用比例，避免把可回收缓存误判为占用；Linux 使用 `/proc/meminfo` 的 `MemAvailable`，其他系统回退到 Node.js 通用口径。Linux 存储结合 `lsblk` 块设备拓扑与 `df` 文件系统用量，将同一物理硬盘上的系统分区、LVM 和数据卷归并展示，并根据 USB/热插拔属性区分内置与外置硬盘。tmpfs、Docker overlay、引导分区、远程 FUSE 和飞牛聚合层不作为独立硬盘。其他系统回退到文件入口所在文件系统并去重。

Linux CPU/NVMe 温度优先从 `sensors -j` 读取，SATA/USB 硬盘温度通过 `SMARTCTL_PATH -A -j <device>` 读取。当 SMART 读取被系统权限拒绝时，API 返回 `null`，界面显示 `--°`；当前两块 USB 外置盘属于该情况。如需开放读取，应配置只允许指定设备和 SMART 查询参数的最小权限包装脚本，不应让应用整体以 root 运行。

### 地址导航

- `GET /api/bookmarks`
- `POST /api/bookmarks`
- `PUT /api/bookmarks/:id`
- `DELETE /api/bookmarks/:id`

服务端仅接受 HTTP/HTTPS 地址，并限制字段长度。写入采用临时文件加原子替换；用户数据文件被 Git 忽略。

导航数据包含名称、URL、短说明、标识颜色和可选 `notes` 备注。短说明最长 80 字符并始终用于卡片摘要；备注最长 2000 字符，仅在用户点击信息按钮时打开，适合记录部署路径、启动命令和维护提醒。备注作为纯文本显示，不解析 HTML。

### 网络测速

- `GET /api/modules/speed-test/download?bytes=<字节数>`：流式返回 1 KB 至 64 MB 的内存测试数据，明确禁用缓存和内容变换。
- `POST /api/modules/speed-test/upload`：流式接收并丢弃测试数据，单次限制为 1 KB 至 64 MB，不写入磁盘。

前端先测试下载、再测试上传，每一阶段通常持续约 4 秒并以 `MB/s` 实时显示估算值；用户可随时停止。单轮下载从 2 MB 预热数据开始，随后使用 8 MB 数据块；上传使用浏览器内存生成的 4 MB 随机数据块，避免压缩代理影响结果。完整测试约产生 6–90 MB 传输量。结果表示浏览器到当前 Allinone 服务（包括中间反向代理）的实际链路吞吐量，不等同于运营商公网测速；反向代理若启用了额外缓存、限速或缓冲也会影响结果。

模块责任边界：后端位于 `modules/speed-test/`，仅负责生成/接收临时字节流；前端位于 `public/modules/speed-test/`，独立管理测速运行状态、取消控制与结果展示。模块无配置项、无持久化数据、无定时器或后台任务，也不读写其他模块状态。

### 小爱音乐

模块将原来的 `XiaoAiMusic`、`XiaoAiMusicForNew` 两份相同业务实例合并为一套管理层和两个设备 worker：

| 实例 | WebSocket 监听 | 音乐 HTTP | 本地管理接口 |
| --- | ---: | ---: | ---: |
| 客厅音箱 | `4399` | `18080` | `127.0.0.1:18180` |
| 卧室音箱 | `4400` | `18081` | `127.0.0.1:18181` |

两个 worker 独立持有设备连接、播放队列、曲库索引和监听状态，一个实例故障不会阻止另一个实例或 Allinone 核心服务运行。管理接口只监听回环地址，浏览器不能直接访问；所有操作统一经过 Allinone 鉴权及 `/api/modules/xiaoai-music/...` 代理。

公开接口：

- `GET /api/modules/xiaoai-music/profiles`：两台音箱的在线、监听、曲库和播放状态，并返回当前歌曲及最多 99 首待播队列。
- `PUT /api/modules/xiaoai-music/profiles/:id`：修改名称、音乐目录、音箱可访问的音乐地址、搜索数量、定时刷新间隔及播放/停止/刷新/随机播放语音关键词，并只重启目标 worker。
- `GET /api/modules/xiaoai-music/profiles/:id/search?q=...`：搜索歌名、歌手、专辑和文件名，查询最多 100 字符。
- `POST .../:id/play`：播放索引中的指定歌曲。
- `POST .../:id/play-search`：按关键词生成播放队列。
- `POST .../:id/random`：随机生成播放队列。
- `POST .../:id/stop`：停止播放并清空队列。
- `POST .../:id/refresh`：刷新目标实例曲库索引。
- `POST .../:id/listener`：开启或关闭目标实例语音监听，状态持久化。

模块配置保存在 `data/xiaoai-music/config.json`，两个索引分别保存在同目录的 `<profile-id>-index.json`；这些运行数据均被 Git 忽略。配置只接受 1–10 个绝对音乐目录及 HTTP/HTTPS 音乐地址。曲库索引、元数据读取、Range 音乐服务、播放队列、语音指令处理以及 open-xiaoai WebSocket/RPC 协议都位于 `modules/xiaoai-music/runtime/`，只依赖 Python 标准库和系统 `ffprobe`。监听端口由每个实例运行时配置，不再需要两份编译产物。原来的两个 PM2 应用已经移除，旧项目目录不再参与运行。

Allinone 启动时创建并监管两个 worker，异常退出后 3 秒自动拉起。收到 `SIGINT`/`SIGTERM` 时先关闭两个 worker，释放 WebSocket、音乐 HTTP 和管理端口，再退出主进程；PM2 只需管理 `allinone` 一个应用。首次建立索引可能需要数分钟，管理接口和语音监听会先启动，状态中显示刷新进度；以后复用索引，只解析新增或变化的文件。

## 移动端设计

- 宽度不超过 680px 时切换为底部四栏导航，主要操作触控区域不小于 42px。
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
- 未提供常驻实时网速或网络流量监控；测速仅在用户主动启动后运行，并限制采样窗口和单次传输大小。
- 当前只提供单一共享令牌，没有多用户账号、权限分级和登录限速。
