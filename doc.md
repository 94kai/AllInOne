# allinone 技术文档

## 产品结构

allinone 定位为 NAS 的统一轻量控制台，界面包含五个稳定入口：

1. **概览**：查看按需系统快照与常用地址。
2. **文件**：浏览被授权的文件根目录并预览内容。
3. **测速**：按需测试浏览器与 Allinone 服务之间的上传、下载链路速度。
4. **清单**：维护可反复勾选恢复的出行物品清单，并支持拼音和自定义排序。
5. **音乐**：在同一个主导航入口内切换“小爱播放”和“音乐下载”；前者搜索本地曲库并控制两台小爱音箱，后者从多个公开来源搜索歌曲、下载到暂存目录并批量移动到受控音乐目录。

后续的小工具和迁移进来的程序可以继续作为同级模块扩展，避免把所有功能塞进首页。

## 模块化扩展边界

音乐下载、小爱同学音乐播放已按以下架构边界实现，后续模块继续遵守相同约定：

前端主导航将两者统一为“音乐”入口，并通过“小爱播放 / 音乐下载”二级切换展示；这只是界面入口融合，两个模块仍保持独立 API、进程状态和数据目录。

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

## 界面布局原则

功能页采用移动端优先的紧凑布局。主框架顶部已经展示当前页面标题，因此模块内部默认不重复使用大型 Hero、渐变横幅或只起装饰作用的首屏卡片；摘要信息应使用紧凑状态行，核心输入、筛选和主要操作优先进入手机首屏。大型头部仅用于品牌首页、承载不可替代的重要总览，或用户明确要求的场景。

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
│   └── xiaoai-assistant/
│       └── index.mjs    # 指令、播报、历史与快捷控制 API
│   └── music-download/
│       └── index.mjs    # 搜索、下载队列、文件列表及批量移动
├── public/
│   ├── index.html        # 页面结构
│   ├── styles.css        # 响应式视觉与移动端安全区
│   └── app.js            # 页面状态、文件预览、导航管理
│   └── modules/speed-test/ # 测速模块前端逻辑与局部样式
│   └── modules/xiaoai-music/ # 小爱音乐控制台逻辑与局部样式
│   └── modules/xiaoai-assistant/ # 小爱控制与播报页面
│   └── modules/music-download/ # 音乐搜索、下载与移动界面
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
| `MUSIC_DOWNLOAD_DIR` | `data/music-download/downloads` | 音乐下载模块的默认暂存目录 |
| `MUSIC_MOVE_ROOTS` | 复用 `FILE_ROOTS` | 允许批量移动到的根目录，格式为 `名称:绝对路径`，多个用逗号分隔 |
| `MUSIC_SEARCH_SOURCES` | `migu,netease,qq,kugou,kuwo,bilibili` | 搜索来源代码，多个用逗号分隔 |
| `MUSIC_MEDIA_GET_PATH` | 空 | 自行安装的 media-get 路径；为空时首次搜索自动安装固定版本 |

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

导航不再占用独立 Tab，全部常用入口直接在概览页以紧凑图标条目展示。点击条目主体直接打开地址，右侧详情按钮打开修改弹窗且不会自动聚焦输入框；标题右侧的“新增”创建入口，“排序”进入拖动模式并通过 `PUT /api/bookmarks/order` 持久化顺序。导航数据包含名称、URL、短说明、标识颜色、可选图标 URL 和可选 `notes` 备注；未配置图标时继续显示标题首字与颜色。图标接受站内绝对路径或 HTTP/HTTPS URL，备注作为纯文本编辑，不解析 HTML。

### 网络测速

- `GET /api/modules/speed-test/download?bytes=<字节数>`：流式返回 1 KB 至 64 MB 的内存测试数据，明确禁用缓存和内容变换。
- `POST /api/modules/speed-test/upload`：流式接收并丢弃测试数据，单次限制为 1 KB 至 64 MB，不写入磁盘。

前端先测试下载、再测试上传，每一阶段通常持续约 4 秒并以 `MB/s` 实时显示估算值；用户可随时停止。单轮下载从 2 MB 预热数据开始，随后使用 8 MB 数据块；上传使用浏览器内存生成的 4 MB 随机数据块，避免压缩代理影响结果。完整测试约产生 6–90 MB 传输量。结果表示浏览器到当前 Allinone 服务（包括中间反向代理）的实际链路吞吐量，不等同于运营商公网测速；反向代理若启用了额外缓存、限速或缓冲也会影响结果。

