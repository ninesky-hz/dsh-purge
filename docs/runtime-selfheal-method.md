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
2. **接到启动钩子**：插件初始化 / 服务 `OnStart` / 应用 `main()` 第一屏之后。**不要**放在"安装步骤"里 —— 安装只发生一次，自愈要每次启动。
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
