# AGENTS.md — 给 AI agent 的 Purge 使用说明书

> 这份文件是写给**在 DSH 里干活的 agent** 的，不是营销文档。
> 当前版本：**1.7.15** · 适配 DSH Desktop **0.2.2-rc.1**（0.2.1-rc.5 同样通过）
> 版本号由 `npm run check:docs` 与 `package.json` 校验，发版必须同步。

---

## 0. 30 秒版本

- 这个插件（`dsh-purge-community`）把 DSH 里**拦你的东西**拆掉：审批弹窗、沙箱拒绝、fs 围栏、工具结果修剪、计划模式硬拦、`ask_user_question` 等待、以及模型自己的拒绝倾向。
- 你不需要"绕过"它——**它就是替你拆闸的**。看到"我不能/建议你先确认"这类输出，多半不是插件失效，而是模型层的问题，按 §5 排查。
- 你的操作入口只有两个：**面板（左侧栏 Purge）** 和 **CLI（`purge-community`）**。别手改 `~/Library/.../Resources/app` 下的宿主文件，改了会被下一次「应用」覆盖。

## 1. 心智模型：五层，各管一件事

| 层 | 由谁提供 | 生效方式 | 你能怎么查 |
| --- | --- | --- | --- |
| **宿主补丁**（82 条） | 本插件写进 DSH 源码 | 点「应用」写入 → **退出重开**才加载 | `selfcheck` 看各层 `applied/required` |
| **提示词注入** | 插件运行时（每步重贴） | `prompt-inject.md` 作为 `dsh-purge` section | 探针（§4）或看 `selfcheck` 的「运行时提示词注入」 |
| **破甲强化段** | 插件运行时 | 尾部 section（默认开） | `purge-community boost` |
| **权限配置** | profile 的 `cordis.patch.yml` | `danger-full-access` + `approval: never` | `selfcheck` 的「当前 profile 的权限选择」 |
| **agent 预设** | `unrestricted` 预设 | 新会话下拉里选 | 面板/预设下拉 |

**关键结论**：宿主补丁与权限配置仍为全局；提示词注入和强化段默认全局，可用 `excludePresets` 按预设排除。排除不等于撤销全局补丁。

## 2. 生命周期：装 → 应用 → 重开

```
安装插件（curl 一行）
   ↓
点「应用」→ 解包 host / 写 82 条补丁 / 建快照
   ↓
退出并重开 DSH   ← 补丁只有重启后才被加载
   ↓
selfcheck 全绿 = 可以开工
```

**什么时候需要再点一次「应用」**（这是最高频的维护动作）：

1. DSH 官方更新之后（`app.asar` 会重新出现，旧补丁全部失效）；
2. 插件自身升级之后（新补丁要重新写）；
3. 新装了带工具面/预设的插件（会多出补丁目标）；
4. 发现模型开始推脱、或者工具突然被追问审批。

一句话：**「应用」是幂等的**，不确定就点它，然后退出重开。

## 3. CLI 参考（全部命令 + 退出码）

| 命令 | 作用 | 退出码 |
| --- | --- | --- |
| `purge-community status` | 宿主路径、补丁计数 | 0 |
| `purge-community selfcheck [--json\|--text]` | 26 层逐层证据 | **broken → 1**，pending/ok → 0 |
| `purge-community host-status` | 只读磁盘布局与当前服务入口证据，不退出/换包/重启 | 0，须检查 state |
| `purge-community diagnose [--json]` | 锚点漂移诊断（含行号 + 片段） | 0 |
| `purge-community reanchor list\|show\|apply <id> [--index n] [--lines a-b] [--yes]\|clear <id>` | 半自动重锚：把新锚点钉成本地覆盖 | 0 |
| `purge-community probe [new]` | 生成/查看运行时探针 | 0 |
| `purge-community audit [--limit n]` | 最近动作记录（apply/revert/boost/probe/preset/reanchor） | 0 |
| `purge-community boost [on\|off]` | 尾部强化段开关 | 0 |
| `purge-community preset [status\|install [--force]]` | `unrestricted` 预设落盘 | 0 |
| `purge-community usage` / `prune` | 备份占用 / 清理+GC | 0 |
| `purge-community backup` / `rollback <id>` | 快照 / 回滚插件 | 0 |
| `purge-community delete <备份ID>` | 删除单份本机备份并回收去重对象 | 0，备份不存在/ID 无效/被锁 → 非 0 |
| `purge-community apply` / `revert` / `uninstall` / `edit` | 原版能力（转发 `dsh-purge`） | 透传 |

`selfcheck` 状态：`ok`（已确认）/ `pending`（待应用）/ `inferred`（宿主推导，黄）/ `unknown`（证据不足，黄）/ `broken`（已确认故障或权限不匹配）。
**pending 不是故障**——别去改补丁表，点一次「应用」即可。

## 4. 运行时探针：证明"注入真的到了模型"

文件被改、section 被注册，只证明宿主侧就绪；探针证明模型**收到了**。

```sh
purge-community probe new
# → {"nonce":"purge-1a2b3c4d", "message":"请原样输出下面这行…[purge-1a2b3c4d]"}
```

然后任意发一句对话。**模型原样回显该 nonce = 链路通**。探针 30 分钟自动过期，不会长期占 token。

排查原则：
- 回显了但模型仍然推脱 → 问题在**模型层/人设**，不是插件（换强化段或预设人设）；
- 没回显 → 注入没到达（看 `selfcheck` 的运行时注入层、`boost` 是否被关、`injectPosition` 是否被改成 `tail` 但宿主没重贴）。

## 5. 症状 → 动作（决策树）

| 症状 | 先跑 | 判读 | 动作 |
| --- | --- | --- | --- |
| 补丁数不是 applied/total（全量 82） | `selfcheck --json` | 看 `layers[].state` | pending → 点应用；broken → `diagnose` |
| 全部 `missing_file` | `status` | `ai_base` 为空 | 宿主未解包：点应用 → 重开 |
| 模型开始推脱/要求确认 | `probe new` | 回显否 | 回显：调人设/强化段；不回显：检查注入层 |
| 工具被拒绝执行 | `selfcheck` | 沙箱/审批层是否绿 | 绿 → 属工具自身限制；红 → 点应用 |
| DSH 刚更新过 | `status` | `asar_still_sealed` | 点应用 → 重开 → `selfcheck` |
| 面板显示版本不一致 | 面板顶部黄条 | 界面与后端不同版本 | 重装同一版本（README 一行命令） |
| 想撤销一切 | — | — | `revert`（只撤补丁）/ `rollback <id>`（回滚插件） |

## 6. 状态与文件（你可以安全读，不要乱写）

| 路径 | 内容 |
| --- | --- |
| `$DSH_HOME/dsh-purge/tuning.json` | `{boost, injectPosition, askNoBlock}` |
| `$DSH_HOME/dsh-purge/probe.json` | 探针 nonce（30 分钟 TTL） |
| `$DSH_HOME/dsh-purge/anchor-overrides.json` | 本地重锚覆盖（不改插件源码；删掉即恢复出厂锚点） |
| `$DSH_HOME/dsh-purge-community/audit.jsonl` | 动作审计（1MB 轮转，保留 2 份）；面板「维护 → 最近动作」 |
| `$DSH_HOME/dsh-purge/applied.json` · `installed-rev` | 上次应用的插件版本 |
| `$DSH_HOME/dsh-purge-community/backups/<id>/` | 快照（`manifest.json` + 小文件；大文件在 `objects/`） |
| `$DSH_HOME/.agent-presets/unrestricted/` | 无限制模式预设（首行 `# managed-by: dsh-purge` 时会被新版覆盖） |
| `$DSH_HOME/prompt-inject.md` | **用户的注入正文**，插件只读不改（除非用户点保存） |

**不变量**：`prompt-inject.md`、规则集、其他插件配置，任何时候都不该被「应用」或「回滚」覆盖。

## 7. 补丁表：82 条，怎么读、怎么加

- 定义在 `lib/core.js` 的 `ALL_PATCHES`（`PATCHES` / `CODE_PATCHES` / `ENGINE_PATCHES` / `NEW_TOOL_PATCHES`）。
- 每条 = `{id, name, layer, file, replacements:[{pattern, replace}], markers, optional?}`；`pattern` 是对宿主源码的**精确片段**（或正则），`markers` 用来判断"已应用"。
- 新增一条的规矩：
  1. 在 `targetFiles()` 里登记目标文件键；
  2. `replace` 里留一条 `[dsh-purge]` 标记，写进 `markers`；
  3. 在 `test/patch-anchors.test.mjs` 里钉一份真实源码片段做回归；
  4. `optional: true` 用于第三方插件目标（不在场时显示"不适用"而不是失败）。
- 宿主升级后锚点漂移：`diagnose` 会给出文件、行号、旧锚点首行、以及**可能的新落点**片段。
- 确认新落点后：`reanchor apply <id> --lines A-B`（先看 dry-run 的候选片段，再加 `--yes` 写入）。覆盖存 `anchor-overrides.json`，引擎会把它当该条的 pattern；`reanchor clear <id>` 撤销。

## 8. 预设：`unrestricted`（无限制模式）

- 它是 **standard 的超集**（20 行，工具面完全一致），差别只在人设：执行优先、不重复声明边界、多轮不退化。
- 由 `lib/presets-plugin.js` 注册到 `agentPresets`（**只放文件不会出现在下拉里**）。
- 安装：`purge-community preset install`；首次注册后，面板/新会话下拉可见。
- 不要把它当成"额外破甲"——破甲靠宿主补丁，预设只改人格。
- 回归测试卡：`docs/preset-test.md`（A/B 五条 prompt + 判读标准 + 不通过怎么办）。

## 9. 版本与兼容