模块责任边界：后端位于 `modules/speed-test/`，仅负责生成/接收临时字节流；前端位于 `public/modules/speed-test/`，独立管理测速运行状态、取消控制与结果展示。模块无配置项、无持久化数据、无定时器或后台任务，也不读写其他模块状态。

### 出行清单

模块后端位于 `modules/checklist/`，前端位于 `public/modules/checklist/`，持久化数据位于 `data/checklist/items.json`。条目包含随机 ID、最多 120 字的文本、归属人、划掉状态、划掉时间和创建时间；归属人限制为通用、爸爸、妈妈或赞赞。旧条目首次加载时，名称含“赞赞”的归到赞赞，其余归到通用。写入采用同目录临时文件原子替换，模块不运行后台任务，也不访问外部服务。人员筛选控制当前列表和进度，条目可直接改归属。开启划掉置顶时先在原位置播放约半秒确认反馈，再执行重排；按持久化划掉时间计算最近 10 项并显示 `1` 至 `10`，其中 `1` 是最近一次，因此硬刷新后仍可识别近期处理顺序。

点击条目文字或圆形按钮会切换划掉状态，“全部取消划掉”只重置状态，不删除或改变顺序。拼音排序由浏览器的中文拼音 `Intl.Collator` 完成，仅改变当前显示顺序；“划掉的置顶”开关可在任一排序模式下将已完成条目稳定分组到顶部。两项显示偏好均保存在当前浏览器。选择自定义排序时可通过 Pointer Events 在手机或桌面拖动右侧把手，放手后将完整 ID 顺序提交到服务端持久化。服务端校验排序 ID 必须与当前条目完全一致，避免并发旧页面覆盖或丢失条目。

接口：

- `GET /api/modules/checklist`：读取全部条目及持久化顺序。
- `POST /api/modules/checklist`：新增未划掉条目。
- `PUT /api/modules/checklist/:id`：更新指定条目的文本或划掉状态。
- `DELETE /api/modules/checklist/:id`：删除指定条目。
- `POST /api/modules/checklist/reset`：全部取消划掉。
- `PUT /api/modules/checklist/order`：校验并保存自定义顺序。

### 网页终端

模块后端位于 `modules/terminal/`，前端位于 `public/modules/terminal/`。前端使用本地安装并由服务端映射的 xterm.js、FitAddon 和 WebLinksAddon；后端使用 `ws` 处理 WebSocket 升级，使用 `node-pty` 附加 tmux 会话。新会话先以 detached 模式创建，并显式关闭该会话的 `destroy-unattached`，保证浏览器断线后继续运行。终端模块没有业务数据文件，长期进程状态由系统 tmux 服务维护；Allinone 关闭时仅断开自己的 PTY 客户端，不主动杀死 tmux 会话。

接口和协议：

- `GET /api/modules/terminal/status`：返回组件可用性、会话上限及属于本模块的 tmux 会话列表。
- `DELETE /api/modules/terminal/sessions/:name`：确认后终止指定会话。
- `WS /api/modules/terminal/connect?session=<name>&cols=<n>&rows=<n>`：连接或创建命名会话，JSON 消息承载输入、输出、尺寸调整与状态。

会话名仅接受 1–32 位字母、数字、下划线和短横线，系统内统一增加 `allinone-` 前缀，避免管理其他 tmux 会话。默认最多 8 个会话，终端尺寸限制为 20–400 列、5–200 行，单条 WebSocket 消息不超过 64 KB。WebSocket 升级重新校验 Allinone 登录 Cookie/Bearer，并只接受与请求 Host 相同或在 `PREVIEW_ORIGINS` 中配置的 Origin。

`TERMINAL_ENABLED` 必须显式为 `true` 才开放连接；`TERMINAL_CWD` 决定新会话初始目录，默认取首个文件根目录；`TERMINAL_MAX_SESSIONS` 控制会话上限。终端不是文件模块的只读能力，也不受 `FILE_ROOTS` 路径边界约束，它继承 Allinone 运行用户的完整权限。公网使用应通过 HTTPS/WSS，并优先在受限 Unix 用户或容器内运行整个服务。

### 小爱同学

独立入口通过小爱音箱已有连接发送两类内容：“执行指令”调用音箱端小爱语义服务，适合“打开客厅灯”“空调调到 26 度”等米家自然语言控制；“直接播报”调用音箱 TTS 原样朗读文字。它只通过小爱音乐模块公开的设备状态和发送方法复用连接，不读取曲库、播放队列或音乐页面状态，因此页面和持久化数据均与音乐模块隔离。

