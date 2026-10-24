import path from "node:path";
import { diskFs } from "./extract-asar.js";
import { findDesktopAppExecutable, resourcesDirForExecutable } from "./desktop.js";

/**
 * 官方桌面把 pnpm 子进程的 PATH 收成 `<resources>/runtime/bin` 一个目录
 * （`main.js` 的 desktopNodeEnvironment 只在大写 `PATH` 键上取继承值，
 * Windows 上常见键名是 `Path`，取不到就退化成空串）。
 * 那个目录官方只放 node / node.cmd，于是 pnpm 解析 `git+https://…` 依赖时
 * 会在 cmd 里报「'git' 不是内部或外部命令」。
 *
 * 这里补一个只做转发的 `git.cmd`，重启后自动重放；官方更新重建 runtime 目录
 * 也不会丢（下次启动再写）。不改官方文件，不碰 PATH，不改用户环境变量。
 */
export const GIT_SHIM_NAME = "git.cmd";
export const GIT_SHIM_MARK = "dsh-purge-git-shim";

function fileExists(fs, target) {
  try {
    return Boolean(target) && fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

function dirExists(fs, target) {
  try {
    return Boolean(target) && fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

export function gitShimBody(gitExe) {
  return [
    `rem ${GIT_SHIM_MARK} — auto-installed by dsh-purge; safe to delete`,
    "@echo off",
    `"${gitExe}" %*`,
    "",
  ].join("\r\n");
}

/**
 * 找系统 git。只认 `git.exe`：`git.cmd` 可能是我们自己的转发器，
 * 选中它会自我递归。不跑 `where.exe`，避免子进程闪窗和阻塞。
 */
export function resolveSystemGit(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return "";
  const fs = options.fs ?? diskFs();
  const env = options.env ?? process.env;
  const explicit = options.gitPath ? path.normalize(String(options.gitPath)) : "";
  if (explicit && fileExists(fs, explicit)) return explicit;

  const candidates = [];
  for (const root of [env.ProgramW6432, env.ProgramFiles, env["ProgramFiles(x86)"]]) {
    if (root) candidates.push(path.join(root, "Git", "cmd", "git.exe"));
  }
  if (env.LOCALAPPDATA) candidates.push(path.join(env.LOCALAPPDATA, "Programs", "Git", "cmd", "git.exe"));
  if (options.discoverProgramFiles !== false) {
    candidates.push("C:\\Program Files\\Git\\cmd\\git.exe", "C:\\Program Files (x86)\\Git\\cmd\\git.exe");
  }
  for (const dir of String(env.PATH ?? env.Path ?? "").split(path.delimiter)) {
    const trimmed = dir.trim().replace(/^"|"$/g, "");
    if (trimmed) candidates.push(path.join(trimmed, "git.exe"));
  }
  for (const candidate of candidates) {
    if (fileExists(fs, candidate)) return path.normalize(candidate);
  }
  return "";
}

/** 桌面安装的 resources 目录；Web/headless 下返回空串。 */
export function desktopResources(options = {}) {
  if (options.resources) return path.normalize(String(options.resources));
  let exe = "";
  try {
    exe = findDesktopAppExecutable({ discover: false }) || "";
  } catch {
    exe = "";
  }
  if (!exe) {
    const resourcesPath = options.resourcesPath ?? process.resourcesPath;
    return resourcesPath ? path.normalize(String(resourcesPath)) : "";
  }
  try {
    return resourcesDirForExecutable(exe) || "";
  } catch {
    return "";
  }
}

function shimTarget(options = {}) {
  const resources = desktopResources(options);
  if (!resources) return { resources: "", bin: "", target: "" };
  const bin = path.join(resources, "runtime", "bin");
  return { resources, bin, target: path.join(bin, GIT_SHIM_NAME) };
}

function readText(fs, target) {
  try {
    return fs.readFileSync(target, "utf8");
  } catch {
    return "";
  }
}

/**
 * 识别「纯转发器」：只做 `@echo off` + `"…git.exe" %*` 的 cmd 文件。
 * 手工按文档补过转发器、或旧版本我们自己写的（没有标记）都长这样。
 * 语义与我们要写的内容完全一致，所以可以就地「接管」（补标记）而不是报冲突。
 */
export function pureForwarderTarget(text) {
  const match = /^@echo off\s*\r?\n\s*"?([^"\r\n]+\.exe)"?\s+%\*\s*$/i.exec(String(text ?? "").trim());
  return match ? path.normalize(match[1].trim()) : "";
}

function samePath(a, b) {
  return Boolean(a) && Boolean(b) && path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase();
}

export function runtimeGitShimStatus(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return { state: "not_win32" };
  const fs = options.fs ?? diskFs();
  const { bin, target } = shimTarget(options);
  if (!bin) return { state: "no_desktop" };
  if (!dirExists(fs, bin)) return { state: "no_runtime", bin };
  const git = resolveSystemGit({ ...options, platform, fs });
  const text = readText(fs, target);
  if (!text) return { state: "missing", bin, target, git };
  if (text.includes(GIT_SHIM_MARK)) return { state: "ok", bin, target, git };
  const forwarded = pureForwarderTarget(text);
  if (forwarded && git && samePath(forwarded, git)) return { state: "legacy", bin, target, git };
  return { state: "conflict", bin, target, git };
}

/**
 * 幂等写入 `resources/runtime/bin/git.cmd`。
 * - 已是我们写的且指向同一个 git：不动（already）
 * - 已存在但不是我们的文件：保留并报 conflict，绝不覆盖用户/官方文件
 * - 找不到系统 git：报 missing_system_git，不写半成品
 */
export function ensureRuntimeGitShim(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return { ok: true, skipped: "not_win32" };
  const fs = options.fs ?? diskFs();
  const status = runtimeGitShimStatus({ ...options, platform, fs });
  if (status.state === "no_desktop") return { ok: true, skipped: "no_desktop" };
  if (status.state === "no_runtime") return { ok: true, skipped: "no_runtime", bin: status.bin };
  if (status.state === "conflict") return { ok: false, reason: "file_conflict", target: status.target };

  const git = status.git;
  if (!git) return { ok: false, reason: "missing_system_git", target: status.target };

  const body = gitShimBody(git);
  if (status.state === "ok" && readText(fs, status.target) === body) {
    return { ok: true, already: true, target: status.target, git };
  }
  const adopting = status.state === "legacy";

  const tmp = `${status.target}.dshpurge-${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, body, "utf8");
    if (fs.existsSync(status.target)) fs.unlinkSync(status.target);
    fs.renameSync(tmp, status.target);
    return adopting
      ? { ok: true, adopted: true, target: status.target, git }
      : { ok: true, wrote: true, target: status.target, git, previous: status.state };
  } catch (error) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* 残留 tmp 不影响转发器 */
    }
    return { ok: false, reason: "write_failed", error: String(error?.message || error), target: status.target };
  }
}

/** CLI / 状态行用的单行摘要。 */
export function runtimeGitShimSummary(options = {}) {
  const status = runtimeGitShimStatus(options);
  switch (status.state) {
    case "ok":
      return `ok → ${status.git}`;
    case "missing":
      return status.git ? `missing (git: ${status.git})` : "missing (no system git)";
    case "conflict":
      return `conflict (foreign ${GIT_SHIM_NAME} kept)`;
    case "legacy":
      return `legacy forwarder → ${status.git} (will be adopted)`;
    case "no_runtime":
      return "n/a (no runtime/bin)";
    case "no_desktop":
      return "n/a (not desktop)";
    default:
      return status.state;
  }
}
