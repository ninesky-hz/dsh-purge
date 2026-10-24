# 启动自愈（runtime self-heal）通用方法

> 适用于：Electron / 桌面宿主 / 插件体系里，**运行时目录被厂商升级重建**，而你的修复必须"每次启动都在"的场景。
> 出处：`dsh-purge` 1.6.49 的 `lib/runtime-compat.js`（git 转发器）。本文把它抽成可复用到其它仓库的套路。

---

## 1. 什么是启动自愈

不是"安装脚本"，也不是"启动时跑一次修好就完事"。三个特征缺一不可：

| 特征 | 含义 |
| --- | --- |
| **幂等** | 每次启动都跑同一个检查；已修好就原地返回 `already`，不重复写盘。 |
| **可丢失** | 修复目标位于**厂商会重建的目录**里，随时可能消失；消失后下次启动自动补回。 |
| **不改宿主** | 只在你**有权写的目录**里投放文件/软链接，绝不打补丁到宿主自己的代码里。 |

对照：改宿主源码属于"宿主补丁"（`dsh-purge` 的 80 条），它需要「应用 + 重启」，且升级后要重做 —— 两条路别混。

上面三条针对**磁盘目标**。还有一类同样常见、也更容易写错的自愈：目标是**内存里的状态**（订阅、注册行、挂载中的 fiber），进程一退就归零 —— 第 10 节单独讲，两者的幂等与 fail-closed 要求相同，但"可丢失"的原因不同。

---

## 2. 四个信号：该不该做自愈

1. 你的代码（或依赖）在**缩短过的环境**里跑：PATH、HOME、临时目录被父进程改写；
2. 缺失的是**外部命令**（git / python / ffmpeg / 7z），而不是你自己的模块；
3. 目标目录**由厂商安装器生成**，升级会重建（`resources/runtime/bin`、`app/vendor/bin`、`<install>/tools`）；
4. 失败现象**只在图形界面出现**，终端复现不了 —— 说明差异在环境继承，而不在代码逻辑。

四条同时满足 = 标准自愈场景。少一条先别做：可能只是日志/权限问题。

---

## 3. 设计约束（违反任何一条都会变成新的坑）

| 约束 | 原因 | 反面教材 |
| --- | --- | --- |
| **标记文件属主** | 用内容标记（如 `rem <your-tool>-shim`）区分"我写的"与"别人写的"，否则下次升级会覆盖用户的东西 | 直接 `writeFileSync` 覆盖同名 `git.cmd` |
| **外来文件不覆盖** | 同名文件存在且没有你的标记 → 报 `file_conflict` 并保留原文件，让上层可见 | 静默覆盖，用户丢了自定义 shim |
| **fail-closed** | 找不到真实目标（`git.exe`）就不写**半成品转发器**，否则每次调用都失败且看不出原因 | 写一个指向不存在路径的 `git.cmd` |
| **防自递归** | 解析真实目标时**只认 `.exe`**（或绝对路径白名单），绝不把 `git.cmd` 当系统 git | `which git` 返回你自己的 shim → shim 调 shim → 无限递归 |
| **原子写** | 先写唯一临时名、`fsync` 后 `rename`；被占用（Windows 共享冲突）就跳过，下次再来 | 直接覆盖正在被读取的文件 |
| **平台守卫** | 非目标平台 / 非目标安装形态直接 `skipped`，不 probe 磁盘 | 在 Linux CI 上探测 `Program Files` |
| **可观测** | 状态接口/命令行必须能读到 `ok / missing / conflict / not_win32`，否则出问题只能靠猜 | 只在 stderr 打一行 warn |

---

## 4. 参考实现（Node / 纯 `fs`，可移植）