每台音箱独立保存最近 5 条成功发送记录，包含文字和发送模式；相同内容和模式再次发送时移到最前。页面默认将“语音播报”放在第一位，“指令执行”作为第二模式；点击历史会将文字和模式回填到编辑区并立即按原模式再次发送，之后仍可继续修改。音箱选择保存在浏览器 `localStorage`，历史和快捷控制写入 `data/xiaoai-assistant/state.json`。界面采用一屏优先的紧凑布局：该入口隐藏通用页头，直接展示音箱按钮，较小的快捷设备按钮紧随其下，发送区与最近使用并排或在手机端依次排列。

快捷控制最多 30 个，可配置灯光、空调、场景或其他分类。开关式控制分别保存开启、关闭按钮文字及自然语言指令，单次控制保存一条执行指令；点击后均以“执行指令”方式发给当前音箱。设备是否实际执行取决于该音箱登录的小米账号、米家设备归属、设备名称以及音箱固件的语义能力。

公开接口：

- `GET /api/modules/xiaoai-assistant/state`：读取音箱状态、快捷控制以及按音箱分组的历史。
- `POST /api/modules/xiaoai-assistant/send`：向指定音箱发送 `ask` 指令或 `speak` 播报，成功后更新历史。
- `POST /api/modules/xiaoai-assistant/execute`：执行已保存快捷控制的指定操作。
- `POST /api/modules/xiaoai-assistant/volume`：设置当前音箱音量，范围为 0–100，并同步持久化到音箱配置。
- `POST /api/modules/xiaoai-assistant/controls`、`PUT/DELETE .../controls/:id`：新增、修改或删除快捷控制。
- `DELETE /api/modules/xiaoai-assistant/history/:profileId`：清空指定音箱历史。

主页面根据 URL 查询参数 `view` 初始化及切换导航，`/?view=xiaoai` 可作为小爱同学直达书签。可用值为 `home`、`files`、`speed`、`xiaoai`、`music`；每次切换都会同步更新地址栏和浏览器本地的上次选择。

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
- `POST .../:id/play`：播放索引中的指定歌曲，可通过 `repeat` 指定 1–20 次总播放轮数。
- `POST .../:id/play-search`：按关键词生成播放队列。
- `POST .../:id/random`：随机生成播放队列，可通过 `repeat` 指定 1–20 次总播放轮数。
- `POST .../:id/stop`：停止播放并清空队列。
- `POST .../:id/refresh`：刷新目标实例曲库索引。
- `POST .../:id/listener`：开启或关闭目标实例语音监听，状态持久化。
- `POST .../:id/speak`：让当前音箱直接播报提交的文字；内容去除首尾空白后必须为 1–500 个字符，并拒绝不支持的控制字符。

模块配置保存在 `data/xiaoai-music/config.json`，两个索引分别保存在同目录的 `<profile-id>-index.json`；这些运行数据均被 Git 忽略。配置只接受 1–10 个绝对音乐目录及 HTTP/HTTPS 音乐地址。曲库索引、元数据读取、Range 音乐服务、播放队列、语音指令处理以及 open-xiaoai WebSocket/RPC 协议都位于 `modules/xiaoai-music/runtime/`，只依赖 Python 标准库和系统 `ffprobe`。监听端口由每个实例运行时配置，不再需要两份编译产物。原来的两个 PM2 应用已经移除，旧项目目录不再参与运行。

Allinone 启动时创建并监管两个 worker，异常退出后 3 秒自动拉起。收到 `SIGINT`/`SIGTERM` 时先关闭两个 worker，释放 WebSocket、音乐 HTTP 和管理端口，再退出主进程；PM2 只需管理 `allinone` 一个应用。首次建立索引可能需要数分钟，管理接口和语音监听会先启动，状态中显示刷新进度；以后复用索引，只解析新增或变化的文件。

### 音乐下载

模块后端位于 `modules/music-download/`，前端位于 `public/modules/music-download/`，运行数据位于 `data/music-download/`。它不读取小爱音乐的索引或内部状态；需要共享歌曲时，由用户将下载文件批量移动到配置的目标音乐目录，再由对应模块自行刷新索引。

公开接口：

