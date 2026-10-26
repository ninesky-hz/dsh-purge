// 回归：换包成功后的 unpacked 最终态宿主被插件自己 kill 掉。
//
// 现场（DSH Desktop 0.2.1-rc.3 / Windows）：
//   resources\app 已解包、app.asar 已改名成 app.asar.purge-<token>.bak，
//   插件在 unpacked 布局下加载 → restartOfficialHarness() 把「asar 不存在」
//   当成「还要换包」→ killApp:true 的 helper 杀掉宿主 → 宿主的 stop() 已经
//   shutdown 了 Cordis，main() 却继续 installDesktopUpdateTaskControl(ctx)
//   → INACTIVE_EFFECT 崩溃。
//
// 这里用 os.tmpdir() 下的临时安装 fixture 钉住三件事：
//   a. 已是 unpacked 最终态 → 不 spawn、不 kill，返回 restarting:false；
//   b. app 目录也不在（真损坏）→ 保持原来的 helper kill+relaunch；
//   c. app.asar 还在（密封态）→ 行为不变，仍走 asar swap / handoff。
// 所有副作用（spawnHelper / Windows handoff）都用可注入缝截住，绝不真杀进程。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { unpackedFinalLayout, restartOfficialHarness } from "../lib/desktop.js";

const AI = "@deepseek-ai";
const DESKTOP_HOST = `${AI}/dsh-desktop-host`;
const MARKERS = [
  "// [dsh-purge] identity stripped",
  "// [dsh-purge] complete prompt keeps waterfall inject",
  "",
].join("\n");

function writeFile(file, content = "") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** 一份最小可用的宿主身份：desktopIdentity() 认的 bundled-host 布局。 */
function hostIdentityInto(root) {
  writeFile(path.join(root, "dsh", "node_modules", DESKTOP_HOST, "package.json"),
    JSON.stringify({ name: DESKTOP_HOST, main: "lib/cli.js" }));
  writeFile(path.join(root, "dsh", "node_modules", DESKTOP_HOST, "lib", "cli.js"), "// cli\n");
}

/** 洗过的系统提示词模块，让 unpackedHostIsClean() 为真（生产里换包后就是这个状态）。 */
function cleanSystemPromptInto(appDir) {
  const pkg = path.join(appDir, "dsh", "node_modules", AI, "dsh-system-prompt");
  writeFile(path.join(pkg, "package.json"), JSON.stringify({ name: `${AI}/dsh-system-prompt` }));
  writeFile(path.join(pkg, "lib", "index.js"), MARKERS);
}

/** 最小但格式合法的 asar：lib/extract-asar.js 与 lib/desktop-identity.js 都能解析。 */
function asarBytes(files) {
  const header = { files: {} };
  const bodies = [];
  let offset = 0;
  for (const [rel, text] of Object.entries(files)) {
    const parts = rel.split("/");
    let node = header;
    for (const dir of parts.slice(0, -1)) {
      node.files[dir] = node.files[dir] || { files: {} };
      node = node.files[dir];
    }
    const body = Buffer.from(text, "utf8");
    node.files[parts[parts.length - 1]] = { size: body.length, offset };
    bodies.push(body);
    offset += body.length;
  }
  const json = Buffer.from(JSON.stringify(header), "utf8");
  const head = Buffer.alloc(16);
  head.writeUInt32LE(4, 0); // 首个 pickle 头
  head.writeUInt32LE(8 + json.length, 4); // headerSize → dataOffset = 16 + json.length
  head.writeUInt32LE(json.length, 8);
  head.writeUInt32LE(json.length, 12); // jsonSize（readHeader 按 12 偏移读）
  return Buffer.concat([head, json, ...bodies]);
}

function sealedArchiveWithHost() {
  return asarBytes({
    [`dsh/node_modules/${DESKTOP_HOST}/package.json`]: JSON.stringify({ name: DESKTOP_HOST, main: "lib/cli.js" }),
    [`dsh/node_modules/${DESKTOP_HOST}/lib/cli.js`]: "// cli\n",
    [`dsh/node_modules/${AI}/dsh-agent-loop/package.json`]: JSON.stringify({ name: `${AI}/dsh-agent-loop` }),
  });
}

function tempInstall() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-unpacked-")));
  const install = path.join(root, "DeepSeek Harness");
  const resources = path.join(install, "resources");
  fs.mkdirSync(resources, { recursive: true });
  const exe = path.join(install, "DeepSeek Harness.exe");
  fs.writeFileSync(exe, "fixture exe");
  return {
    root,
    install,
    resources,
    exe,
    app: path.join(resources, "app"),
    asar: path.join(resources, "app.asar"),
    close() { fs.rmSync(root, { recursive: true, force: true }); },
  };
}