```js
// lib/runtime-compat.js —— 骨架，去掉业务词汇即可复用
export const SHIM_NAME = "git.cmd";
export const SHIM_MARK = "my-tool-git-shim";

export function shimBody(target) {
  return [
    `rem ${SHIM_MARK} — auto-installed; safe to delete`,
    "@echo off",
    `"${target}" %*`,
  ].join("\r\n");           // .cmd 必须 CRLF，LF 会被 cmd 解析出错
}

export function resolveTarget({ gitPath, env = process.env, fs = diskFs(), platform = process.platform, discoverProgramFiles = true } = {}) {
  if (platform !== "win32") return "";
  const isRealExe = (p) => /\.exe$/i.test(p) && exists(p);   // 关键：只认 exe
  if (gitPath && isRealExe(gitPath)) return path.normalize(gitPath);
  for (const dir of (env.PATH ?? "").split(path.delimiter)) { /* 逐目录找 git.exe */ }
  // 再探 ProgramFiles / LOCALAPPDATA\Programs 等固定位置
  return "";
}

export function ensureShim({ resources, gitPath, platform = process.platform, env = process.env, fs = diskFs() } = {}) {
  if (platform !== "win32") return { skipped: "not_win32" };
  const bin = path.join(resources, "runtime", "bin");
  if (!fs.existsSync(bin)) return { skipped: "no_runtime" };   // 非桌面宿主
  const target = path.join(bin, SHIM_NAME);

  if (fs.existsSync(target)) {
    const body = fs.readFileSync(target, "utf8");
    if (!body.includes(SHIM_MARK)) return { ok: false, reason: "file_conflict", target };
    return { ok: true, already: true, target };
  }
  const git = resolveTarget({ gitPath, env, fs, platform });
  if (!git) return { ok: false, reason: "missing_system_git" };  // fail-closed
  atomicWrite(fs, target, shimBody(git));
  return { ok: true, wrote: true, target, git };
}
```

要点：

- `options` 全部可注入（`fs` / `env` / `platform` / `gitPath`），否则测试只能跑在真机上 —— 这是**能不能写单测**的分水岭。
- `atomicWrite` = `tmp + rename`，Windows 上 rename 覆盖可能 `EBUSY`，捕获后返回 `{ok:false, reason:"busy"}` 交给下次启动。
- 状态函数单独导出（`status()` 返回 `ok|missing|conflict|not_win32|no_runtime`），供面板/`--status` 复用。

### 其它语言的等价片段

**PowerShell（宿主安装器/服务场景）**

