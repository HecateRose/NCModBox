# NightCity Modbox

《赛博朋克 2077》的 Mod 包管理器 —— Electron + Vue 3，仅 Windows。

一个**自用工具**：在程序里浏览 Nexus Mods、下载、部署、排序、检查依赖和更新，附带离线翻译与诊断能力。界面是中文的。

当前版本：**v1.1.0**

---

## ⚠️ 先看这里：关于维护

- 这是**个人自用软件**，按「我自己够用」的标准打磨，**不承诺长期维护**。
- **可以提 Issue**，但我不保证会回复或修复。
- 如果**长时间没有得到回应**，欢迎 **fork 本仓库，用 AI 自己接着改** —— 代码结构和交接信息都是按照「让 AI 能接手」来设计的（类型识别、部署规则、自检脚本都尽量写得可读可改）。
- 与 CD Projekt Red、Nexus Mods 没有任何官方关联。所有 Mod 的版权归原作者，本工具只负责下载与文件部署。
- 使用本工具产生的一切后果（游戏损坏、存档丢失、账号风险）由使用者自行承担。

---

## v1.1.0 更新重点

**部署模块重构**（这一版的主要工作）：

- **部署页改为三个分类 tab**：无需排序 / 需要排序 / 排序列表。路径设置、健康检查、依赖缺失、外部变更收进「无需排序」；Legacy archive 与 REDmod 的 Mod 列表在「需要排序」；冲突扫描与加载顺序在「排序列表」。
- **健康检查**：一键检查游戏目录、staging 记录（目录缺失/重复导入）、部署一致性（文件缺失/源缺失）、外部变更、脚本缓存、框架缺失，按错误/警告/提示分级并给出修复建议。
- **冲突扫描 + 自动排序**：扫描 archive/pc/mod 的冲突（有 red4-conflicts.exe 时做文件级扫描，没有时给静态分析）；「自动排序」按 Mod 分组重排 Legacy archive（同 Mod 相邻），写回 modlist.txt。
- **外部变更简化**：部署时自动接受外部变更，不再逐条确认；面板提供「全部接受 / 全部恢复 staging」批量按钮。
- **部署安全机制**：
  - 目标文件已存在且内容一致 → 自动接管；
  - 内容不一致（旧版本残留）→ 先备份到 userData/deploy-backup 再覆盖；
  - 覆盖过游戏原版文件时记录备份，撤销部署时恢复原版；
  - 部署/撤销后自动清理 r6/cache/final.redscripts.modded 等脚本缓存，避免游戏加载旧 Mod 脚本导致卡死黑屏。
- **记录联动修复**：下载记录 ↔ staging ↔ 部署 manifest 三层按 modId 校验绑定，历史错绑可自愈；导入压缩包/文件夹时自动回绑下载记录。
- **性能**：部署页轮询改为轻量进程查询；外部变更改为异步加载，首屏更快。

---

## 功能

### 浏览与下载
- **Nexus Mods v2 GraphQL**：列表 / 搜索 / 分类 / 标签 / 排序 / 分页，**无需 API Key**
- 详情页：BBCode 简介解析、图集（离屏窗口抓取，规避 Cloudflare）、文件大小、版本
- **程序内下载**：点「下载」打开 Nexus 文件页 → 页面里点 Manual → Slow download → 程序自动接管落盘（will-download 拦截），自动解压进 staging
- **本地离线翻译**：opus-mt 英中快速模型，覆盖列表简介、详情正文、包体记录，逐段渐进显示

### 部署
- **类型识别**（按特征文件，不猜路径）：Legacy archive / .xl / redscript / TweakXL / CET 本体 / CET 插件 / RED4ext 本体 / RED4ext 插件 / REDmod / 混合型 / 游戏根结构兜底
- **硬链接部署**：Legacy archive / redscript / tweak / CET / RED4ext 走硬链接（同盘）；REDmod 整目录复制并调用 redMod.exe deploy
- **modlist.txt** 加载顺序、Legacy 与 REDmod 两条独立序列、拖拽排序 + 上下移动、自动排序
- **撤销部署**：只删除仍是硬链接/未被外部修改的文件；覆盖过原版文件的恢复原版；外部修改保留并报告
- **外部变更检测**：refchange / valchange / deleted / srcdeleted，支持批量接受或恢复
- **健康检查**、**冲突扫描**
- 单 Mod 部署 / 撤销、「重新识别」、按加载方式分组

### 依赖与版本
- **核心框架依赖检测**：按文件特征 + Nexus 前置声明推断需要 CET / redscript / ArchiveXL / TweakXL / RED4ext，缺失软警告
- **Mod 前置检测**：读取 Nexus 官方前置列表，缺失项支持一键下载
- **版本校验与一键更新**：批量查最新版本 → 下载新版 → 撤销旧部署 → 替换 staging → 自动重新部署
- **游戏版本适配标注**：解析下载文件名里的 game version 与游戏 exe 版本对照，不一致黄标提醒

### 诊断
- **日志聚合**：r6/logs、CET、RED4ext、RedHotTools 日志，ERROR/WARNING 高亮与筛选，侧边栏显示日志源数量
- **冲突扫描**：见上
- 启动 / 停止游戏（5 秒轮询运行状态）

### 其他
- 内置 **7-Zip 26.05**：解压支持 zip / 7z / rar / tar / gz（安装包自带）
- 可配置下载目录、staging 目录
- 自检脚本：部署链路（MODBOX_DEPLOY_TEST）、包体状态（MODBOX_PACK_TEST）、真实下载（MODBOX_DOWNLOAD_TEST）、截图（MODBOX_SHOT）

---

## 技术栈与实现手段

