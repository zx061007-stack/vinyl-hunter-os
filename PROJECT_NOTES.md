# Vinyl Hunter OS —— 项目说明与跨设备迁移指南

> 黑胶（Vinyl）唱片业务运营一体化 Web App（PWA）。当前稳定版：**v14**。
> 最后更新：2026-08-11

---

## 1. 线上地址（手机/电脑通用）

- **GitHub Pages（线上正式版）**：https://zx061007-stack.github.io/vinyl-hunter-os/
  - 这是个 PWA：手机浏览器打开后，用「分享 → 添加到主屏幕」即可变成 App 图标，离线也能开。
  - 国内手机打开后，**采集类功能**（每日热点、音乐资讯、汇率）依赖 Cloudflare Worker（`*.workers.dev`），若该域名被网络屏蔽会采集失败。
    - 解决：在「系统设置」里把代理地址换成国内可访问的域名；或用电脑端「数据备份中心」导出数据后，在手机端导入。
- **本地开发预览**：`http://localhost:3000`（需本机启动 `node preview-server.js`）。

---

## 2. 部署架构

| 部分 | 位置 | 说明 |
|------|------|------|
| 前端（HTML/CSS/JS） | GitHub 仓库 `main` 分支 | 推送到 `main` 后，GitHub Pages **自动构建发布**（约 1 分钟生效）。 |
| Cloudflare Worker（代理/聚合） | `cloudflare-worker/china-hot-proxy.js` | 解决浏览器跨域 + 聚合热搜/Discogs/AI 数据。运行在 Cloudflare 云端，**不会**因本机卸载而消失。 |
| 业务数据 | 各设备浏览器 IndexedDB | **本地存储，不随仓库同步**（见第 5 节）。 |

当前 Worker 地址：`https://vinyl-proxy.w79m2n5jms.workers.dev`
- `/hot?platform=weibo|douyin|bilibili|xiaohongshu` —— 单平台实时热搜
- `/discogs/...`、`/ai-analyze`、`/music-news`、`/fx` 等路由

---

## 3. 在「新电脑」上继续优化（代码改动）

1. 安装 git + Node.js（建议 22.x）。
2. Clone 仓库：
   ```bash
   git clone <本仓库地址>
   cd vinyl-hunter-os
   ```
3. 本地预览（任选其一）：
   ```bash
   node preview-server.js          # 已自带，监听 3000
   # 或： python3 -m http.server 3000
   ```
4. 改代码后，**务必 bump 版本号**（否则用户浏览器走 PWA 旧缓存看不到更新）：
   - 改 `index.html` 与 `sw.js` 里的 `?v=N` 和 `vinyl-hunter-os-vN`（全局替换即可）。
   - 例：`?v=14` → `?v=15`。
5. 提交并推送：
   ```bash
   git add -A && git commit -m "v15: ..." && git push origin main
   ```
   GitHub Pages 会自动重新部署。
6. 让使用者**硬刷新**（Ctrl/Cmd+Shift+R）一次清缓存。

> 本机若用 WorkBuddy 的托管 Node，路径为 `C:\Users\<用户>\.workbuddy\binaries\node\versions\22.22.2\node.exe`；普通安装直接用 `node` 即可。

---

## 4. Cloudflare Worker 的迁移/重部署

- Worker 代码已随仓库在 `cloudflare-worker/` 目录，**云端实例不依赖本机**，所以现网功能不受影响。
- 若要在新电脑**改 Worker 代码并重部署**：
  1. 新电脑安装并登录 Cloudflare：`npm i -g wrangler` → `wrangler login`。
  2. `cd cloudflare-worker && npx wrangler deploy`（域名/路由沿用旧配置，需确认 `wrangler.toml` 里的 `name` 与账号一致）。
- 若不想碰 Worker，前端仍可照常改；只是代理地址若变，需在「系统设置」更新。

---

## 5. 业务数据如何带到新设备（重要）

IndexedDB 数据（库存、CRM、热点、AI 使用记录、各模块录入）**只存在每台设备的浏览器里**，仓库不含这些数据。换电脑/手机后：

1. 旧设备打开「**数据备份中心**」→ 导出全部为 `.json` 文件。
2. 新设备打开同一 App →「数据备份中心」→ 导入该 `.json`。
3. 手机端同理：从电脑导出的 `.json` 导入即可。

> 没有"云端账号自动同步"——每台设备数据独立。导出/导入是唯一搬迁手段。

---

## 6. 模块清单（共 16 个）

| 模块 | 说明 |
|------|------|
| 工作台(dashboard) | 总览 + 主题/背景设置入口 |
| 数据采集中心(datahub) | 一键采集：汇率/Discogs/音乐资讯/4 平台热点 |
| 唱片网址(websites) | 唱片相关网站导航（**无 AI**，v12 已移除） |
| Discogs 数据库(discogs) | 专辑查询，详情行内展开，图片可查看/保存 |
| 认证管理(auth) | 平台账号认证 + AI 检查清单 |
| 黑胶全分析(analysis) | 普通 6 卡分析 + 专辑内「AI 深度分析」卡片（v12 拆分） |
| 利润计算(profit) | 买卖利润测算 |
| 库存(inventory) | 黑胶库存管理 |
| 每日热点(hot) | 4 个平台独立采集按钮：抖音/小红书/微博/B站 |
| 音乐资讯(musicnews) | 全球音乐新闻 |
| 实时汇率(fx) | 汇率（**无 AI**，v12 已移除） |
| 花费(expense) | 经营支出 |
| 客户CRM(crm) | 客户管理 |
| 每日计划(plan) | 待办计划 |
| AI使用记录(aiusage) | AI 各模块累计使用次数 + 清零（v12 新增） |
| 数据备份中心(backup) | 导出/导入全部 IndexedDB 数据 |
| 系统设置(settings) | 主题多风格 + 自定义背景图 + 各代理地址 |

---

## 7. 已知坑 / 开发约定

- **改完必须 bump 版本号 + 提示用户硬刷新**，否则 PWA 缓存导致看不到更新。
- **删除/重命名函数后，务必 `grep` 全仓引用点复查**：v12 删除 `collectHot` 等漏改 `buildDataHub` 导致数据采集中心空白（v14 修复）；v12 漏把 `fetchPlatformHot` 导出到 `VHAPI` 导致每日热点采集失败（v13 修复）。
- **Worker `*.workers.dev` 国内常屏蔽**：手机/国内网络采集失败多为域名被墙，非代码问题；换代理域名或导入数据即可。
- AI 分析有两路：远程（填了 `aiProxyUrl` 走 Cloudflare Worker 调 DeepSeek 等）与本地确定性算法（未填代理时，不耗 Token 也能出结果）。