```powershell
$bin = Join-Path $env:RESOURCES "runtime\bin"
$target = Join-Path $bin "git.cmd"
if (-not (Test-Path $bin)) { return @{ skipped = "no_runtime" } }
if ((Test-Path $target) -and -not (Select-String -Path $target -SimpleMatch "my-tool-git-shim" -Quiet)) {
  return @{ ok = $false; reason = "file_conflict" }
}
$git = (Get-Command git.exe -ErrorAction SilentlyContinue).Source
if (-not $git) { return @{ ok = $false; reason = "missing_system_git" } }
Set-Content -Path $target -Encoding ASCII -Value @(
  "rem my-tool-git-shim — auto-installed; safe to delete", "@echo off", "`"$git`" %*"
)
```

**Go（单二进制工具）**

```go
func ensureShim(resources string) error {
    bin := filepath.Join(resources, "runtime", "bin")
    if _, err := os.Stat(bin); err != nil { return nil } // no_runtime，非桌面形态
    target := filepath.Join(bin, "git.cmd")
    if body, err := os.ReadFile(target); err == nil && !bytes.Contains(body, []byte(shimMark)) {
        return errConflict
    }
    git, err := exec.LookPath("git.exe")
    if err != nil { return errMissingGit }
    tmp := target + ".tmp-" + strconv.Itoa(os.Getpid())
    if err := os.WriteFile(tmp, []byte(shimBody(git)), 0o644); err != nil { return err }
    return os.Rename(tmp, target) // 原子替换，失败留给下次
}
```

---

## 5. 落地清单

拷贝到新仓库时按顺序做，每步都有可验证产出：

1. **新建 `<pkg>/runtime-compat.js`**（名字随语言），导出 `resolve*` / `ensure*` / `status*` 三个函数。
2. **接到启动钩子**：插件初始化 / 服务 `OnStart` / 应用 `main()` 第一屏之后。**不要**放在"安装步骤"里 —— 安装只发生一次，自愈要每次启动。（本仓库的实际接线、fail-open 与日志策略见 §9.1。）
3. **加状态行**：面板/`status` 输出一行 `shim: ok|missing|conflict|not_win32`，让人不读日志就能判断。
4. **写测试（5 条即可）**：
   - 正常写入 + 内容含标记 + CRLF + 二次调用 `already`；
   - 外来同名文件 → `file_conflict` 且原文件字节不变；
   - 找不到真实目标 → 不落任何文件；
   - 非目标平台 / 无 runtime 目录 → `skipped`，且磁盘零改动；
   - 解析器优先显式路径，且**不会**选中 `git.cmd`。
5. **文档一句话**：写清"厂商升级会重建该目录，下此启动自动补回；回滚=删除该文件"。
6. **发布**：`npm pack`/构建产物里确认新文件被包含（`files` 字段容易漏）。

---

## 6. 反模式

- ❌ 在**用户目录**放 shim 后改全局 PATH：影响所有程序，且用户重装即失效。
- ❌ 用 `shutil.which("git")` 当"真实 git"：在你自己的 bin 已在 PATH 首位时，它返回的就是你的 shim。
- ❌ 把自愈塞进「安装/升级」流程：用户升级宿主后不会重跑安装。
- ❌ 静默吞掉 `file_conflict`：用户明明自己配了 git 包装器，却被你无声跳过或被覆盖。
- ❌ 只在 `catch` 里 `console.warn`：出问题时没人看得到，状态接口必须能查。
- ❌ 用 `\n` 写 `.cmd`：`cmd.exe` 对 LF 容忍度差，`goto`/`if` 会解析异常。

---

## 7. 迁移到我的其它仓库（3 步改写）

1. 把 `GIT_SHIM_NAME = "git.cmd"`、`runtime/bin` 换成目标工具与目标目录（例如 `python-shim` + `vendor/bin`、`ffmpeg-shim` + `tools/bin`）。
2. `resolveTarget` 的探测顺序保留：**显式配置 → PATH 逐目录（只认真实可执行文件）→ 固定安装位置**。
3. 状态字符串保持同一套词表：`ok` / `already` / `missing` / `conflict` / `skipped(not_win32|no_runtime)` —— 多个仓库共用一套，排查时不用重新学。

---

## 8. 验收记录（dsh-purge 1.6.49 实测，可作模板）

| 场景 | 结果 |
| --- | --- |
| PATH 正常，GUI/CLI 装 git 依赖 | 成功（21.9s） |
| PATH 收窄成只有 `runtime/bin`，无 `git.cmd` | 复现用户报错 `'git' 不是内部或外部命令`，`EXIT=1` |
| 同上，但已放本插件写的 `git.cmd` | 成功（9.6s），日志可见 `git config --get core.sshCommand`、`git ls-remote -- <url> HEAD` 被真实调用 |
| 单测 | 5/5 通过（`node --test test/runtime-compat.test.mjs`） |

结论：自愈生效的判据不是"文件写成功"，而是**同一受限环境下的端到端命令跑通**。写测试时也要照这个标准设计（见第 5 节第 4 步）。

---

## 9. 实装接线：dsh-purge 1.6.49（可直接对照源码）

前面 1–8 节是通用套路；这一节是它在仓库里的**真实接线**，照抄时对着源码改。文件：`lib/runtime-compat.js` + `lib/index.js`。

### 9.1 调用点与三条接线规矩

唯一调用点在 `lib/index.js` 的 `applyHostHooks()`（插件加载期，紧随 identity / region / fresh-full-access / rewind / cwd / mnemon 等运行时钩子之后）：

```js
try {
  const gitShim = runtimeCompat.ensureRuntimeGitShim();
  if (gitShim.wrote || gitShim.reason) log(cfg, "runtime git shim:", JSON.stringify(gitShim));
} catch (e) {
  console.warn("[dsh-purge] runtime git shim error:", String(e?.message || e));
}
```

| 规矩 | 为什么 |
| --- | --- |
| 挂在**插件加载期**，不是「应用」按钮 | 「应用」只写宿主补丁、要重启；自愈必须每次启动都跑 |
| **fail-open**：整段 `try/catch`，异常只 `console.warn` | 自愈是辅助，坏了不能连累插件加载（否则一个 shim 问题会连技能/工具一起拖死） |
| **只在有动作时记日志**（`wrote` / `reason`） | `already` 静默，否则每次启动都刷一行噪声 |

### 9.2 目标与产物

`<resources>/runtime/bin/git.cmd` —— 实测 122 字节，CRLF：

```bat
rem dsh-purge-git-shim — auto-installed by dsh-purge; safe to delete
@echo off
"C:\Program Files\Git\cmd\git.exe" %*
```

同目录官方只放 `node` / `node.cmd`（这就是 PATH 被收窄后 pnpm 找不到 git 的直接证据）。

### 9.3 状态机（7 态，比第 3 节的 4 态更细）

| `state` | 触发条件 | 自愈动作 |
| --- | --- | --- |
| `ok` | 内容含 `dsh-purge-git-shim` 标记 | 字节完全一致 → `already`，不写盘 |
| `legacy` | 是"纯转发器"且指向**同一个** `git.exe` | 就地补标记（`adopted`），不算冲突 |
| `conflict` | 同名文件存在，非我们的、也不是等价转发器 | 保留原文件，`ok:false / reason:file_conflict` |
| `missing` | 无 `git.cmd`，且解析到系统 git | 写入 |
| `missing`（无 git） | 无 `git.cmd` 且找不到 `git.exe` | fail-closed，**不写**半成品 |
| `no_runtime` | `<resources>/runtime/bin` 不存在（Web / headless） | `skipped` |
| `not_win32` | 非 Windows | `skipped` |

两个 `n/a` 是 `skipped` 的子类，状态行要能一眼区分"没做"和"做失败"。

### 9.4 两个容易写错的细节

**纯转发器识别**（`pureForwarderTarget`）—— 让手工按文档补过转发器的机器不必先删文件：

```js
/^@echo off\s*\r?\n\s*"?([^"\r\n]+\.exe)"?\s+%\*\s*$/i
```

匹配后还要比对"解析出的 exe 与系统 git 是否同一路径"（`path.normalize` + 小写比较）；只满足格式但指向别处的，按外来文件保护，不接管。

**真实 git 解析顺序**（`resolveSystemGit`）：显式 `gitPath` → `ProgramW6432` / `ProgramFiles` / `ProgramFiles(x86)` / `LOCALAPPDATA\Programs\Git\cmd\git.exe` → 固定 `C:\Program Files\Git\cmd\git.exe`、`…(x86)…` → `PATH` 逐目录。

- 只认 `.exe`（`.cmd` 可能就是自己 → 自递归）；
- **不调 `where.exe`**：子进程闪窗 + 阻塞，且结果可能命中自己的 shim。

**写盘**：`.dshpurge-<pid>.tmp` 写入 → 目标已存在则先 `unlink` → `rename`。Windows 上 `rename` 覆盖已存在文件会失败，所以顺序不能省；任何异常清理 tmp 并返回 `write_failed`，交给下次启动。

### 9.5 观测

`renderStatus()` 多一行「git shim / runtime」，值来自 `runtimeGitShimSummary()`：

```
ok → C:\Program Files\Git\cmd\git.exe
missing (git: C:\Program Files\Git\cmd\git.exe)     ← 有 git 但没转发器
missing (no system git)                            ← 两者都缺，fail-closed
conflict (foreign git.cmd kept)
legacy forwarder → … (will be adopted)
n/a (no runtime/bin)
```

该行独立 `try/catch`：状态行失败不影响其它行输出。

### 9.6 升级后怎么恢复

官方更新重建 `resources/runtime/**` → `git.cmd` 消失 → 下次插件加载状态回到 `missing` 并重写。**不需要点「应用」，也不需要用户重启**（和 §1 里"宿主补丁要应用 + 重启"是两条路，别混）。回滚 = 删掉那个 `git.cmd`，无副作用。

### 9.7 真机验收（复现 → 自愈 → 端到端）

```powershell
# 1) 把 PATH 收窄成只剩 runtime/bin，证明 git 真的断掉
$env:PATH = "$env:ProgramFiles\DeepSeek Harness\resources\runtime\bin"
git --version            # 'git' 不是内部或外部命令 → 复现用户报错

# 2) 触发自愈（等价于重启 DSH 时启动钩子跑一次）
node -e "import('file:///D:/Ai-Project/dsh-purge/lib/runtime-compat.js').then(m=>console.log(m.ensureRuntimeGitShim()))"

# 3) 同一收窄环境再验一次
git --version            # git version 2.x
```

判据是第 3 步，不是第 2 步返回的 `{ ok: true, wrote: true }`。

**单测**：`node --test test/runtime-compat.test.mjs`（5 条）：写入 + 幂等、legacy 接管、外来文件字节不变、无系统 git 时不落盘、非桌面/非 Windows 磁盘零改动。

---

## 10. 第二类目标：运行时状态自愈

第 1–9 节讲的是**磁盘**：把一个文件投放到厂商会重建的目录里。还有一类更常见、也更容易写错的自愈 —— **目标在内存里**，进程一退出就没了。

| | 磁盘目标（第 1–9 节） | 运行时状态目标（本节） |
| --- | --- | --- |
| 目标 | `runtime/bin/git.cmd` | loader entry 的 `plugins`、服务注册、挂载中的订阅 |
| 为什么"可丢失" | 厂商升级会重建该目录 | 进程退出，内存态归零 |
| 数据源 | 无，探磁盘 | 用户的持久配置（settings 文档 / profile patch） |
| 主要失败模式 | 写坏别人的文件 | **跑太早**，依赖还没就绪 |
| 幂等判据 | 文件含标记 | 当前状态已等于目标状态 |

### 10.1 "跑太早"是这类自愈的默认结局

`dsh-main-agent` 0.13.0 带过一个典型 bug：重启后按 `supervisedPresets` 把监督层重新叠到 preset 上，实现是 mount 时一次 + `setTimeout(0)` + `setTimeout(2000)` 两次重试。看起来够宽容，实际每次重启都失效 —— `config` 由 settings 文档 hydrate，这个动作可能晚于 2000 ms；三次 pass 跑的时候 `supervisedPresets` 还是默认空数组，`wanted` 为空，什么也不做，之后**没有任何东西再试**。

表象是「设置明明勾着，重启后却没生效」，而手动再保存一次就正常 —— 因为它走的是另一条路径（写入后立即应用），那条路径本来就晚于 hydrate。

### 10.2 三路触发，而不是一路

修法是把"依赖就绪"本身变成信号，定时器只做兜底：

| 触发 | 覆盖的时序 |
| --- | --- |
| mount 时立刻一次 | 依赖已经在了（最常见） |
| 订阅依赖的落地事件（这里是 `settings/document-updated`） | **持久文档晚到** |
| 两次延迟重试（0 / 2000 ms） | loader 行晚于本插件挂载 |

三者调同一个 `sync()`，且 `sync()` 必须幂等 —— 否则第二次 pass 会把已经对的状态再写一遍，白白重启 fibre。

```js
// 幂等的目标是"比对终态"，不是"记录我做过"
export async function syncSupervisedPresets(ctx, config, log, override) {
  const wanted = new Set(live(config?.supervisedPresets, []))
  for (const { entry, id, plugins } of presetEntries(ctx)) {
    const next = wanted.has(id) ? applyLayer(plugins) : stripLayer(plugins)
    if (deepEqual(next, plugins)) continue          // 已在目标状态，不写
    await entry.update({ config: { ...entry.options.config, plugins: next } })
  }
}

// 三路触发：事件那一路是关键，定时器只兜 loader 行晚挂载
const reapply = () => { void syncSupervisedPresets(ctx, config, log) }
const t1 = setTimeout(reapply, 0)
const t2 = setTimeout(reapply, 2000)
ctx.on('settings/document-updated', () => { void reapply() })
ctx.effect?.(() => () => { clearTimeout(t1); clearTimeout(t2) })
```

### 10.3 幂等的两个坑

1. **别拿"序列化后与原文比较"当幂等判据。** 配置走 YAML 往返时，每次 `stringify` 都会重排块标量缩进，第二次输出永远不等于磁盘字节，于是"已应用"被误判成"需要再写"。判据要用**语义状态** —— 这里数三个工具行的 `name` 是否已经是自己的实现。
2. **别用"我写过了"标记。** 进程退出后它就没了；标在磁盘上，又会和"用户后来手工改回去"冲突。唯一可靠的判据是**当前状态**。

### 10.4 验收

磁盘目标的验收是"同一受限环境下端到端命令跑通"（第 8、9 节）。运行时状态目标只有一条：**重启一次，然后读状态接口**，确认目标状态真的重建了 —— 不是看设置文档里还写着。

`dsh-main-agent` 的对应检查：

```sh
curl -s http://127.0.0.1:<port>/supervisor/health    # 版本是否已含修复
curl -s http://127.0.0.1:<port>/supervisor/presets   | jq '.presets[] | select(.supervised) | {id, rows, mounted}'
# 期望：每个 supervised=true 的 preset，rows=3 或 mounted=true
```

只看 `supervised: true` 不够 —— 那是**设置**，不是**状态**。0.13.0 就是设置完好、状态为空。

### 10.5 反模式

- ❌ 只靠一个 `setTimeout(3000)` 就当"等依赖就绪"：换台机器、换磁盘、冷启动就失效。
- ❌ 把用户偏好写进代码默认值：偏好读不到时就静默退化成"用户没设过"，而不是"还没就绪"。
- ❌ 失败静默：`sync` 抛错只进 `catch`，用户看到的是"勾着却没生效"，日志里什么都没有。
- ❌ 幂等判据用"我写过了"或序列化字节比较。