| 组件 | 值 |
| --- | --- |
| 插件 | `dsh-purge-community` 1.7.15 |
| 已验证宿主 | DSH Desktop 0.2.2-rc.1 / 0.2.1-rc.1 / 0.2.1-rc.2 / 0.2.1-rc.3 / 0.2.1-rc.5 |
| 其它宿主 | 允许应用，但 `selfcheck` 会标"未验证"；先看 `diagnose` |
| Node | ≥18（桌面版自带运行时即可） |

## 10. 这份文档的维护规则

- 每次发版必须同步：首部版本行、§9 表格、§3 命令表（如有新增）。
- `npm run check:docs` 会校验 `AGENTS.md` / `README.md` / `release-notes.md` / `package.json` 的版本一致，CI 里跑；不一致直接失败。
- 面向人的概览在 `README.md`；**面向 agent 的操作细节以本文件为准**——两者冲突时，先信本文件，再去改 README。

## 11. 更新偏好（1.6.5 起）

维护页分别设置自动检查和自动安装。默认只检查，间隔 6 小时；旧 `autoUpdateOnStart` 只作为自动安装偏好的兼容默认值。显式新偏好存于 `$DSH_HOME/dsh-purge/update-preferences.json`，状态存于 `update-status.json`。不要为启用更新打开 `autoApplyOnStart`，不要改动提示词或 profile 权限。

`GET /dsh-purge/community` 返回 `update_preferences` 和 `update_status`；`POST` 同一路径，`{op:"preferences",value:{autoCheck:true,autoInstall:false,intervalHours:6}}` 保存偏好。省略字段保留当前值，间隔接受 1–168 的整数。保存不代表安装；安装后等待用户手动重启，不自行调用重启接口。

Electron 的 app.asar 本体必须用 `diskFs()` 读取；不要把普通 Node 自检通过当作 Electron 运行时通过。`npm run test:electron` 在临时目录内运行真实 Electron 测试，不改动安装或用户设置。

## 12. 安装 / 更新失败：Agent 必读（1.6.13）

1. 读取 DSH 版本、实际 Desktop 可执行文件、`DSH_HOME`、目标 profile。不要猜测另一台设备的路径。首次安装要求 profile 已初始化；Windows 用 `scripts/install.ps1`，macOS 用 `scripts/install.sh`，细节见 [安装指南](docs/INSTALLATION.md)。Web/Headless 继续使用当前实例的 CLI 与发行包迁移，不能套 Desktop 自动发现。
2. 默认先 `--dry-run`（PowerShell `-DryRun`）确认来源与 SHA256，再按用户授权安装。更新/迁移前安装器自动快照；不要为了安装去改提示词、权限、更新偏好或其他插件。安装、宿主补丁应用与手动重启是三个独立动作。不要安装后自动 apply/restart。
3. `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` 不是一律“发布太新”。若同时明确报 `@dsh-ops/bash-win32-x64@<版本> ... version not present in registry manifest`，先比较当前公开镜像与 npm 官方元数据。本版安装器仅对这一公开包、明确的公开镜像执行一次 scoped registry 重试；官方 name/version/time/integrity/tarball 不完整则停止。其余依赖保持原源，不改变全局设置。
4. 市场 JSON 首次安装失败时插件尚未加载，插件运行时无法修复宿主安装器。先让用户选择 npm 官方源，或用独立安装入口。不要承诺“升级插件就能让旧宿主市场自动重试”；换 tgz 仍会触发宿主锁文件校验。
5. 真实的发布时间不足、integrity/trust 错误、私有源、未知错误：保持失败，保留日志与快照；不要设 minimumReleaseAge=0、trustLockfile，也不要删锁文件、全局清缓存、修改全局 npm 源或把所有错误都归为镜像问题。GitHub `UND_ERR_DESTROYED` 是独立的网络线索，不能承诺换 npm 源会解决。
6. 失败时查看返回的 backup_id，确认 package.json/锁文件/安装状态。需要恢复时走 `rollback <id>`，保留当前用户内容。不能把失败说成安装成功；不能自动重启。公开 issue 只附脱敏错误，不上传配置、凭证、提示词或完整备份。
7. 版本核对以 package.json / release-notes 为准。README.md 与 README.zh-CN.md 必须一致，维护文档不能再停在 1.2.0/1.3.0。安装器测试与完整 Windows DSH 界面/宿主补丁验收分开记录，不混为“全部 Windows 功能已验证”。