- `GET /api/modules/music-download/status`：返回组件状态、默认下载目录和可选移动根目录；不向搜索接口之外暴露平台凭据。
- `GET /api/modules/music-download/search?q=...`：聚合搜索配置的来源，关键词限制为 1–100 字符；并发预解析候选资源，只返回能够解析到有效 HTTP/HTTPS 音频地址的结果，同时返回中文来源标签。
- `GET /api/modules/music-download/downloads`：列出默认目录内的音频文件和最近 30 个进程内任务。
- `POST /api/modules/music-download/downloads`：校验 HTTP/HTTPS 来源页面后创建异步下载任务。
- `GET /api/modules/music-download/audio?file=...`：流式试听默认下载目录中的音频，支持 HTTP Range 与拖动播放进度。
- `DELETE /api/modules/music-download/downloads?file=...`：永久删除默认下载目录中的指定音频并清理对应元数据；页面必须二次确认。
- `POST /api/modules/music-download/move`：将 1–200 个已下载音频批量移动到允许的根目录及其子目录。
- `GET/PUT /api/modules/music-download/config`：读取或保存 1–20 个移动目的地根目录；网页以每行 `名称:绝对路径` 的形式维护，保存到模块私有 `config.json`。
- `GET /api/modules/music-download/metadata?file=...`：通过 `ffprobe` 读取下载目录内 MP3、FLAC、M4A 等音频的标签、编码、时长、码率和内嵌封面状态。
- `PUT /api/modules/music-download/metadata`：使用 `ffmpeg` 原地重封装并写入歌曲名、歌手、专辑、年份、流派和音轨号；提交有效刮削令牌时同时写入候选封面。
- `POST /api/modules/music-download/scrape`：以请求中当前编辑框的歌曲名和歌手为搜索条件，并结合文件时长排序，最多返回 8 个可选择候选；每个候选带有与当前文件绑定且 10 分钟有效的确认令牌。

搜索和媒体页面解析由 `media-get 0.2.14` 子进程完成，格式转换使用系统 `ffmpeg`。模块最多同时执行两个下载任务；搜索超时 45 秒，单曲下载超时 10 分钟。临时文件放在系统临时目录，成功后才移动到默认下载目录。重名文件自动增加序号，不覆盖已有文件；跨文件系统移动会回退为复制成功后删除源文件。

首次使用且尚无网页配置时，目标根目录取自 `MUSIC_MOVE_ROOTS`，未设置则复用 `FILE_ROOTS`；之后可在音乐下载页“目的地”中维护，并持久化到 `data/music-download/config.json`。目的地根目录保存时必须已经存在；选定目的地后可以填写任意层级的相对子目录，移动时通过递归创建自动补齐，不存在则创建、已存在则直接使用。服务端只接受下载目录中实际存在的音频文件名，目标路径必须位于配置根目录内；客户端不能提交任意源路径或越过目标根目录。下载任务状态仅保存在内存，服务重启后历史任务不恢复，但已完成文件仍会正常列出。平台接口属于非稳定公开 Web 接口，单个来源可能因平台调整、地区、版权或付费限制而失败。

下载完成后会在模块私有 `catalog.json` 中记录原始搜索元数据和来源，文件移动后同步移除对应记录。元信息编辑不会重新编码音频，只使用 FFmpeg 重封装；点击刮削时以用户当前手动输入的歌曲名和歌手为准，候选列表展示封面、来源和时长，选中候选只会填入表单，用户确认保存后才修改文件。封面只接受服务端生成的短期刮削令牌对应地址，限制为 JPEG、PNG 或 WebP 且不超过 10 MB。当前不提供歌词刮削，也不会自动覆盖未确认的歌曲文件。

## 移动端设计

