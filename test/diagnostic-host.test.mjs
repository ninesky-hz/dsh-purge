// 回归：diagnosticHost() 曾把 resources/app.asar.unpacked 直接当宿主。
// Electron 只要 unpack 过任一原生模块就会创建该目录，于是 ai_base 落到一个
// 只有 dsh-session-log-export / libreoffice-kit 的空壳上，全部补丁目标
// missing_file、selfcheck 报 no-host。这里用临时目录 fixture 钉住四种现场。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { currentHost, diagnosticHost, hostSurface } from "../lib/instance.js";

// 只读 reader：只放行探测/读取类 API，任何写操作或未预期调用直接抛错，
// 用证据证明 diagnosticHost 只做 stat/readFile 探测。
const READ_ONLY = new Set([
  "statSync",
  "lstatSync",
  "readFileSync",
  "realpathSync",
  "existsSync",
  "readdirSync",
  "accessSync",
]);
function readOnlyReader(base = fs) {
  const used = new Set();
  const reader = new Proxy(
    {},
    {
      get(_target, key) {
        if (typeof key !== "string") return undefined;
        if (!READ_ONLY.has(key))
          throw new Error(`诊断使用了未预期的 reader API：${key}`);
        used.add(key);
        const value = base[key];
        return typeof value === "function" ? value.bind(base) : value;
      },
    },
  );
  return { reader, used };
}

function snapshot(dir) {
  const rows = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      const relative = path.relative(dir, full);
      if (entry.isDirectory()) rows.push(`${relative}/`);
      else rows.push(`${relative}:${fs.statSync(full).size}`);
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(dir);
  return rows;
}

function fixture() {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "purge-diagnostic-host-")),
  );
  const resources = path.join(root, "DSH Desktop/resources");
  fs.mkdirSync(resources, { recursive: true });
  // 密封归档存在：本身也是「按归档路径启动」这一形态的前提。
  fs.writeFileSync(path.join(resources, "app.asar"), "fixture sealed archive");
  const layout = (name) => path.join(resources, name);
  const hostIn = (name) =>
    path.join(resources, name, "dsh/node_modules/@deepseek-ai");
  const pkg = (parent, name) => {
    fs.mkdirSync(path.join(parent, name), { recursive: true });
    fs.writeFileSync(
      path.join(parent, name, "package.json"),
      JSON.stringify({ name: `@deepseek-ai/${name}` }),
    );
  };
  return {
    root,
    resources,
    // currentHost 会返回的启动形路径（归档内启动）
    archive: path.join(resources, "app.asar", "dsh/node_modules/@deepseek-ai"),
    expected: hostIn("app"),
    unpacked: hostIn("app.asar.unpacked"),
    hostIn,
    pkg,
    options: () => ({ env: {}, argv: [], aiBase: path.join(resources, "app.asar", "dsh/node_modules/@deepseek-ai") }),
    close() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("只有 app 目录时选中 app，currentHost 语义不变", () => {
  const f = fixture();
  try {
    f.pkg(f.hostIn("app"), "dsh-agent-loop");
    const options = f.options();
    assert.equal(currentHost(options), f.archive);
    const { reader, used } = readOnlyReader();
    assert.equal(diagnosticHost({ ...options, diskReader: reader }), f.expected);
    assert.equal(hostSurface(f.expected), "desktop");
    assert(used.has("statSync"));
  } finally {
    f.close();
  }
});

test("app 存在但不完整时不完整的 app 不会被兄弟目录替换", () => {
  const f = fixture();
  try {
    // app 已解包但只有桌面壳；unpacked 里反而有主包信号。
    fs.mkdirSync(path.join(f.hostIn("app"), "dsh-desktop-host/lib"), { recursive: true });
    fs.writeFileSync(path.join(f.hostIn("app"), "dsh-desktop-host/lib/cli.js"), "");
    f.pkg(f.unpacked, "dsh-agent-loop");
    const options = f.options();
    assert.equal(diagnosticHost({ ...options, diskReader: readOnlyReader().reader }), f.expected);
    // 连 dsh/ 都没有了的更极端不完整，也必须留在 app 上。
    fs.rmSync(path.join(f.resources, "app/dsh"), { recursive: true });
    assert.equal(diagnosticHost({ ...options, diskReader: readOnlyReader().reader }), f.expected);
  } finally {
    f.close();
  }
});

test("只有 app.asar.unpacked 且含主包信号时选中 unpacked", () => {
  const f = fixture();
  try {
    f.pkg(f.unpacked, "dsh-system-prompt");
    const { reader } = readOnlyReader();
    assert.equal(diagnosticHost({ ...f.options(), diskReader: reader }), f.unpacked);
  } finally {
    f.close();
  }
});

test("只有空壳 app.asar.unpacked（仅 dsh-session-log-export 等）时回落到期望路径，绝不选 unpacked", () => {
  const f = fixture();
  try {
    // 复刻现场：unpacked 里只有三个原生/导出包，没有 DSH 主包。
    for (const name of [
      "dsh-session-log-export",
      "libreoffice-kit",
      "libreoffice-kit-win32-x64",
    ]) f.pkg(f.unpacked, name);
    const before = snapshot(f.root);
    const { reader } = readOnlyReader();
    const host = diagnosticHost({ ...f.options(), diskReader: reader });
    assert.equal(host, f.expected, "期望路径是 resources/app/...，不是 unpacked");
    assert.notEqual(host, f.unpacked);
    assert.equal(host, path.join(f.resources, "app", "dsh/node_modules/@deepseek-ai"));
    // 上层据此报 missing_file + sealed-archive，而不是把空壳当宿主。
    assert.equal(hostSurface(host), "desktop");
    assert.deepEqual(snapshot(f.root), before, "诊断不得写盘或改动安装目录");
  } finally {
    f.close();
  }
});

test("app 与 app.asar.unpacked 都不存在时返回期望路径", () => {
  const f = fixture();
  try {
    const { reader, used } = readOnlyReader();
    const host = diagnosticHost({ ...f.options(), diskReader: reader });
    assert.equal(host, f.expected);
    assert.equal(host, path.join(f.resources, "app", "dsh/node_modules/@deepseek-ai"));
    assert.equal(hostSurface(host), "desktop");
    assert(!used.has("writeFileSync"));
  } finally {
    f.close();
  }
});

test("显式指向 unpacked 的物理路径仍不被重定向，且不写盘", () => {
  const f = fixture();
  try {
    f.pkg(f.unpacked, "dsh-agent-instructions");
    const before = snapshot(f.root);
    const explicit = f.unpacked;
    assert.equal(
      diagnosticHost({ env: {}, argv: [], aiBase: explicit, diskReader: readOnlyReader().reader }),
      explicit,
    );
    assert.deepEqual(snapshot(f.root), before);
    assert.equal(diagnosticHost({ env: {}, argv: [] }), "", "没有实例证据时不退回任何安装");
  } finally {
    f.close();
  }
});