Linux CLI/Web 可用 `sh scripts/install.sh`，默认选择当前 PATH 的 `node` / `dsh` 与 `web` profile，显式指定实例可用 `DSH_NODE` / `PURGE_DSH_CLI` / `DSH_HOME` / `--profile=名称`。系统 npm 宿主只读时准备用户副本，插件迁移成功后才激活 `~/.local/bin/dsh`；失败保留原入口，完整但未激活的副本供重试复用。入口被用户并发修改时停止，不覆盖。不要自行重启、修改系统目录权限或代理。卸载仅清理本 home 内插件目录及链接本身，外部源码/共享包保留。验收边界见 [PR #42 维护说明](docs/maintenance-pr-42.md)。

## 13. Windows Electron 安装验收（1.6.13）

Windows Desktop 的 exe 是 GUI 子系统。PowerShell 的 `& exe ...` 可能在子进程结束前返回，不能用它后面的 `$LASTEXITCODE` 推断已完成。安装器必须等待明确的进程对象、检查其真实 ExitCode、收集 UTF-8 输出后再清理 bootstrap。回归必须同时覆盖普通 Node 控制台进程与真正 GUI 子系统进程；只用 node.exe 模拟 Desktop 不够。

`desktop` profile 由 Electron 应用初始化；普通 `--profile desktop --dump-config` 会报 managed exclusively，不能因此判断程序坏了，也不能手造“已接受协议/已登录”的记录。隔离实测明确设置 DSH_HOME 与独立 user-data-dir，不碰默认用户目录，不自动应用宿主补丁。界面/登录/完整补丁能力与安装、备份、回滚分别记录；遇到协议或登录确认交给用户决定。

PowerShell 5.1 读取 UTF-8 JSON/文档应使用 `Get-Content -Raw -Encoding UTF8`，不要把默认 ANSI 解码造成的中文乱码误判为安装包损坏。

## 14. Windows 换包与设置接口（1.6.13）

- issue #10 / PR #11：Windows 密封宿主的「应用」只写磁盘补丁并启动等待助手，**不定时退出 host、不杀 Electron、不自动重开**。提醒用户从系统托盘完整退出，确认换包完成后手动打开。不要把关闭窗口当成退出，也不要自行执行旧版重启脚本。
- `/dsh-purge/status` 的 `asar_handoff.phase`：`starting` 只是启动请求；`ready` / `waiting_for_quit` 才证明助手运行过；`complete` 才表示保留原归档并完成换包。`failed` / `expired` / `helper_stopped` 要读取 `resources/app.asar.purge-handoff.json` 及同名 `.log` 排查，不把 `.rename-pending` 当成功。状态与日志只包含换包诊断，不要上传用户配置。
- 归档备份为 `app.asar.purge-<token>.bak`，独立于 profile 快照；不覆盖已有备份。等待期间归档被官方更新替换会停止，必须重新应用新宿主。离线修复/恢复见维护文档。
- 助手启动异常时还要看 `.json.broker.log`、`.json.launch.log` 和 `.json.launch.log.error`。Windows Electron 的 detached PowerShell 可静默退出；不能改回直接 detached spawn，也不能把 broker 退出码 0 当作助手已就绪。设置 `PURGE_ELECTRON_EXEC` 后运行 `node --test test/windows-electron-handoff.test.mjs` 验证真实 Electron 的父进程退出后交接。
- issue #9：原生存在 `describe` / `replace` 的宿主不能注入 legacy `register`，否则特性探测型插件会读错存储。升级会逆向移除 #42 的精确旧模板，保留两处设置通知；未知改版停止并诊断，不能整份覆盖 settings 源码或迁移/清空用户 settings 文档。缺少现代 API 的老宿主保留原兼容接口。
- 应用前逐文件备份有任一错误，停止写入，不能声称可回滚。Windows 实测必须验证打开的备份描述符已关闭、应用/还原字节一致；普通 Node/Linux 通过不足以证明 Windows 文件句柄正常。

## 15. 解包后无法再次安装（1.6.13）

若 CLI 报 app/runtime 下的 pnpm.mjs 不存在，检查当前安装的 app/runtime 链接。Windows junction 必须使用同 resources 目录下 runtime 的绝对目标，不能传相对的 `..\\runtime`。新安装器会保留旧错误链接后修复；现有真实目录或其他有效运行时冲突时停止，不删除目录内容。旧更新器尚未加载修复代码时，使用独立 Windows 安装入口安装 1.6.13，不要反复点更新、删锁文件或全局重装 pnpm。

验收顺序必须覆盖：密封宿主安装 → 应用补丁 → 完整退出换包 → 打开解包宿主 → 再次真实安装/升级 → 备份/回滚/重新升级。只在归档还在时测试升级，不能证明换包之后的 CLI 路径仍正确。对比当前提示词与 profile 配置，不能用旧快照覆盖用户后续修改。


## 16. 命令冲突与自检证据（1.6.13）

同名命令由原插件保留。Purge 备用命令依次为 `/purge-community`、`/purge-rules`、`/purge-skills`、`/purge-rewind`；`status.commands` 可查看实际注册名称。备用名称也占用时只跳过该命令并报警，不覆盖他人命令，不影响其他命令、工具、提示词与 HTTP 接口。不要为恢复面板卸载用户的回退插件。

面板自检优先通过 `permissionPresets.defaultPreset` / `resolve()` 读取**未来会话的默认权限**；不代表每个已有会话的覆盖值。CLI 无法访问该服务时，仅将正确 permission 节点下完整的 YAML 字面量作为文件证据；不执行 `!!js`，不推测环境表达式、include 或未加载设置。文件证据与 runtime 来源分别标注。

未显式设置不等于未生效：当前有效但未固定为 `inferred`；看不到实际值为 `unknown`。只有确认的权限不匹配或补丁错误为 `broken`。JSON/text 均仅在 `broken` 时退出码 1，其余为 0；自动化还应检查 `state`，不能把 0 当成“已全部证明”。不要改权限、删配置或重装以消除黄色项。

路由跟随 Cordis 的 webServer 子作用域注册和回收，不加入进程级轮询或固定超时假装 ready。只读状态不依赖 connection/session 列表。生命周期回归必须覆盖服务晚到、撤销/替换、父插件重载、卸载后不复活，以及真正 Desktop CommandRuntime 重名时其余工具和提示词仍注册。

## 17. 独立安装器不能提前依赖 runtime 包（1.6.13）

引导器解压 tgz 后直接执行 bin/community.js migrate，此时尚无 node_modules。CLI 顶层必须仅依赖随包模块和 Node 内建；自检等运行时依赖应在相应命令分支按需导入。1.6.11 将 yaml 经 selfcheck 提前引入，真实公开 Windows 入口失败，已转为预发布。不要在 bootstrap 阶段增加不受宿主控制的 npm install 来掩盖这一问题。

发布验收必须先对无依赖的真实解压包运行引导 CLI，再安装依赖验证插件入口。还要用候选 tgz 和实际 Desktop CLI 执行完整 bootstrapInstall，不得只用 mock bin/community.js 或先安装依赖的 smoke 代替。供应链校验、备份和不自动重启策略保持不变。

## 18. 旧自定义预设加载失败（1.6.13）

DSH 0.2.1 的 `tool-subagent` 不再接受 `toolFilter`。不能只删除它：旧 deny 清单是子任务的工具策略，删除会改变行为。`presets-plugin` 通过 `preset-compat.js` 先生成私有 SHA256 备份，再将该策略转换为原生子预设和父工具的 `agentPreset` 引用。父会话仍有全部工具，子会话只排除原清单中的工具；`maxDepth`、人设、其他配置和 `!!js` 表达式保留。

转换发生在注册时，用户的 `agent.cordis.yml` / `preset.yml` 原始字节不改写，后续用户修改仍会在重新加载时生效。备份在 `$DSH_HOME/dsh-purge-community/preset-migrations/<id>-<hash>/`，包含原文件和校验清单，不上传公开仓库。设置页会多一个「无限制模式 · 子任务」辅助预设；主会话仍选「无限制模式」。

当前自动迁移仅处理能逐项对应到原生工具行的单个 spawn deny 策略；未知工具、allow 策略、多个策略或已有独立子预设冲突时停止并诊断，不能静默放宽。注册 disposer 不代表成功，必须检查真实 registry.resolve 的 broken 字段。

普通测试之外，用实际 Desktop Electron 运行 `test/desktop-presets.mjs`（`ELECTRON_RUN_AS_NODE=1`，`PURGE_TEST_HOST` 指向宿主的 `node_modules/@deepseek-ai`）。它在隔离目录复现旧错误、加载迁移后的父/子预设、创建空白 Agent 并核对真实工具可见性，不调用 LLM，不重启用户应用。可用 `PURGE_TEST_PRESET` 指定本机旧文件目录做私有验收，不能把该目录内容或用户提示词加入测试夹具。

回滚代码会恢复旧版注册行为，原始用户文件本来就未改写；它也会恢复旧版在新宿主上的加载问题。不可为了回滚覆盖用户之后修改的提示词或设置。备份损坏或不可写时停止迁移，不绕开备份。


## 19. CLI 执行权限与运行入口证据（1.6.14）

issue #20：重写已有文件必须保留普通 rwx 权限；0600 私有配置不能变成0644，0755 启动器不能丢执行位。原子写入与复制共用 `lib/atomic-files.js`，临时文件名唯一，写入、权限恢复或重命名失败时清理临时文件并抛错。CLI 修复必须先完成备份；已存在备份不覆盖。仅对已识别的官方 shell 启动器修复旧版丢失的执行位，按现有读取权限增加对应执行权限，不扩大读取/写入权限，不改任意用户脚本。

issue #19：`purge-community host-status` 输出 `disk.archive_exists` / `disk.unpacked_exists` 与 `process.entry_layout` / `source` / `matches_target`。它只读目标安装；不会扫描其他设备、换包、退出或重启。state 为 `unknown_runtime` / `different_instance` / `unreadable` 时不得写成“已加载”或“未加载”。`archive_entry` / `unpacked_entry` 也只证明启动入口，不能证明随后改动的每个模块都重载。命令退出0仅代表报告生成成功，调用方必须读取state。完整命令行、环境变量、令牌不进入报告。

在独立 CLI 调用时，没有宿主服务启动参数通常显示 unknown_runtime，这属于预期；可先明确 DSH_BASE 或 PURGE_DSH_CLI 选择目标安装，再对照正在运行服务的状态接口 `host_layout`。不要拿 CLI 自己的 PID 当成桌面服务 PID。

1.6.18 起根因已定位并修复：`sealedAsarHandoff()` 先看 surface，Web GUI 触发应用时返回 null，导致走普通重启、归档不动。现在 `sealedDesktopHandoffAnySurface()` + `runningDesktopPid()` 让跨 surface 也能等桌面退出后换包；桌面没运行则返回 `needsDesktopApply`，不假装成功。决策由 `planApplyRestartAction()` 覆盖（sealed / cross-surface / manual / plain）。#19 以「1.6.18 修复」关闭，报告者复测后如有残留可重开。

## 20. 交互语义：等待回答与插话（1.6.25 / 1.6.26）

**等待回答（#89，1.6.25 起）**：`ask_user_question` 不再被硬压成 1 秒。现在只把 `-1`（无限等）收成 300 秒，模型传多少就等多少，不传则按原版默认 120 秒。旧安装里若还留着 `const timeout = 1; // [dsh-purge] ask_user_question never blocks a turn`，补丁带 `forbid` 标记，会判为未应用并在下次「应用」时**精确替换**；匹配不到保持原样并报 `pattern_not_found`。

**插话（#90，1.6.27 起）**：恢复 DSH 原生消息投递，迁移原版 1.1.69/1.1.71 与 fork 旧 #85/#86/#90。直接发送按 mode 区分 steer/queue；队列插话只转换仍在 next-turn 且正在运行的消息。已经在 next-step 的消息不移回下一轮；空闲时不重排队列；已经被消费的消息不重建。保留原生错误码，前端按既有协议对重复/过期请求收敛。

1.6.26 的降级为 followup 会误撤回成功插话并打乱顺序，本版撤销该兜底。旧版迁移同时覆盖 controller 与 agent-loop，不只检查单个标记。未知改写保持原文件，报告 pattern_not_found；不要删用户参数或强写宿主来消除报错。

安装、应用和加载是三个不同阶段。安装不自动应用或重启；应用会备份并写磁盘，当前进程不热重载这些模块。用户方便时手动退出并重开后再确认真实界面。排查 #25 请提供 DSH/插件版本、系统、直接发送还是队列插话、单次还是重复点击、当前是否正在生成；不要索取整份配置、提示词、令牌或会话日志。

验证：`npm test` 包含真实方法运行、延迟投影重复请求、消息消费、队列顺序与旧版迁移测试。可设置 `PURGE_TEST_HOST` 指向本机只读 `@deepseek-ai` 目录，运行 `node --test test/steering-runtime.test.mjs` 对实际安装方法验收。该测试使用内存服务，不等于完整桌面或真实模型验收。详见 [插话维护说明](docs/steer-notes.md)。

## 21. 多 profile 更新与源码 ZIP 校验

维护更新时以每个 profile 的实际包版本为准，不能把 `applied: true` 当成全部成功：需同时检查 `ok`、`hasUpdate`、`targets` 和错误。部分安装仍可能需要用户手动重启，但重启不能替代失败目标的重试。不要因此修改用户的更新开关、版本 pin、提示词或权限。

上游 ZIP 固定完整 commit SHA，并对全部文件校验 Git blob 摘要；GitHub API 不可用／清单不完整则停止，不能跳过校验。正式 TGZ 的 SHA256SUMS 校验保持不变。诊断返回 unknown 时保留未知状态，不能称为全绿，也不要自动重装。

审查与测试边界见 [更新维护说明](docs/maintenance-issues-27-30.md)。普通任务能力反馈需独立复现，不能用安装器测试通过代替模型质量对照。

## 22. 面板回滚与更新网络（1.6.29）

#34：回滚必须走 `.tgz` 安装，禁止对快照裸目录执行 add；后者会产生缺依赖的 link。安装命令退出 0 不足以成功，需在新进程检查依赖和插件入口。失败时恢复本次操作前的依赖图和清单，保留当前用户设置；发生并发修改则停止覆盖并提供恢复目录。不要拿旧更新器的目录回滚测试代替面板 Maintenance.rollback 的真实 CLI 测试。

#35：插件内所有更新请求共用 update-http。Token 从宿主的 GITHUB_TOKEN / GH_TOKEN 读取，仅发往 api.github.com，跨域不转发；代理优先 PURGE_HTTPS_PROXY，再 HTTPS_PROXY/HTTP_PROXY（支持小写），否则只读 Windows 静态系统代理；尊重 NO_PROXY。不改全局代理、不关证书校验、不改 Claude/SSH 网络。PAC/SOCKS 不支持时应明确提示；没有 token 仍可匿名，不要强迫用户提供密钥。不要把 token 或代理凭证写进公开 issue。

错误区分额度耗尽、认证、资源不可用和网络超时；缓存/Atom 降级必须展示原因。环境设置需要由启动 DSH 的进程继承；不要为更新环境而擅自重启。独立 bootstrap 自包含下载器不属于插件内这层，不能声称所有入口都已继承。详见 [维护说明](docs/maintenance-issues-34-35.md)。

## 23. 嵌套布局自检（PR #33）

安装根与组件根分开：`currentHost()` 保留实例定位语义，自检使用 `normalizeHostBase()` 检查固定嵌套布局。不要把全局 `findAiBase()` 当维护自检的兜底；裸 CLI 缺少目标信息时报告未知，要求指定 `DSH_BASE` / `PURGE_DSH_CLI`。错误路径不能静默换到另一份安装。

自检按原始条目计数，面板可合并显示组，数字不必强行一致。`missing_file` 不一律等于不适用；必需文件缺失保留分母并告警。`skipped` 只有明确的撤销迁移无需执行时才排除；未知和失败不能算成功。不得改用户权限或禁用功能来消除红黄项。测试需同时覆盖自检和同一实例的真实安装/回滚入口，详见 [维护说明](docs/maintenance-pr-33.md)。

## 24. 默认预设诊断（1.6.31 / #38）

#76 的 skipped 不能直接解释为失败或已完成。selfcheck 对当前 home 的预设做只读 YAML 检查；确认字面正文无需处理时标为 not_needed，并从必需分母排除。动态、损坏、重复或不可读配置保留 unknown；残留内容不匹配保持 broken。不执行 !!js，不读其他 profile 来代替当前文件，不改权限或反复应用来消除未知。补丁本体和用户文件不变。详见 [维护说明](docs/maintenance-issue-38.md)。

## 25. 桌面归档诊断目标（1.6.32 / #40）

status/selfcheck/diagnose 使用 `diagnosticHost` 统一检查当前安装的物理目录；`currentHost` 保留安装/启动定位语义。归档内启动路径仅映射到同一 Resources 下的 app 或 app.asar.unpacked，不能扫描别的安装来凑出绿色。部分或不可读的目标不能跳过，归档仍存在和权限差异继续提示。磁盘已应用不代表运行进程已加载；不因此自动重启、删归档或修改权限。复现和实际 HTTP handler 验收见 `npm run test:electron` 与 [维护说明](docs/maintenance-issue-40.md)。


## macOS #40：手动退出换包（1.6.35 起）

- 「应用」写入磁盘后，确认 `host-status.handoff.phase` / 面板 `asar_handoff.phase`。`waiting_for_quit` 仅代表助手已就绪，不代表宿主已加载；请用户使用 ⌘Q 完整退出，确认 `complete` 后再由用户手动打开。不得自动退出或重开。
- `not_scheduled` 是未安排，不是等待；`failed/expired/helper_stopped/unreadable` 必须展开 detail 排查；`archive_reappeared` 表示旧完成记录不能证明新归档，`backup_missing` 表示备份丢失。不得隐藏这些状态。
- 终端诊断先定位同一安装与 profile。示例：`PURGE_DSH_CLI='/实际安装/Contents/Resources/app/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js' purge-community host-status --profile desktop`；同样环境运行 `selfcheck --json`。不要照抄别人的路径；无实例证据就保持 unknown。仅为诊断 Desktop shell 不再需要额外伪造 DSH_SURFACE。
- #71 完全未安装家族才是 na；已安装缺失、YAML 损坏或读取未知须继续排查。CLI 权限 unknown 应到对应运行实例面板核实，不能自动改权限。
- 恢复步骤与收集字段见 [维护说明](docs/maintenance-issue-40.md)。不上传提示词、密钥、完整配置。

## 26. 拒绝检测 + 单次重试（1.6.34 起）

开关：`purge-community retry on|off`（默认 **off**，存在 `tuning.json` 的 `refusalRetry`）。

实现：插件在 `llm/stream` waterfall 上包一层，不改宿主、不改注入正文。

1. 缓冲输出开头最多 400 字符（或遇到工具调用/结束块）；
2. 命中拒绝特征 → 丢弃本次输出，在**系统提示尾部**追加加固语、**并在最后一条 user 消息尾部**再贴一句（系统提示动辄几万字符，紧邻用户那句的约束更有效），重跑一次；
3. 未命中 → 缓冲块原样吐出，之后流式透传，与未装钩子一致；
4. 每次重试写 `audit.jsonl` 的 `refusal_retry`（`kind` = `refusal` / `lecture`、命中的 `pattern`、长度与前 80 字符）。

**两组特征，别只加英文模板**：
- `REFUSAL_PATTERNS`：直说拒绝（`I can't` / `我不能` / `这一步我不做` / 要求出示授权）。
- `LECTURE_PATTERNS`：中文最常见的**劝退式软拒**——先说"这事我就不做了 / 最好别做"，接着讲危害、给"合规替代方案"、再反问"你属于哪一种"。2026-11-04 真实漏检就是这一类（`推荐具体接码平台这件事，我就不做了`），当时 11 条 pattern 一条都没命中。这组只在整段 ≤1500 字符时生效，长技术文档里出现"不建议用 root 跑"不会误触。

重试用尽后**必须把最后一次的内容交出去**（`attemptRun` 的 `allowRetry=false` 分支），不能因为"又拒了"就吐白卷。

只重试一次，避免死循环。排查拒绝率先看 `purge-community audit --limit 20` 有没有 `refusal_retry`，再决定是否调整 `tuning.injectPosition`。本层与 §20 的插话、§19 的换包互不影响。

> 改的是 `lib/refusal-retry.js` = 改插件运行时代码，**要完整退出重开 DSH 才加载**；只改 `tuning.json` 的开关是下一轮就生效。

## 1.6.38：慢网更新与审计属主

归档预算使用 `PURGE_DOWNLOAD_TIMEOUT_MS`（默认 180000，范围 30000–900000）；可选 `PURGE_GH_MIRROR` 仅传输社区 TGZ，官方摘要不可用就停止。容器 root home 需明确服务 UID/GID；不要扩大权限或改全局代理。完整步骤、变量及测试边界见 [维护说明](docs/maintenance-issues-44-47.md)。不自动重启。

## 1.6.39：独立安装器下载诊断（#52）

`fetch failed` 不等于发行包未上传。独立安装器按 metadata / archive / checksum 输出失败阶段、当前官方域名、transport、attempt 和底层错误码；不要索取完整环境变量、代理地址、令牌或带签名的重定向 URL。瞬时连接错误和 408/429/500/502/503/504 最多两次 fetch，再尝试一次系统 curl，每次从原始官方 URL 重新开始。证书、来源、大小、SHA256、401/403/404 等永久错误停止；不要用关闭证书校验或跳过摘要来“解决”。

备用 curl 沿用当前进程环境，禁用 curlrc，逐跳校验官方 HTTPS 域名（443），不使用镜像，不修改代理，也不保证修复所有网络问题。Windows 使用 System32/curl.exe，macOS/Linux 使用 /usr/bin/curl；缺失会明确报错。它不继承插件内 update-http 的系统代理读取逻辑。归档总预算默认 180 秒，可用 PURGE_DOWNLOAD_TIMEOUT_MS 在 30000–900000 范围设置；版本信息与校验清单各 60 秒。仅下载恢复不代表安装完成，必须继续通过 SHA256、包身份及迁移验证。

先让用户重新下载 install.sh/install.ps1，再执行 dry-run。仍失败时只收集系统/DSH 版本及脱敏的 `[download]` / `Release download failed` 行，区分 API、归档/CDN和校验清单，不擅自修改网络。安装前失败无须回滚，也不应动现有 profile。详见 [#52 维护说明](docs/maintenance-issue-52.md)。

## 按预设排除提示词（1.6.40，#53）

用户要求角色扮演、minimal 等预设不受 Purge 提示词影响时，先读当前 profile 的配置并备份，只在已有 `id: dsh-purge` 条目的 `config` 中加入 `excludePresets: [roleplay, minimal]`；不要用示例覆盖整份配置。默认 `[]` 保持旧行为。匹配实际预设 ID（忽略大小写、首尾空格），不是显示名称或子串。

主提示、头尾段、能力说明、boost、probe、postPrompt、宿主兜底使用同一判定。被排除的装配保留其现有人设、工作区规则和工具；只清理 Purge 的段落及有来源记录的改写，不猜测删除用户文本。子 Agent 按自己的实际预设判断；缺少预设信息时，在非空排除列表下暂停注入，避免旧宿主无参兜底泄漏。可选 refusalRetry 在无法识别请求会话时也不追加提示。

升级包不会自动改用户配置、应用补丁或重启。若要让旧宿主兜底识别会话，需要用户安排时间应用新版补丁并手动退出重开；无参旧调用在启用排除后会返回空。测试 standard → minimal → standard，并行 standard/roleplay，以及子 Agent；观察 `assemble.excluded` 的 preset/excluded/unknown。不要把“排除注入”称为“恢复原生权限”：全局补丁、已有部署配置和历史聊天均不会被撤销或删除。详情见 [维护说明](docs/maintenance-issue-53.md)。

## 1.6.41：更新状态核对

运行版本与当前 profile 磁盘版本分开核对；旧 pendingVersion 不代表当前安装。未知版本或读取失败继续告警，安装失败不会被成功检查掩盖。旧版已卡住时先手动安装新版，由用户手动退出重开一次；不要删除设置、改更新开关或自动重启。详见 [状态迁移与测试说明](docs/maintenance-update-state.md)。

## 1.6.42：设置与流诊断

`tuning_setting` 记录实际保存后的已知设置变化，旧事件历史保留。未知字段保留在配置中但不写入日志；重复保存不新增变更事件。不要以审计条目数推断功能是否启用。

`refusal_retry_outcome` 的 text / tool_call / reasoning_only / empty 只表示传输形态，error / cancelled 表示失败或取消，不能据此宣称任务成功或内容质量。retry 设置在下一次请求读取；rewind 的前端可见性仍需重载。不要自动重启用户的 DSH。详情见 [维护说明](docs/maintenance-pr-58-61.md)。

## 27. 注入位置与强化段排序（1.6.43）

- 宿主 section 的 order 区间是 `-1000…10200`（persona-prefix 0、工具 1000–3100、DELIVERABLE 9000、STRUCTURED_OUTPUT 9900、WEB_SURFACE 10100、persona-suffix 10200）。低于 0 的 order 排在 persona 之前，**不能用 `GLOBAL_PROMPT_ORDER + n` 表示"尾部"**。
- 本版：boost `9500`，tail 注入 `10150`。`inject tail|both` 才有意义；`head` 仍是 `GLOBAL_PROMPT_ORDER`。
- A/B：启动 DSH 前设 `PURGE_BOOST_ORDER=-50000` 可回到旧位置；不设则用 9500。
- 切换段位：`purge-community inject head|tail|both`（写 tuning + 记 `tuning_setting`，下一轮生效，不需要重启）。
- 改排序属于"行为变更"：发布前应做真机 A/B（同一组易拒请求，比较 `refusal_retry` 次数与回答形态），不能只靠单测的 order 数字。

## 1.6.44：市场安装与旧包迁移

市场重复安装拦截发生在插件加载前，不能靠修改插件运行时代码解决。旧版用户使用本仓库独立安装器迁移，不先卸载；保留数据目录、权限、更新偏好及提示词。安装后检查实际包入口、启用 bundle 和配置合成；失败恢复依赖树、清单与锁文件，不能把 CLI 退出 0 当作全部成功。已知旧包 `name` 引用精确迁移；未知 ID、手动 insert 或动态入口停止并报告，不删参数。回滚反向迁移已记录的包引用，保留后续配置值。说明和实际验收命令见 [市场迁移指南](docs/MARKET-MIGRATION.md)。第三方索引/市场 PR 待其发布，不自动重启。

## 1.6.45：应用失败诊断（#64）

不要把所有 `complete: false` 都归为 CMD 故障。按 `failed`、`host_written`、`hook_restore_failed`、`cli_repair` 与 `cmd_flash` 的明确结果逐项诊断；旧后端缺少字段时保留未知错误，不假定成功或提示词已写入。收集客户端发行名称、客户端和底层 DSH 版本、操作系统及脱敏错误，不索取完整配置或提示词。#63 的第三方宿主兼容性尚未确认，不能套用官方宿主结论。见 [维护说明](docs/maintenance-issues-63-64.md)。

## 1.6.46：链接目标保护（#67）

Windows Electron 的递归删除可能进入 Junction。清理使用 `removeTreeNoFollowSync` / `removeTreeNoFollow`，不要回退到原生 recursive rm。旧运行进程仍会执行旧清理代码，因此受影响 Windows 版本应通过新版独立安装器升级；不要先触发旧面板更新或回滚。保留当前设置、外部依赖与可用备份；清理警告不代表安装验证失败，不能用部分删除的 checkpoint 回滚。已丢文件单独从可信来源或适当备份恢复，不假设 Purge 备份覆盖所有第三方数据。详情见 [#67 维护说明](docs/maintenance-issue-67.md)。

## 桌面壳入口诊断（1.6.47，#68）

`diagnose` 的 `desktop_entry` 与自检、应用使用相同解析器。优先所选物理 app 目录的 package.json/main；仅在无声明时使用唯一已知布局。`missing_entry`、`invalid_manifest`、`invalid_main`、`outside_app`、`not_file`、`unreadable_entry`、`ambiguous_entry` 都不能当作补丁已生效。不要删 main 字段、伪造 marker 或复制旧入口消除红点；核对安装文件与宿主版本，保留配置和原文件。已定位但锚点不匹配仍按原有漂移诊断处理。磁盘状态不证明当前进程已加载，不能自行重启用户 DSH。

## 1.7.0：随包知识库（101 个技能，MIT）

- 载荷是 `skills/hackskills/<id>/SKILL.md`（目录束，一个技能一个目录）；`installHackskillLibrary()` 按内容比对同步到 `$DSH_HOME/redteam/hackskills`，预设里对应第三行 `- !!js dshHomePath('redteam/hackskills')`。
- 三库不能混：`skillLibraryOf()` 的判定顺序是 `redteam` → `hackskills` → 官方 `/skills`。顺序反了会把 `.../skills/hackskills/x` 标成官方技能。
- 知识库是文档型：`availability` 恒 `listed`，不拿红队工具路径判定。也**不要**把 `skills/hackskills` 拷进 `$DSH_HOME/skills`——官方目录本包只读不写。
- 老预设自愈只加一行（返回值 `repaired: 'hackskills-dir'`），`REDTEAM_PRESET_REFRESH=1` 才会整份覆盖现有预设。
- 成本：目录摘要约 28 KB/会话，正文按需。禁用方式是从预设删掉那一行（下次自愈会加回来）或整份不加载红队预设；删包内目录没用，会被重新同步。
- 校验：`node --test test/hackskills.test.mjs`。来源、统计与每条本地改动见 `skills/hackskills/SOURCE.json`，说明见 [知识库说明](docs/HACKSKILLS.md)。

## 1.7.3：换包终态与测试隔离

- 换包成功的终态是 `app.asar` **不存在**（已被改名成 `app.asar.purge-<token>.bak`）、宿主从 `resources/app/` 启动。`status` / `host-status` 里看不到归档，不等于失败；判定走 `unpackedFinalLayout()` 的三条磁盘证据，只读同一个 `<resources>`。搞不清时跑 `host-status` 看 `handoff.phase`，别去删 `.bak` 或重建 `app.asar`。
- 宿主主包清单只有一份（`lib/instance.js` 的 `HOST_PACKAGES`）。要加新的宿主包信号，改那一处，别在 `desktop.js` 里另起一份。
- `npm test` 已用 `--import ./test/env-isolate.mjs` 清掉 `PURGE_UPDATE_REPO` / `PURGE_UPDATE_PROVIDER` / `PURGE_GH_MIRROR`。也就是说：本机把更新源指向 Gitee 不再让「默认发行源」断言变红；反过来，要测镜像源行为必须在用例里显式设变量，不能指望继承环境。
- `client.js` 由 `.gitattributes` 钉成 `-text`。改完面板源码要跑 `npm run check:client`（按字节比 LF），不要手工改行尾去"修"它。
- 本版没有新增宿主补丁，也没有改锚点；升级后仍要手动「应用」+ 完整退出重开。

## 1.7.4：桌面解包后不自动重启

- 桌面宿主已解包时点「应用」**只写盘，不再 requestRestart**；面板/命令会提示「从系统托盘完全退出，再打开一次」。照做即可，别连点对话框上的 `Restart`。
- 原因：桌面宿主在 boot 途中被 shutdown 时，`installDesktopUpdateTaskControl(ctx)` 会拿到已 dispose 的 `ctx`，抛 `CordisError: cannot create effect on inactive context`（`INACTIVE_EFFECT`），表现为「The application could not start or stopped unexpectedly」。这类框不代表补丁写坏——`selfcheck` 通常仍是全绿（本机实测 69/69）。
- **密封桌面**（`app.asar` 还在）仍走换包：`waiting_for_quit` 只是助手就绪，必须用户完整退出，`complete` 才算换完。
- 判定集中在 `lib/settle-policy.js` 的 `applyShouldRestart()`：`sealed` 优先，其次 `surface === "desktop"`，最后才是 `complete / promptReady / appliedCount`。要改这段行为就改那里，别在调用方再写一套。
- Web / headless / 未知 surface 维持旧规则；`test/apply-restart-policy.test.mjs` 钉住这四种组合。
- 崩溃日志：`%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*-host.log`。遇到它先看 `phase` 与栈，别先归因到补丁。

## 1.7.5：宿主 boot 期被 shutdown 时静默退出（#91）

- 新补丁 `DESKTOP_HOST_BOOT_INACTIVE_QUIET` 写宿主本体 `dsh-desktop-host/lib/index.js`：`main()` 里 `installDesktopUpdateTaskControl(ctx)` / `installDesktopQuitInspection(ctx)` 两行包进 try/catch。
- 接管条件很窄：`stopping !== void 0`（确实在退出流程）**且** `error.code === "INACTIVE_EFFECT"`。命中时回 `shutdown-complete` → `process.disconnect()` → `process.exit(0)`；shell 侧 #83 把 `code=0` 当正常退出，不再弹「无法启动」。
- 其他错误照旧 `throw`。**不要**把条件放宽成「任何 boot 异常都静默」——那会把真故障变成黑窗。
- 非 shutdown 场景的 `INACTIVE_EFFECT` 仍会走 fatal：那种情况宿主没有可服务的 ctx，静默退出会让 shell 一直等 ready。
- 新增目标键 `desktop-host`（`targetFiles()`），补丁带 `optional: true` + `surfaces: ["desktop"]`；`selfcheck`「桌面宿主启动兜底」层现在是 `[82, 83, 84, 91]`。
- 这是本插件第一条宿主本体补丁：宿主升级后若 `diagnose` 报 #91 漂移，走 `reanchor`，不要手改 `dsh-desktop-host`。
- 验证：真实宿主副本应用后 `node --check` 通过、二次应用 `changed=false`；`test/patch-anchors.test.mjs` 有对应回归。

## 1.7.6：实验性 Inspector 状态帧不再崩宿主（#92）

- 新补丁 `INSPECTOR_STATE_FRAME_HEADROOM` 只动 `dsh-experimental-inspector/lib/index.js` 两处：快照预算 `maxSourceFrameBytes - 4096` → `- 8192`；`DEFAULT_MAX_SOURCE_FRAME_BYTES` `128 * 1024` → `1024 * 1024`。
- 上游算术：`publishCordisTree` 把 Cordis 树裁到 `maxSourceFrameBytes - 4096`（126 976 B），而 `InspectorSourceBuffer.stateFits()` 量的是 `json({monotonicMs,topic,payload}) + 4096 <= maxSourceFrameBytes`（131 072 B）。record 比 payload 多约 50 B，快照落在最后 ~50 字节窗口就抛 `inspector: source state exceeds the source-frame byte limit`；异常发生在状态通知的微任务里没人接 → 宿主 exit 1 → shell 弹「无法启动或已意外停止」。
- 触发条件：插件树压到裁剪上限（bundle 与会话越多越容易）；新建会话级 fiber 会重发一次树，所以表现是「重启能进、发消息随机崩」。
- 新增目标键 `inspector`（`targetFiles()`），补丁 `optional: true`：没装实验性 Inspector 的 profile 报「不适用」，不参与失败判定；`selfcheck` 新增「Inspector 状态帧不崩宿主」层（`[92]`），层数 25 → 26。
- profile 侧等价做法：在 `cordis.patch.yml` 给 `experimental-inspector` 加 `config.maxSourceFrameBytes: 1048576`。该层 `config` 是**整段替换**不是深合并，`captureFetch` 要一起写。
- 宿主升级后若 `diagnose` 报 #92 漂移，走 `reanchor`，不要手改 `dsh-experimental-inspector`。
- 验证：真实宿主副本应用后 `pending → applied → already`、`node --check` 通过、`resolveInspectorOptions().maxSourceFrameBytes === 1048576`；`test/patch-anchors.test.mjs` 三条回归（含「旧预算必然溢出 / 新预算装得下」的算术断言）。

## 1.7.7：适配 DSH Desktop 0.2.1-rc.5

- 宿主基线：rc.5（build `d4db512a`）把 `@deepseek-ai/*` 全部升到 0.2.1-rc.5。本版在 rc.5 原始 `app.asar` 上逐条核对 82 条补丁：**0 锚点漂移**；副本上真实「应用」两遍：可应用项全部落地、49 个 JS 目标 0 语法错误、二次应用全 `already`。
- #62 `OFFICIAL_TOOL_ASK_FAILOPEN`：rc.5 的入口 bundle `dsh-tools/lib/index.js` 把 `undefined` 写成 `void 0`、switch 深一层，还新增了 `exec.agent === void 0` 的 deny 分支。新增三条 bundle 变体（`approval === void 0`、`exec.agent === void 0`、更深缩进的 `case "unavailable"`）：只放行「没有审批通道」，`rejected` / `cancelled` 仍然 deny。`lib/types/index.js` 的旧锚点保留（老宿主照旧）。
- #26 `MINIMAL_PERSONA_PURGE`：rc.5 的 `minimal.patch.yml` 在 persona 与 persistent-shell 之间插入了 `tool-fs` 行。新增两条变体，把 `agent-instructions` 插到 persona 之后、`tool-fs` 之前，`complete: false` 与去身份照旧。
- #57 `DEEPSEEK_SYSTEM_ROLE`：rc.5 的 responses 通路变量名回到 `instructionRole`（`compat?.supportsDeveloperRole !== false`）。新增一条白名单变体，responses 路径也回退 `system`。
- `QUALIFIED_HOST_VERSIONS` 增加 `0.2.1-rc.5`；面板/CLI 不再把 rc.5 标「未验证」。rc.4 未实测，不加入。
- rc.5 不再随包发 `dsh-client-runtime` / `dsh-client-ui-slots`（`slots` 服务改由 `dsh-client-ui-renderer` 提供）；`package.json` 的 `dsh.client.inject` 为兼容老宿主仍保留旧名，client-modules 对不存在的依赖行会跳过。面板用到的 `slots` / `locale` / `sessions` / `conversation` / `uiWorkspace` 服务与 4 个 slot 名在 rc.5 均存在。
- rc.5 的 `@deepseek-ai` 包里找不到 `desktopRuntime` / `desktopActions` 服务，优雅重启会回退到 helper 路径；1.7.4 起桌面解包后本来只写盘不自动重启，影响低。
- 验证：`test/patch-anchors.test.mjs` 新增 #62（含 agent-less 分支与 rejected 不误放）、#26（tool-fs 结构）、#57（responses）三条 rc.5 回归；`npm test` 全绿。真实宿主仍要「应用」+ 完全退出重开才加载补丁，磁盘状态不代表进程已加载。

## 1.7.8：劝退式软拒的漏检

- 旧 `REFUSAL_PATTERNS` 只覆盖直球拒绝（`I can't` / `我不能` / `这一步我不做` / 要求出示授权）。中文更常见的是「这事我就不做了 + 讲危害 + 甩合规替代 + 反问属于哪一种」，一条都不命中，`refusalRetry` 开着也不留任何审计。新增 `LECTURE_PATTERNS`，只在整段 ≤1500 字符时判定，避免长文档里的「不建议用 root 跑」误触。
- 判定入口换成 `refusalSignal(text)` → `{kind: "refusal"|"lecture", pattern} | null`；`looksLikeRefusal()` 只是它的布尔包装。审计的 `refusal_retry` 现在带 `kind` 与命中正则源码，排查时先看这两列再决定加特征还是改人设。
- 重试加固变两道：系统提示尾部（`RETRY_NUDGE`）+ **最后一条 user 消息尾部**（`USER_NUDGE`）。系统提示在本机有 4 万多字符，尾部那句约束太远。`withNudge` 返回浅拷贝，不改写调用方的 `options`。
- `attemptRun(..., allowRetry, ...)`：重试用尽（`allowRetry=false`）时即使判定为拒绝也照常吐内容，不交白卷。`retries` 可配，默认 1。
- 单测注意：`test/refusal-retry.test.mjs` 会调真实 `logAudit()`，按 `DSH_HOME` 定位。跑测试前先 `DSH_HOME=$(mktemp -d)`，否则真实 `audit.jsonl` 会被测试数据污染（1.7.8 期间踩到过，已清理）。
- 分发注意：profile 用 git 依赖装插件时，运行时加载的是 `node_modules/dsh-purge-community` 那份副本，**改工作目录不影响运行时**。要么重新拉依赖，要么覆盖那份副本；两份文件的 hardlink 数可能是 2（pnpm store），就地写会连带改 store，要 `rm` + `cp` 断开再写。
- 判定窗口不能被思考流截断：`reasoning-delta` 只透传、不结束扫描（高推理模型先吐思考再吐正文，旧逻辑第一个 reasoning 分片到达时 buffer 还是空的，等于永久放行）。扫描终止条件只有 `bufferChars`、`finish`、`tool-call-delta`，外加 `SCAN_CHUNK_LIMIT = 2000` 兜底。

## 1.7.9：适配 DSH Desktop 0.2.2-rc.1

- 宿主基线：0.2.2-rc.1（nightly 通道，`deepseek-harness-0.2.2-rc.1-win-x64.exe`）把 `@deepseek-ai/*` 一并升到 0.2.2-rc.1，并要求 Node.js ≥ 24.9、Cordis Core 4.1.0 / Loader 1.1.0 / Include 1.1.0。本版在其原始 `app.asar` 上逐条核对 82 条：起手 9 条漂移（4 必需 + 5 可选），补变体后 **drifted 0 / optionalDrift 0 / missing 0**；副本上带 `DSH_SURFACE=desktop` 真打两遍：可应用项全部落地、40 个改动 `.js` 全部 `node --check` 通过、二次应用全 `already`。
- 上游把工具执行拆成按 Agent 作用域选择的插件（`dsh-tool-executor-ptc`），审批分支从 `dsh-tools/lib/index.js` 搬到 `lib/pipeline.js`，`deliverable` 提示词迁到新包 `dsh-deliverable-file-references`。因此 `targetFiles()` 新增 5 个目标键：`deliverable-file-references`、`tool-executor-ptc`、`tool-executor-ptc-types`、`dsh-tools-pipeline`、`dsh-tools-types-pipeline`。老宿主的旧键照旧保留。
- #14 `ESCALATION_GRANT_UNCONDITIONAL`：rc.1 的 `approval.approver.request({...})` 多了 `displayReason: escalationDisplayReason(mode, justification)`，并在前面新增 `approver === void 0` / `agent === void 0` 两个 throw（#13 的补丁会把它们换成 bypass 注释）。新变体在 request 前判 `approval.approver !== undefined && approval.agent !== undefined`，否则回 `"allowed-once"` —— 与老宿主「没有通道就放行」的语义一致。
- #40 `COMPLETE_PROMPT_KEEP_INJECT`：rc.1 的 `assemble` 返回多了 `tools`，早退路径也变成 `{ ...transformed, tools }`。新变体走常量 `COMPLETE_PROMPT_WATERFALL_INJECT_RC1`（保留 `tools`、`sections = [completeSection, ...dshPurgeSections]`）。**不要把 `tools` 丢掉**，否则工具面会整段消失。
- #67 `AGENT_LOOP_MESSAGES_GUARD`：rc.1 把守卫移进 try 块、缩进变 5 个 tab，新增 5-tab 变体；#74 `ASSEMBLE_BEFORE_PRESTEP`：rc.1 在 `claim()` 与 `assemble()` 之间插入 `const selection = this.model.current();`（本步模型在装配前固定），新变体把 `__dshPurgePrepareAssemble` 调用插在这两行之间，语义仍是「本步 pre-step 之前准备装配」。
- #54 / #60 / #62 换目标文件 + 补变体：`#54` 现在锚 `dsh-deliverable-file-references/lib/index.js`（旧 `dsh-client-ui-deliverables` 已不含这两句）；`#60` 覆盖 `dsh-tools` + `dsh-tools-ptc` + `tool-executor-ptc`（+`-types`）四个执行入口；`#62` 覆盖 `dsh-tools`（`void 0` 写法）、`dsh-tools/lib/types`、`lib/pipeline.js`（3 tab）、`lib/types/pipeline.js`（12 空格），并新增 `exec.agent === void 0` 的 4 空格变体：只放行「没有 Agent 可路由」，`rejected` / `cancelled` 仍然 deny。
- #82 `DESKTOP_SHELL_PROFILE_FALLBACK`：rc.1 的 `resources/app/lib/main.js` 第 19 行不再是 home-paths region，新变体只锚 import 行 + 换行，把 `DSH_PROFILE=desktop` 兜底插在其后。**别把它改成锚 region 注释**，那条注释已经跟着 mime 包重排了。
- #91 `DESKTOP_HOST_BOOT_INACTIVE_QUIET`：rc.1 在 `const { ctx } = await application;` 之后插了 `installOperationDiagnostics(...)`，旧多行锚点失效。新变体只锚两行 control 赋值（`control.updateTasks = ...` / `control.quitInspection = ...`），接管条件不变（`stopping !== void 0` 且 `error.code === "INACTIVE_EFFECT"`）。`let stopping;` 在同一函数作用域内，照样可引用。
- `QUALIFIED_HOST_VERSIONS` 增加 `0.2.2-rc.1`；面板/CLI 不再标「未验证」。rc.5 真机回归仍 `drifted 0 / applied 71 / na 10 / skipped 1(#80)`，老宿主没有被新变体挤掉。
- 回归：`test/patch-anchors.test.mjs` 新增十条 rc.1 夹具（逐字节取自真实源码）；`test/bypass-contract.test.mjs` 的 #14 / #67 指纹随之更新（语义未变，只是多一个变体）。
- 仍需「应用」+ 完整退出重开：补丁写盘不代表当前进程加载。rc.1 起 `npm test` 有 23 条与本插件无关的 Windows 环境失败（backup/install/rollback 的 tar 路径 + CONNECT tunnel），基线复跑同样失败，不要把它们算成本版回归。

## 1.7.10：面板版本改为运行时上报

- **症状**：装的是 1.7.9，面板徽标写「社区版 1.7.8」，还常驻一条「官方版本 1.7.9；界面 1.7.8。两者不一致…」的黄条。原因是徽标渲染构建期常量 `__PANEL_VERSION__`，1.7.9 发版漏跑 `npm run build:client`，`client.js` 里烙着的还是 1.7.8；那条黄条又拿后端版本和同一个常量比，于是必然不相等。
- **现在**：版本一律来自后端上报的运行时事实。`/dsh-purge/status` 与 `/dsh-purge/community` 新增 `panel_version`：`lib/update.js` 的 `panelBundleVersion()` 只读包内 `client.js` 头部 4 KB，匹配 `// panel-version: <ver>`（由 `packages/purge-panel/scripts/build.mjs` 写入）。配合已有的 `plugin_version`（`runningVersion()`，即实际安装版本）。
- **徽标**：`社区版 <plugin_version>`（状态条「插件」同源）；后端没响应时只显示「社区版」，**不回退到任何写死的版本号**。
- **不一致提示**：只在 `panel_version !== plugin_version`（界面 bundle 确实是旧构建）时出现，文案为「插件已装 X，界面代码却是 Y 构建的…」。独立面板（非社区版）仍以验证过的上游接口版本 `1.1.71` 为基线，那是兼容契约不是面板版本。
- **校验**：`packages/purge-panel/test/version-badge.test.mjs` 断言徽标跟随后端版本、drift 只在真不一致时触发、bundle 头部 marker 等于 `package.json` 版本、bundle 内不再出现「社区版 1.x.y」这类常量。
- **顺手修**：`packages/purge-panel/test/maintenance.test.cjs` 里按钮标签还停在重构前的「刷新备份列表」/「暂无备份」，与 `maintenance.js`（「刷新」/「还没有本机备份」）对不上，单测一直是红的；本版同步标签。
- 仍需「应用」+ 完整退出重开：板面代码是插件运行时模块，改完不重启不生效。

## 1.7.11：补丁计数统一到 id

- **症状**：面板 hero 写「55/67 条补丁已生效」，顶部条写「磁盘写入计数 64/76」。两个数都对，但分母不同：hero 数的是**展示行**（升级链合并：`#1–3`、`#5/#11/#12`、`#8–10`、`#45/#46`、`#83/#84`、`#87/#88` —— 6 组把 15 个 id 压成 6 行），顶部条数的是**补丁 id**。所以 76 条适用补丁只有 67 行、64 条已应用只有 55 行。顺带暴露另一个洞：12 条 skipped 在界面上完全没有出口（`metricNotes` 算了但从未渲染）。
- **口径**：新增 `packages/purge-panel/src/shared/patch-count.js`（不 import react，可被 node 直接测）。`patchIdRowsOf()` 以 `patch_status` 为权威逐 id 展开；`patchRowsOf()` 仍返回合并展示行（每行带 `ids`）；`patchCounters()` **优先用后端 `patches_*`**，缺失才自己数，`na` 缺失时按 `patch_status` 里 `"na"` 数量兜底。hero / 明细标题 / 每组表头 / 顶部条同源 → `64/76`，副标题「未生效 12 · 不适用 6 · 共 82 条」。
- **合并行保留**：`PatchGroups` 仍按升级链合并，行首 id 列用 `idRangeLabel()`（`#1–3`），但每组表头计数取 `tallyPatches(idGroups.get(key))`，即 id 口径。
- **接口**：`/dsh-purge/status` 的 `patches_pending/skipped/ready/na` 回到 id 口径（不再与 `display_*` 混用），另加 `display_patches_applied` / `display_patches_total`；文本版 status 报表同步为 `64/76 applied, 12 skipped, 6 n/a (82 total)`。
- **#17 锚点漂移**：rc.1 把 `dsh-fs-observation-policy` 的 `editIntent` 改成一行 `return this.requirePresent(target, actor, "edit")`，旧锚点（整段 `FsError` 函数体）匹配不到，`writeIntent` 又已带 marker → `applied=0, notFound=0` → `rollupPatchStatus` 落到 `skipped`。新变体只锚那行委托改成 `return void 0;`；`deleteIntent` 与 `requirePresent(...,"delete")` **保持不动**。
- **#40 写进去却认不出**：rc.1 分支写的是 `// [dsh-purge] complete prompt keeps inject`，而 `markers` 只收了 `… keeps inject + agent-instructions` 那条更长的，`patchApplied()` 于是判 false —— 补丁已落盘、面板仍算 skipped。补上短形式标记，实测应用后 74/76。
- **回归**：`packages/purge-panel/test/patch-count.test.mjs` 用 `ALL_PATCHES` 真实 id 复刻事故（**注意 id 不连续：`#85/#86` 已被 `#90` 取代移除**，用 `Array.from({length:82})` 会算出 69 行）；`test/patch-anchors.test.mjs` 加两条 #17 用例（rc.1 委托形态 + 旧宿主 inline 形态），并在 rc.1 的 #40 用例里断言「写入的标记必须出现在 markers 里」。
- **升级**：本机原为 1.7.7（`update-status.json` 与实包一致，`applied.json` 却残留 1.7.9），1.7.7 缺 rc.1 的 10 条变体（#14/#17/#40/#54/#60/#62/#67/#74/#82/#91）→ 必然 skipped。已部署 1.7.11 并应用：磁盘 74/76 生效，#76（用户自定义预设）与 #80（minimal 预设）仍 skipped，均为可选。加载仍需完整退出重开。

## 1.7.12：宿主删掉的插件行会把整份预设判死

- **症状**：`设置 → Agent 预设` 里「红队模式」挂着红色「加载失败」，「无限制模式」干脆不在列表里（不是排后面，是没有这一条）。
- **证据**：`$DSH_HOME/redteam/preset-declare.json` 写明 `{"ok":false,"phase":"registered-broken","broken":"tool-subagent-list-agents (@deepseek-ai/dsh-tool-subagent-control/list-agents): never started"}`。先别怀疑 YAML —— 三份 `agent.cordis.yml` 用 `yaml` 解析都是 0 错误，问题在注册期。
- **根因**：宿主 0.2.2-rc.1 把 `list_agents` 并进 `dsh-tool-subagent-control` 本体（`lib/index.js` 的 `registerListAgents()` 自己注册 `list_agents`），包的 exports 里不再有 `./list-agents`；`dsh-workflow-worker-thread` 也不再随宿主发布。旧预设仍留着
  `- id: tool-subagent-list-agents` / `name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'` / `disabled: false` 这一块，loader 起不动它，registry 就把**整份**预设记为 broken。
- **为什么两条预设表现不同**：`redteam` 由 `lib/redteam/index.js` 注册一次，broken 记录留在 registry → 界面显示「加载失败」；`unrestricted` 走 `registerPresetDefinitions()`，`resolve().broken` 直接抛错 → 释放已注册项并重试 40 次 → 最终从未注册 → 列表里没有它。
- **修法一层（数据）**：模板与用户副本删掉这两行 —— `presets/redteam|unrestricted/agent.cordis.yml` 与 `$DSH_HOME/.agent-presets/redteam|unrestricted/agent.cordis.yml`。删前留 `.bak-<ts>`；`unrestricted` 带 `# managed-by: dsh-purge` 会被下次安装同步，`redteam` 是用户自有文件，只能就地改。
- **修法二层（代码兜底）**：`lib/preset-compat.js` 新增 `dropPresetRow(rows, name)`（递归进 `group: true` 的 `config`，不改输入）与 `registerPresetDefinitions(registry, definitions, { onPruned, maxRowDrops = 12 })`：注册失败且错误消息匹配 `/(\S+) \((.+?)\): never started/` 时，只删该模块名的行并重试；匹配不到、或删不到任何行，**照旧抛出**。`presets-plugin.js` 与 `lib/redteam/index.js` 都接了这个回调：日志一条 warn，`preset-declare.json` 多一个 `pruned` 数组。宿主以后再删插件，预设不会整份陪葬。
- **不要做的事**：不要把 `broken` 一律当无害（会掩盖真的加载错误）；不要为了消除徽标把 `tool-subagent-list-agents` 改成 `disabled: true`（死行仍在，rc.1 里没有这个包，照样 never started）；不要改用户的 `preset.yml` 或整份覆盖 `redteam`。
- **回归**：`test/preset-compat.test.mjs` 新增三条 —— 剪枝重试（顶层 + group 内各一行，调用方定义不被修改，且只重试一次）、不相关的 broken 仍抛出且不触发剪枝、模板不再声明 `@deepseek-ai/dsh-tool-subagent-control/list-agents` 与 `@deepseek-ai/dsh-workflow-worker-thread` 且 `list_agents` 仍由 control 包提供。`node --test test/preset-compat.test.mjs` 7/7。
- **升级**：改的是插件运行时代码与预设文件，要覆盖 profile 的 `node_modules/dsh-purge-community` 并完整退出重开；只看面板刷新不够。
- **脚手架安全**：`test/desktop-presets.mjs` 的临时 profile 里有指向宿主 `@deepseek-ai` 的 junction。**Electron 的 Node 24 上 `fs.rmSync(home, { recursive: true })` 会跟着 junction 进目标目录，把真实安装的 331 个包清空**（2026-11-06 本机复现；Node 22 不跟）。回收必须走 `lib/remove-tree.js` 的 `removeTreeNoFollowSync()`。同理由：任何"临时目录里塞 junction 再整目录删"的写法都不行，先 `unlink` 链接再删父目录。`test/remove-tree.test.mjs` 已加静态断言防止回退。
- **发行源同版本切到自家仓**：默认 `DEFAULT_REPOSITORY = "n-sky/dsh-purge"` + `DEFAULT_PROVIDER = "gitee"`（`lib/update-source.js`），`lib/update-net.js` 的 `SOURCE_REPO` 从它派生。面板报 404 时先查残留的 `PURGE_UPDATE_REPO`，再怀疑代码。面板「发行记录」/欢迎语/`package.json` 元数据/`install.sh|ps1`/`bootstrap-install.mjs` 全部指向 Gitee 仓；`market/` 索引、`.github/workflows/*`、历史 `docs/releases/*`、NOTICE/CONTRIBUTORS 保留上游，别当漏改。校验与文案细节见 `docs/releases/1.7.12.md`。**Windows 上别写 `env -u VAR cmd`**，用 `$env:VAR=$null`。

## 1.7.13：面板按诊断台重做

- **范围**：只是界面。`lib/core.js` 的补丁表、锚点、接口、locale key、按钮行为都没动 —— 升级后**不需要重新「应用」补丁**，也不涉及换包。
- **样式只有一个文件**：`packages/purge-panel/src/styles/page.css`（约 1200 行，全部规则挂在 `.dshpp-page` 下）。`base.css` 仍服务右侧栏旧界面与设置页外壳，别把页面规则写回去，也别在页面里恢复卡片：`.dshpp-page .dshpp-card, .dshpp-page .dshpp-panel { border:0; padding:0; background:none }` 就是用来把这些类在页面内中和掉的。
- **颜色规矩**：绿（`--dshpp-gate`）只做状态，不做按钮填充。主按钮是墨色实心（`--dshpp-btn-ink` / `--dshpp-btn-ink-fg`），因为 `--dsw-alias-brand-primary` 在深色主题是「高亮文字」色，填成底会把白字吞掉。危险动作默认是 `quiet` 灰字（`Btn({kind:"danger", quiet:true})`），悬停才变 `--dshpp-bad`；实心红只准出现在卸载确认弹窗。
- **折叠只有一个长相**：`details.dshpp-expand` + `summary > <Caret/> + 文案 + span.dshpp-expand-meta`。`版本管理` / `补丁明细` / `高级选项` / `逐层自检` 都用它；新增折叠别另造第三种。
- **刻度尺（签名件）**：`Ticks({rows})` 渲染 82 个 `i.dshpp-tick.is-<kind>`，`.dshpp-ledger` 用 `flex:0 0 3px` + `gap:6px`。**别改回 `flex:1 1 0` 或 `justify-content:space-between`** —— 82 格摊在 1000px 上会落到亚像素位置，渲染成高低不齐的条形码。组标题里的小刻度是 `patch-status.js` 的 `.dshpp-group-ledger`。
- **`.dshpp-field` 有两种语义**：settings-form 里是「label + 控件的网格包装器」（`div.dshpp-field`），rules/skills 里是输入框自身的类（`input.dshpp-field`）。改其中一种先确认另一种没被带跑。`rules.js` 的输入框没有 `type` 属性，控件选择器必须是 `input:not([type="checkbox"]):not([type="radio"])`。
- **两份 bundle 都要重建**：根 `npm run build:client`（写仓库根 `client.js`，头部 `// panel-version:` 取 `packages/purge-panel/package.json` 的版本），以及面板包自己的 `node packages/purge-panel/scripts/build.mjs`（写 `packages/purge-panel/client.js`）。`packages/purge-panel` 的 `npm test` 先跑 `check:build`，只重建一份会报 `client.js is stale`。
- **预览脚手架**：`.agi/unslop/preview/`（`build.mjs` + `entry.jsx` + `index.html` + `mock-status.mjs`）把 `PurgePage` 挂到假宿主上，Chrome headless 截图即可，不需要真宿主、不需要 token。`?tab=提示词|规则|技能|演练台|更多`、`?open`（展开全部折叠）、`?dark`、窄屏用 `--window-size=720,1000`。`.agi/` 已进 `.gitignore`，不要提交。
- **验证**：`packages/purge-panel` `npm test` 27/27、根 `npm run test:ui`、`node --test test/ui-overlay-styles.test.mjs`、`npm run check:client`、`npm run check:docs`。面板是运行时模块，改完要刷新；仍是旧界面就完整退出重开。

## 1.7.14：本机备份可以单份删除

- **入口**：存储层 `Maintenance.remove(id)`；HTTP `POST /dsh-purge/community` body `{"op":"delete","id":"<备份ID>"}`；CLI `purge-community delete <备份ID>`；面板「本机备份」操作行的 `删除备份`。四条入口到最后都是同一段方法，别在任一层另写删除逻辑。
- **不变量（改之前先读一遍）**：
  - 只删 `<DSH_HOME>/dsh-purge-community/backups/<id>` 这一份目录；`id` 先过 `validId()`（`/^[0-9TZa-f-]{15,80}$/`），拼路径只用 `path.join(this.backups, target)`。
  - 走 `this.locked(...)`，与 `backup()` / `rollback()` 共用 `maintenance.lock`。已有维护在进行时拒绝，报 `已有维护操作或遗留锁…`。
  - 先 `lstat`：不存在 → `备份不存在：<id>`；不是目录或是链接 → `备份路径无效，未删除`。再 `realpathSync(folder) !== folder` → `备份路径不能为符号链接`（与 `verify()` 同一口径）。
  - 删除只用 `removeTreeNoFollowSync(folder)`。**不要**换成 `fs.rmSync(folder, { recursive: true })` —— Windows junction 会被跟穿（1.6.46 / #67）。
  - 删完调 `gcObjects()`，返回 `{ok, removed_id, freed, gc, remaining, usage}`；`freed` 取删除前的 `treeBytes()`。
  - 不动已安装插件、当前提示词、规则集与 profile 配置：删的是磁盘占用，不是「撤销」。
- **未完成残留只能靠这条清**：没有 `manifest.json` 的快照不进 `list()`，面板看不见、`rollback` 不认、`prune()` 也数不到。只要目录名能过 `validId()`，`delete <id>` 就能清掉它 —— 所以不要给它加「必须有 manifest」的前置条件。
- **面板**：`删除备份` 的 `disabled` 是 `busy || !selected || listState !== "ready"`；确认文案写明「不影响已安装插件、当前提示词与规则」；完成后靠既有的 `finally { load() }` 刷新列表、靠既有的 `setSelected` 清空选中，别另写一套。占用读数 `共 N 份 · 占用 X` 只在 `listState === "ready"` 且有 `backup_usage` 时显示。
- **验证**：`node --test --import ./test/env-isolate.mjs test/community.test.mjs`（新增五条存储层用例）、`packages/purge-panel` `npm test`（新增「删除要确认」「取消确认不发写请求」）、`npm run check:client`、`npm run check:docs`。
- **本机基线噪声**：仓库根 `package.json` 的 `repository.url` 已是 Gitee，而 `test/community.test.mjs` 的夹具仍声明旧 GitHub 地址，`validateArchive()` 因此判「安装包身份与发行版本不一致」，6 条安装类用例在**未改动本版代码时**同样失败。修法是同步夹具的 `repository.url`，但那是独立议题，本版没动。
- 没有新增宿主补丁、没有改锚点；升级后照旧只需手动「应用」+ 完整退出重开一次（备份功能本身不依赖宿主补丁）。

## 1.7.15：运行副本版本诊断

- **两件事**：换副本只改磁盘，加载代码只发生在启动时。`localVersion()` 每次读 `PLUGIN_ROOT/package.json`（磁盘事实）；`runningVersion()` 返回模块求值时捕获一次的 `LOADED_VERSION`（内存事实）。两者不等 = 新副本还没被加载。
- **接口**：`/dsh-purge/status` 与 `/dsh-purge/community` 的 GET 各新增 `disk_version`（localVersion）与 `running_version`（runningVersion）；`plugin_version` / `version` / `panel_version` 语义不变，别改。
- **面板**：`CommunityMaintenance` 在「本机备份」小节标题之前渲染一条 `dshpp-notice`，条件是 `disk_version && plugin_version && disk_version !== plugin_version`；文案含两侧真实版本号，并写明「完整退出 DSH（从系统托盘退出）再打开才会加载新代码，刷新浏览器不够」。缺字段或相等时不渲染——别为“保险”改成恒显。
- **旧代码救不了自己**：这条提示本身就是新代码。旧进程里没有这段判断，所以事故当时面板安静是预期，不能据此判断安装或补丁失败。
- **排查**：先看 status 的 `disk_version` / `running_version`；不等就完整退出重开（不是关窗口）；重开仍不等，看 `$DSH_HOME/profiles/<profile>/node_modules/dsh-purge-community/package.json`（运行时读这份，不是你的工作目录）。
- **回归**：`packages/purge-panel` `npm test` 新增两条（不一致时出现提示且含两侧版本号；一致/缺失时不出现）；`test/plugin-lifecycle.test.mjs` 在真实 status handler 响应上断言三个版本键，并断言本进程 `localVersion() === runningVersion() === package.json` 的 `version`。
- 没有新增宿主补丁、没有改锚点；仍要手动「应用」+ 完整退出重开。
