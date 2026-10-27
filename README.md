# B站拾讯 · dsh-bilibili-shixun

[![test](https://github.com/yuease/bilibili-shixun/actions/workflows/test.yml/badge.svg)](https://github.com/yuease/bilibili-shixun/actions/workflows/test.yml)

把 [astrbot_plugin_bilibili_shixun](https://github.com/yuease/astrbot_plugin_bilibili_shixun)（B站拾讯 v0.9.1）复刻到 DeepSeek Harness 的 Host 插件：直连 B 站，提供免登录关键词视频搜索、关键词 / UP 主 / 我的关注订阅、来源采集、本地内容库查询、条目图片查看与个人简报素材。

不依赖 RSSHub、不需要额外服务；除宿主内置能力外没有运行时依赖。

## 与 AstrBot 原版的对应关系

| AstrBot 原版 | 本插件 |
| --- | --- |
| 9 个聊天工具 `bilibili_*` | 同名 9 个工具，语义保持一致 |
| Dashboard 配置页 | 设置 → **B站拾讯** 独立页面（`settings.section`）：账号扫码、来源增删、采集参数、来源状态、最近内容；工具侧也保留全部管理能力 |
| 模型生成简报 | `bilibili_generate_briefing` 返回按来源轮换和发布时间选取的证据素材，附带兴趣说明，由当前会话的 Agent 判断取舍并写简报（不再额外调用一次模型） |
| `/B站登录` `/B站状态` `/B站退出` | `/bilibili-login` `/bilibili-status` `/bilibili-logout`，另有 `/bilibili-refresh`；二维码可在设置页或 `bilibili_login` 工具中查看 |
| 私聊 / 多用户隔离 | DSH 是单机单用户，数据按本机档案保存；聊天平台的用户隔离不适用 |
| QQ 平台图片投递 | 图片同时保存原图文件、并经宿主图片服务在会话中展示；`preview` 只展示宿主图像副本 |

保持的关键产品规则：只读取、不写入 B 站；内容只作证据，不编造摘要；不声称覆盖全部更新（`data_complete` 只会是 `false`/`null`，`completeness` 只会是 `unknown`/`incomplete`）；来源失败、范围不可用与无匹配分别报告；设置版本化、幂等、可撤销且不会自动触发采集。

## 安装

从 GitHub 安装：

```text
dsh plugin --profile <profile> add github:yuease/bilibili-shixun
```

本地开发安装（link 到当前目录，改代码后重载插件即可）：

```text
dsh plugin --profile <profile> add link:<本目录绝对路径>
```

或在 DSH 中用 `plugin_manager` 的 `install_bundle`，`target` 传本目录绝对路径或仓库地址。装好后重启会话即可看到工具；`dsh.client` 声明变更后需要完全重启 DSH。

## 使用

对话里直接说需求，Agent 会调用工具：

- 「去 B 站搜索天文视频，不要订阅」→ `bilibili_search_videos_online`
- 「订阅关键词 天文、宇宙，并打开关键词采集」→ `bilibili_update_subscriptions_and_preferences`（必须先读 `version`）
- 「刷新一下来源」→ `bilibili_refresh_subscriptions`
- 「今天关注的 UP 更新了什么」→ `bilibili_search_saved_content`（`terms` 留空，`time_range.period=today`）
- 「看看这条的原文」→ `bilibili_read_content_detail`
- 「把第二张图发出来」→ `bilibili_send_content_images`
- 「给我一份个人简报」→ `bilibili_generate_briefing`，再由 Agent 撰写
- 「登录 B 站 / 看登录状态 / 退出」→ `bilibili_login` 或 `/bilibili-status`

免登录可用：关键词搜索、关键词来源采集、UP 主投稿采集（走 B 站客户端接口，标题 / UP 主 / 发布时间 / 时长 / 封面齐全）。
需要扫码：UP 主动态、我的关注（视频 / 综合）。二维码约 3 分钟有效，后台轮询；`bilibili_login(action="status")` 查看结果。

## 工具一览

| 工具 | 作用 |
| --- | --- |
| `bilibili_search_videos_online` | 匿名联网搜索视频，保留 24 小时，不写入订阅 |
| `bilibili_search_saved_content` | 只查本地已采集内容（来源 / 时间 / 关键词 / 类型 / 有图） |
| `bilibili_read_content_detail` | 读正文、归属、图片与附件；UP 投稿缺简介时按需联网补一次 |
| `bilibili_get_subscriptions_and_preferences` | 读设置、版本、最近变更、来源与数据状态 |
| `bilibili_update_subscriptions_and_preferences` | 增量增删关键词 / UP 主，改兴趣，开关关键词与关注来源 |
| `bilibili_undo_settings_change` | 按 `change_id` 撤销，字段被后续修改时拒绝覆盖 |
| `bilibili_get_source_status` | 来源采集时间、失败原因、扫描范围与保留数量 |
| `bilibili_refresh_subscriptions` | 发起 / 查询采集任务，有限等待（0–20 秒） |
| `bilibili_send_content_images` | 下载并展示条目图片，默认保留原图字节 |
| `bilibili_generate_briefing` | 按来源轮换和发布时间选取简报素材；兴趣交给 Agent 判断，不调用模型 |
| `bilibili_login` | 扫码登录 / 状态 / 退出 |

设置类工具使用 `version` 做乐观并发；同一版本、同一修改内容的重试返回 `replayed` 结果。读取新版本后重复相同修改视为新操作，删除后可再次添加。设置先在副本中完整校验，校验失败不修改内存、版本、回执或磁盘。保存设置不会自动采集。

## 定时采集

对应原版的 `collection.enabled` / `interval_minutes`：

- 工具：`bilibili_update_subscriptions_and_preferences({ expected_version, collect: { enabled: true, interval_minutes: 60 } })`；
- 设置页：「采集 → 定时采集」勾选并选间隔；
- 行为：只在 DSH 运行期间执行；到达时间点自动发起一次与手动刷新相同的采集任务（同一时间只会有一个任务）；如果上次采集已超期，插件启动后会补跑一次；
- 状态：`bilibili_get_source_status` / `get_subscriptions_and_preferences` 返回 `schedule`（`enabled`、`interval_minutes`、`next_run_at`、`due`、`last_error`）。

## 设置页（Web GUI）

设置 → 侧栏 **B站拾讯**（`settings.section`，order 25）提供独立页面，内容与工具共用同一份数据：

- **账号**：登录状态、UID、扫码登录 / 刷新二维码 / 退出 / 联网检查；二维码直接内嵌在页面里。
- **订阅来源**：关键词与 UP 主增删（回车即加）、关键词采集开关、我的关注开关、每来源批数与候选上限、兴趣说明。
- **采集**：立即刷新、任务状态与 `data_completeness`、警告列表、逐来源状态表（状态 / 最近成功 / 保留数 / 扫描停止原因）；定时采集开关与间隔（30/60/120/360 分钟）。
- **最近内容**：本地最新 12 条，标题可点开到 B 站原文，附作者、时间、类型、来源标签。

页面通过 Host 注册的 `/bilibili-shixun/api/*` 路由读写（同源校验、`no-store`）；设置保存沿用版本号冲突检测，冲突时提示并重新载入。

首次安装或升级 `dsh.client` 声明后，**需要完全退出并重开 DSH**（Host 会按包名缓存包元数据），再刷新页面即可在设置里看到该页。

## 数据

- 配置目录默认 `$DSH_HOME/bilibili-shixun`，可在 bundle patch 的 `config.dataDir` 覆盖。
- `state.json`：设置、变更历史、内容库、来源状态、临时搜索结果（24 小时、最多 200 条）。
- `account.json`：仅在本机保存 B 站 Cookie，登录失效后清空；不会出现在工具输出或日志中。
- `media/`：原图与登录二维码文件。
- 内容库默认最多保留 3000 条，超出按最早写入丢弃。

## 已知限制

- B 站接口与风控会变化：空间接口可能返回 `-352`/`412`，此时来源状态为 `rate_limited`，不会伪造成功。插件对 UP 投稿优先使用客户端接口，Web 接口仅作回退。
- `up_dynamics`、`following_*` 需要登录；未登录时这些来源标记 `auth_required` 并跳过，不影响其他来源。
- `bilibili_send_content_images` 的 `preview` 只影响会话展示副本，不做本地缩放；`original` 始终写入原始字节文件。
- 采集是有限采样：默认每个动态来源最多 2 批、每来源最多 60 条候选、单次任务最多 6–24 次请求、60 秒；`data_completeness` 永不为 `complete`。
- 定时采集只在 DSH 进程运行期间生效；DSH 关闭期间到点的任务不会在后台执行，只会在下次启动时补跑一次。
- 未做多用户隔离（DSH 单用户），也未移植原版的兴趣学习打分、别名、过滤规则引擎与 Dashboard 页面。

## 开发

```text
lib/api.js      B 站接口（WBI 签名、客户端接口、二维码登录、视频详情）
lib/http.js     串行限速 HTTP、Cookie 罐、图片下载
lib/store.js    设置版本 / 撤销 / 内容库 / 查询语义
lib/refresh.js  采集队列、预算、来源状态
lib/tools.js    11 个工具与输出渲染
lib/webui.js    /bilibili-shixun/api/* 路由（状态、设置、采集、登录）
lib/scheduler.js 定时采集（间隔到期检查、启动补跑）
lib/index.js    Host 插件入口、4 个命令
lib/qr.js       二维码 PNG（vendor/qrcode-generator，MIT）
client.js       设置页（settings.section，React 来自浏览器模块表）
```

许可证：本插件 MIT。`lib/vendor/qrcode-generator.cjs` 来自 Kazuhiko Arase 的 qrcode-generator 1.4.4（MIT），文件头保留原始版权声明。

## 测试

```text
node test/smoke.mjs          # 离线：条目归一化、设置版本/撤销、查询过滤、简报、二维码
node --test test/regressions.mjs # 重复订阅、事务校验、全来源查询、公平选材、登录竞态
node test/client-render.mjs  # 无浏览器渲染设置页（React stub），检查文案与分支
BILIBILI_LIVE=1 node test/smoke.mjs   # 额外做一次真实匿名搜索（1 次请求）
```


## v0.3.1 修复说明

- 修复重复添加／删除订阅被旧幂等回执拦截；请求编号同时包含 expected_version 和修改内容。
- 扫码、登录状态检查、二维码生成和卸载使用登录代次检查；退出后迟到的响应不会重新保存凭据。HTTP Cookie 罐也拒绝旧代次响应的 Set-Cookie 与扫码回调凭据；同一轮扫码不重叠轮询，账号文件写入串行化。
- 只指定来源 kind 时展开全部匹配来源；指定 key 仍严格限制，未知来源不会扩大范围。
- 设置在副本中全部校验通过后才提交；组合修改报错不再留下半改状态。
- 简报从全部符合条件的保留内容分来源轮换，跨来源条目只选一次，然后应用最多60条候选／最多10条输出的限制；公开检索每页仍最多10条。兴趣只作为当前 Agent 的取舍依据，插件不执行语义兴趣评分；输出明确标记 interest_ranking_applied=false。

验证：8项原有离线检查、13项新增回归及1项React桩页面渲染检查通过。未使用真实DSH、真实扫码账号、付费模型或真实B站网络；不能据此宣称宿主安装及真实登录已验收。