/** 现场形态：resources\app 就是宿主，app.asar 已经按换包流程移走。 */
function unpackedFinalFixture() {
  const f = tempInstall();
  hostIdentityInto(f.app);
  cleanSystemPromptInto(f.app);
  return f;
}

function spySeams() {
  const spawned = [];
  const handedOff = [];
  return {
    spawned,
    handedOff,
    spawnHelper: (...args) => { spawned.push(args); },
    scheduleHandoff: (request, ...rest) => {
      handedOff.push({ request, rest });
      return { scheduled: true, pending: true, manualQuit: true, restarting: false, handoff: { phase: "waiting_for_quit" } };
    },
  };
}

test("unpacked 最终态：不 spawn helper、不 killApp，返回 restarting:false", () => {
  const f = unpackedFinalFixture();
  const seams = spySeams();
  try {
    const before = fs.readdirSync(f.resources).sort();
    // 不传 requireClean：用生产默认（洗过的系统提示词）走完整路径。
    const result = restartOfficialHarness({ exe: f.exe, spawnHelper: seams.spawnHelper, scheduleHandoff: seams.scheduleHandoff });
    assert.equal(seams.spawned.length, 0, "绝不能 spawn killApp 的 helper");
    assert.equal(seams.handedOff.length, 0, "unpacked 最终态不该走密封换包");
    assert.equal(result.restarting, false);
    assert.equal(result.already, "unpacked");
    assert.equal(result.mode, "unpacked-final");
    assert.equal(result.manualQuit, true, "调用方要能报「不用重启」而不是「重启失败」");
    assert.equal(result.clean, undefined, "不该退化成 clean:false 误报");
    assert.match(String(result.reason), /不需要/);
    assert.match(String(result.note), /无需重启/);
    assert.equal(result.layout.app, f.app);
    assert.match(result.layout.host_package, /dsh-agent-loop|dsh-system-prompt|dsh-agent-instructions/);
    // 一个字节都没动：没建 bak、没写标记、没改名。
    assert.deepEqual(fs.readdirSync(f.resources).sort(), before);
    assert.equal(fs.existsSync(f.asar), false);
  } finally {
    f.close();
  }
});

test("unpacked 最终态 + 没有 wscript 引擎（用户机现场）：仍走 powershell 计划，也不 spawn", () => {
  const f = unpackedFinalFixture();
  const seams = spySeams();
  try {
    // wshJs:false 就是 rc.3 用户机上的现场：旧的 powershell 分支里藏着 killApp。
    const result = restartOfficialHarness({
      exe: f.exe,
      wshJs: false,
      spawnHelper: seams.spawnHelper,
      scheduleHandoff: seams.scheduleHandoff,
    });
    assert.equal(seams.spawned.length, 0);
    assert.equal(result.restarting, false);
    assert.equal(result.already, "unpacked");
    assert.notEqual(result.mode, "unpacked-helper");
  } finally {
    f.close();
  }
});

test("app 目录也不在（真损坏态）：保持原来的 helper kill+relaunch", () => {
  // 宿主身份来自 app.asar.unpacked（Electron 解包原生模块后留下的目录），
  // 但 resources\app 与 app.asar 都不在 —— 这才是旧代码真正要处理的场景。
  const f = tempInstall();
  const seams = spySeams();
  try {
    hostIdentityInto(path.join(f.resources, "app.asar.unpacked"));
    assert.equal(unpackedFinalLayout(f.exe).reason, "app_missing");
    const result = restartOfficialHarness({
      exe: f.exe,
      wshJs: false,
      requireClean: false, // app 不在就没有系统提示词文件可查，直接进换包判定
      spawnHelper: seams.spawnHelper,
      scheduleHandoff: seams.scheduleHandoff,
    });
    assert.equal(seams.handedOff.length, 0);
    assert.equal(seams.spawned.length, 1, "损坏态必须仍然拉起 helper");
    const [helper, payload, opts] = seams.spawned[0];
    assert.match(String(helper), /restart-desktop\.js$/);
    assert.equal(payload.killApp, true);
    assert.equal(payload.asar, null);
    assert.equal(payload.execPath, f.exe);
    assert.equal(opts.exit, true);
    assert.equal(result.restarting, true);
    assert.equal(result.mode, "unpacked-helper");
    assert.equal(result.already, undefined, "损坏态不能被当成「已在解包布局」");
  } finally {
    f.close();
  }
});

