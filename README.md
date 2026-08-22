# allinone

面向个人 NAS 的统一入口。第一期提供移动端优先的系统概览、只读文件管理器与可维护的地址导航。

## 已实现

- 默认进入系统 Home，在多个受控根目录之间切换、进入子目录、面包屑返回
- 默认隐藏名称以 `.` 开头的文件和目录，可通过文件页工具栏切换显示
- 一键复制当前目录、文件或子目录在服务器上的绝对路径
- 收藏任意受控目录，并通过文件页顶部快捷栏快速进入
- 列表/网格布局，以及图片、音频、视频、PDF 和常见源码/配置/日志/字幕文本在线预览
- 支持 Range 的文件播放与下载
- CPU、内存、CPU 温度以及每块物理硬盘的用量/温度按需读取，不运行常驻采集任务
- 导航地址的添加、编辑、删除与持久化
- 导航链接可保存最多 2000 字符的可选备注，通过卡片信息按钮按需查看
- 网络测速模块，可真实测试当前浏览器到 Allinone 服务器的上传和下载速度，并支持中途停止
- 手机底部导航、底部预览抽屉、安全区域和桌面侧栏布局

## 启动

需要 Node.js 20 或更高版本，无需安装第三方依赖。

```bash
cp .env.example .env
# 按实际情况修改 .env 后，将其中变量加载到当前 shell
set -a; source .env; set +a
npm start
```

访问 `http://127.0.0.1:2006/`。服务默认监听 `0.0.0.0:2006`，同一局域网的手机可以通过 `http://Mac的局域网IP:2006/` 访问。

DevStudio 托管预览 `https://devstudio.xuekai.top:8888` 会请求 `https://aio.xuekai.top:8888` 下的接口。本地 Preview 运行在 `8787` 时，前端自动连接同一主机的 `2006` 端口；直接访问则使用同源接口。

未配置 `FILE_ROOTS` 时默认开放并进入运行用户的 Home 目录。配置多个目录的格式如下：

```env
FILE_ROOTS=照片:/Volumes/NAS/Photos,音乐:/Volumes/NAS/Music,电影:/Volumes/NAS/Movies
```

当前服务器已配置 `Home` 和 `xuekai-master` 两个文件入口。

## 访问令牌

在项目根目录的 `.env` 中设置长度充足、随机且独立的令牌：

```env
DEVSTUDIO_TOKEN=replace-with-a-long-random-token
```

重启 `npm start` 后生效。浏览器访问会进入 `/login`，登录状态保存 30 天；访问 `/logout` 可退出。API 可使用登录 Cookie 或 `Authorization: Bearer <token>`，iframe 等无法添加请求头的必要场景可使用 `?token=<token>`。URL 会泄露到历史记录和代理日志，应优先使用 Cookie 或 Bearer。

留空或删除 `DEVSTUDIO_TOKEN` 时保持无认证模式。`.env` 已被 Git 忽略，不要将真实令牌写入源码、文档或 `.env.example`。更换令牌并重启后，旧登录 Cookie 会自动失效。

## PM2 常驻运行

服务器上由 PM2 管理 `allinone` 进程，配置位于 `ecosystem.config.cjs`。修改代码或 `.env` 后使用：

```bash
npm run pm2:restart
```

常用命令：

```bash
npm run pm2:start
npm run pm2:stop
npm run pm2:logs
pm2 status
```

PM2 已保存当前进程列表；系统启动时由 `pm2-xuekai.service` 恢复。若以后增删 PM2 应用，需要再执行 `pm2 save`。

## 模块扩展

后续的音乐下载、小爱同学音乐播放等功能会作为独立模块加入，不与概览、文件和导航的内部状态混用。每个模块将拥有独立的前端代码、API 命名空间、数据目录和错误边界；只复用鉴权、通用 UI 和安全校验等公共基础能力。详细边界见 `doc.md`。

## 安全提示

当前仅提供共享访问令牌，不是多用户账号系统，也没有暴力破解限速。不要把 2006 端口直接暴露到公网；对外部署应启用 HTTPS，并在反向代理层增加限速或访问控制。文件管理器只读，且所有访问都会校验是否位于 `FILE_ROOTS` 中。

更完整的架构与接口说明见 [doc.md](./doc.md)。