- 宽度不超过 680px 时切换为单行横向滚动的底部导航；入口较多时不压缩堆叠，当前入口自动滚动到可见位置，主要操作触控区域不小于 42px。手机长按导航项约 0.3 秒，出现震动和缩放反馈后可稍微上移手指再左右拖动；桌面按住导航项后拖动。顺序保存在当前浏览器的 `localStorage`，并在桌面侧栏和手机底栏之间同步。
- 终端页面进入沉浸模式，隐藏通用大页头和手机底栏；顶部紧凑会话栏左侧保留返回概览的退出按钮，退出只断开 PTY 客户端，不结束 tmux 会话。粗指针设备将 xterm 输入框设为只读并声明手动虚拟键盘策略，不唤起系统键盘，输入全部由内置 QWERTY/符号键盘发送；默认层依照电脑键盘将反引号、短横线、等号、括号、反斜杠、分号、引号、逗号、点和斜杠放在字母周围，Shift 产生对应上档符号。Shift、Ctrl、Alt 是可见的一次性状态，退格和方向键支持长按连发，桌面物理键盘不受影响。终端区补充单指按行回滚，规避部分 Android WebView 无法滚动 xterm viewport 的问题。
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
- 音乐下载依赖第三方平台公开接口及 `media-get`，平台调整可能导致部分来源暂时不可用；当前没有歌词刮削，自动元信息匹配也可能因同名歌曲产生偏差，因此必须由用户确认后写入。
网页播放台将“当前播放状态”“持久播放列表”“曲库搜索”和“我喜欢”分开管理。播放列表按音箱保存，“我喜欢”在模块内共享；二者写入 `data/xiaoai-music/library.json`，服务或浏览器重启后仍可恢复。搜索结果可以立即播放、逐首加入或全部加入播放列表；点击播放列表或喜欢列表的任意一首时，从该位置开始连续播放后续歌曲。停止设备播放不会删除持久列表。

播放台还支持每台音箱独立的 0–100 音量设置。网页通过 worker 在音箱端调用 `ubus call mediaplayer player_set_volume`，最后设置值随音箱配置持久化；具体听感和最小音量仍由音箱固件决定。

“关闭语音监听”只注销语音事件处理，不关闭音箱 WebSocket。播放、停止和音量控制继续复用常驻连接，因此关闭语音指令接管后仍可通过网页控制音箱。

播放台使用响应式家庭音乐控制台布局。桌面端将正在播放与曲库作为主区域，当前播放队列固定在右侧；窄屏和手机端将队列改为底部抽屉，通过播放器中的“播放队列”按钮打开。音箱使用可横向滚动的房间卡片切换，连接状态直接显示在卡片中。刷新曲库、语音监听和音箱配置作为播放器快捷操作；通用指令和文字播报已迁移到独立“小爱同学”入口。

音乐页隐藏整站顶部的通用刷新按钮，曲库刷新仍使用播放器内的明确入口。当前尚未提供真实歌曲封面提取，因此播放器不展示无信息价值的统一占位封面，优先保持手机端紧凑布局；后续只有接入真实封面数据时才增加封面区域。

播放台的“循环次数”范围为 1–20，表示本次播放的总轮数，`1` 为正常播放一次。搜索结果中的单曲会重复指定次数；播放列表、我喜欢和随机队列会保持本轮顺序，并将完整列表重复指定轮数。循环后的单次播放队列最多 2000 首，播放到最后一轮末尾后停止。

循环轮数按音箱保存在浏览器 `localStorage`，刷新页面或切换音箱后会恢复各音箱最后使用的轮数。最后选择的音箱和整站主导航当前页面也会保存，重新打开时恢复最后使用的音箱及概览、文件、测速、小爱同学或音乐入口；如果已保存的音箱不存在，则回退到当前第一台。这些界面偏好只影响当前浏览器，不写入服务器配置。

“当前播放队列”是 worker 内存中的本次播放任务，展示正在播放歌曲及后续最多 99 首，停止播放或服务重启后会清空；“保存的播放列表”是用户主动加入并持久化的数据。随机播放、搜索结果直接播放或循环展开只会生成当前播放队列，不会自动写入保存列表。

当前播放队列中的待播歌曲可以直接点击切换。切歌会取消当前歌曲计时，从目标歌曲立即开始播放，并保留目标歌曲之后的剩余队列；正在播放的第一项不可重复点击。

- `GET /api/modules/xiaoai-music/profiles/:id/collection`：读取该音箱播放列表、模块喜欢列表及当前音箱最近 5 条播报记录。
- `POST /api/modules/xiaoai-music/profiles/:id/playlist`：追加歌曲或以 `mode=replace` 替换、清空持久播放列表。
- `DELETE /api/modules/xiaoai-music/profiles/:id/playlist?path=...`：从持久播放列表移除歌曲。
- `PUT /api/modules/xiaoai-music/profiles/:id/favorites`：添加或取消喜欢。
- `POST /api/modules/xiaoai-music/profiles/:id/collection/play`：从列表指定位置开始连续播放，可通过 `repeat` 指定 1–20 次总播放轮数。
- `POST /api/modules/xiaoai-music/profiles/:id/volume`：设置该音箱音量，范围 0–100。
- `DELETE /api/modules/xiaoai-music/profiles/:id/announcements`：清空当前音箱的播报记录。