| 部分 | 选型 |
|---|---|
| 框架 | Electron 33 + electron-vite + Vue 3 + Element Plus + vue-router（hash 模式） |
| 数据源 | Nexus Mods v2 GraphQL（api.nexusmods.com/v2/graphql，公开查询无需鉴权） |
| 下载 | Electron BrowserWindow（屏幕外真实窗口）+ session will-download 拦截 + 程序内登录 Cookie |
| 部署 | Node fs.linkSync 硬链接 + manifest（记录备份路径/文件大小/修改时间）+ modlist.txt；REDmod 用 fs.cpSync + redMod.exe deploy |
| 翻译 | @huggingface/transformers 4.x（Transformers.js）+ onnxruntime-node，默认 opus-mt-en-zh（约 75MB），非中文目标回退 NLLB-200-distilled-600M；模型缓存于用户数据目录，完全离线 |
| 解压 | 内置 7-Zip 26.05（LGPL，见 tools/7z/License.txt），找不到时 zip 回退 PowerShell |
| 图片 | 离屏真实窗口加载 Nexus 图片页，读取静态图地址 |
| 状态 | %APPDATA%/nightcity-modbox/：设置、下载记录、staging 索引、部署 manifest、翻译缓存、部署备份 |

> 翻译模型不随安装包分发，首次使用时会从 hf-mirror / Hugging Face 下载（约 75MB），之后完全离线。

---

## 使用方法

### 从发布版安装
1. 下载 Releases 里的 NightCity-Modbox-x.x.x-setup.exe
2. 安装并打开
3. **设置游戏目录**（部署页 → 路径设置 → 选择《赛博朋克 2077》根目录）
4. 顶栏「**登录**」→ 在弹出的窗口里登录 Nexus Mods（免费账号即可）
5. 浏览页找到 Mod → 点「**下载**」→ 在打开的 Nexus 文件页里点 Manual → Slow download
6. 下载完成会自动解压进 staging；也可以在包体记录/已下载页手动导入压缩包或文件夹
7. 部署页：
   - 「无需排序」tab 管路径和直接落目录的 Mod（redscript / TweakXL / CET / RED4ext 插件）
   - 「需要排序」tab 管 Legacy archive 和 REDmod
   - 「排序列表」tab 里先跑冲突扫描，需要时点「自动排序」，再手动微调加载顺序
8. 点「**部署**」→「**启动游戏**」

### 从源码运行

    npm install
    npm run dev      # 开发（热更新）
    npm run build    # 构建到 out/
    npm run dist     # 打包 Windows 安装包到 release/

### 常见问题

- **部署被阻止**：现在只剩两种情况会阻止——目标文件是目录，或 staging 源文件缺失。其他情况（旧版本残留、未管理文件、跨 Mod 同路径）都会自动处理（备份/覆盖/接管）。
- **游戏卡在加载界面**：先确认没有旧 Mod 脚本缓存残留（本版本部署/撤销会自动清理）；仍卡的话用「撤销部署」清空后启动游戏测试。
- **外部变更**：部署时会自动接受，也可以在「无需排序」tab 里批量恢复。

### 使用前必看
- **仅 Windows**（部署、解压、启动游戏都用了 Windows 特性）
- **游戏目录与 staging 必须在同一分区** —— 硬链接不支持跨磁盘，跨盘会直接阻止部署
- **游戏运行时禁止部署/撤销**（程序会检测进程并锁定）
- 游戏大版本更新后，Mod 需要作者适配；管理器会在「适配 X ≠ 当前 Y」时黄标提醒
- 冲突扫描的完整能力需要自行下载 red4-conflicts.exe 放到游戏根目录或 tools/

---

## 目录结构

    src/
    ├─ main/                 # 主进程
    │  ├─ index.js           # 窗口 / IPC / 自检入口
    │  ├─ graphql.js         # Nexus v2 GraphQL
    │  ├─ nexus.js           # 图集抓取与历史 v1 兜底
    │  ├─ downloader.js      # 程序内登录 / 下载窗口 / will-download 接管
    │  ├─ deployer.js        # 类型识别 / 部署 / 撤销 / 备份恢复 / 缓存清理 / 健康检查 / 自动排序
    │  ├─ dependencies.js    # 核心框架与 Mod 前置检查
    │  ├─ library.js         # 下载记录与包体派生状态（modId 绑定校验）
    │  ├─ localTranslate.js  # 本地翻译模型
    │  ├─ translate.js       # 翻译缓存与调度
    │  ├─ logs.js            # 日志聚合
    │  ├─ conflicts.js       # 冲突扫描
    │  ├─ settings.js        # 设置存取
    │  └─ selftest*.js       # 自检脚本
    ├─ preload/              # contextBridge 安全桥
    └─ renderer/src/         # Vue 应用（视图 / 组件 / store / 工具）
    tools/7z/                # 内置 7-Zip（LGPL）
    build/icon.png           # 应用图标

---

## 已知限制

- 仅支持 Windows、仅支持《赛博朋克 2077》
- 下载流程依赖用户在 Nexus 文件页手动点 Manual → Slow download（新版下载组件只认真实用户手势）
- 翻译模型是 75MB 专用小模型，术语翻译可能生硬
- REDmod 部署与加载顺序的「游戏内实际行为」需要具体 Mod 验证（文件路径与工具调用已按标准实现）
- 冲突扫描未安装 red4-conflicts.exe 时只有静态分析
- 热重载（CET Lua Agent + RHT）**未实现**

---

## 许可

[MIT](LICENSE)。内置的 7-Zip 遵循其自身的 LGPL 协议（见 tools/7z/License.txt）。