test("app 与 asar 都不在、连宿主身份都没有：不会被误当成 unpacked 最终态", () => {
  const f = tempInstall();
  const seams = spySeams();
  try {
    assert.equal(unpackedFinalLayout(f.exe).reason, "app_missing");
    const result = restartOfficialHarness({ exe: f.exe, spawnHelper: seams.spawnHelper, scheduleHandoff: seams.scheduleHandoff });
    assert.equal(seams.spawned.length, 0);
    assert.equal(result.already, undefined);
    assert.equal(result.restarting, false);
  } finally {
    f.close();
  }
});

test("app.asar 还在（密封态）：判定不是最终态，win32 仍走 handoff 换包", { skip: process.platform !== "win32" }, () => {
  const f = tempInstall();
  const seams = spySeams();
  try {
    fs.writeFileSync(f.asar, sealedArchiveWithHost());
    const layout = unpackedFinalLayout(f.exe);
    assert.equal(layout.unpacked, false);
    assert.equal(layout.reason, "archive_present");
    const result = restartOfficialHarness({ exe: f.exe, spawnHelper: seams.spawnHelper, scheduleHandoff: seams.scheduleHandoff });
    assert.equal(seams.spawned.length, 0, "密封态不该走 helper kill+relaunch");
    assert.equal(seams.handedOff.length, 1, "密封态必须仍走换包助手");
    assert.equal(seams.handedOff[0].request.exe, f.exe);
    assert.equal(seams.handedOff[0].request.asar, f.asar);
    assert.equal(result.asarSwap, true);
    assert.equal(result.already, undefined);
    assert.equal(fs.statSync(f.asar).size > 0, true, "归档保持原样");
  } finally {
    f.close();
  }
});

test("app.asar 还在时 unpackedFinalLayout 一律不认最终态（跨平台）", () => {
  const f = tempInstall();
  try {
    hostIdentityInto(f.app);
    cleanSystemPromptInto(f.app);
    fs.writeFileSync(f.asar, sealedArchiveWithHost());
    assert.equal(unpackedFinalLayout(f.exe).unpacked, false);
    assert.equal(unpackedFinalLayout(f.exe).reason, "archive_present");
    fs.rmSync(f.asar);
    assert.equal(unpackedFinalLayout(f.exe).unpacked, true);
  } finally {
    f.close();
  }
});

test("app 在但没有 DSH 主包：不算最终态", () => {
  const f = tempInstall();
  try {
    // Electron 只要 unpack 过原生模块就会建 resources/app；空壳不算宿主。
    writeFile(path.join(f.app, "dsh", "node_modules", AI, "dsh-session-log-export", "package.json"), "{}");
    const layout = unpackedFinalLayout(f.exe);
    assert.equal(layout.unpacked, false);
    assert.equal(layout.reason, "host_package_missing");
    assert.equal(layout.manifest, undefined);
  } finally {
    f.close();
  }
});

test("三个主包任一存在即算（dsh-agent-loop / dsh-system-prompt / dsh-agent-instructions）", () => {
  for (const pkg of ["dsh-agent-loop", "dsh-system-prompt", "dsh-agent-instructions"]) {
    const f = tempInstall();
    try {
      writeFile(path.join(f.app, "node_modules", AI, pkg, "package.json"), JSON.stringify({ name: `${AI}/${pkg}` }));
      const layout = unpackedFinalLayout(f.exe);
      assert.equal(layout.unpacked, true, pkg);
      assert.equal(layout.reason, "unpacked_host_in_place");
      assert.ok(layout.manifest.endsWith(path.join(pkg, "package.json")), pkg);
    } finally {
      f.close();
    }
  }
});

test("只看同一个 resources：不拿兄弟安装的 app 目录凑最终态", () => {
  const f = tempInstall();
  try {
    // 同级的另一份安装是完整的 unpacked 宿主……
    const other = path.join(f.root, "other-install");
    fs.mkdirSync(path.join(other, "resources"), { recursive: true });
    hostIdentityInto(path.join(other, "resources", "app"));
    // ……但被检查的这份只有 exe，resources 里既没有 app 也没有 asar。
    const layout = unpackedFinalLayout(f.exe);
    assert.equal(layout.unpacked, false);
    assert.equal(layout.reason, "app_missing");
    assert.equal(layout.resources, f.resources);
  } finally {
    f.close();
  }
});
