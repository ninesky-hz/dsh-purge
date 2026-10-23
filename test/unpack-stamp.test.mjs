import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  pluginVersion,
  readUnpackedAsarStamp,
  shouldReextractForPluginUpgrade,
  writeUnpackedAsarStamp,
} from "../lib/core.js";
import { sameAsarIdentity, shouldExtractAsar } from "../lib/extract-asar.js";

// 全部读写只落临时 DSH_HOME，不碰真实 ~/.dsh。
const ORIGINAL_HOME = process.env.DSH_HOME;

function tempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-unpack-stamp-"));
  process.env.DSH_HOME = home;
  return home;
}

function closeHome(home) {
  if (ORIGINAL_HOME === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = ORIGINAL_HOME;
  fs.rmSync(home, { recursive: true, force: true });
}

function stampPath(home) {
  return path.join(home, "dsh-purge", "unpacked-asar.json");
}

/** 与 openSealedDesktopHost 同序：先按下归档身份，再看插件版本。 */
function decidedExtract({
  usable = true,
  identity = { size: 100, mtimeMs: 200 },
  recorded = { size: 100, mtimeMs: 200, version: pluginVersion() },
  forApply = false,
  upgrade = false,
  archivePresent = true,
  plugin = pluginVersion(),
} = {}) {
  const byArchive = shouldExtractAsar({ usable, identity, recorded, upgrade });
  return byArchive || shouldReextractForPluginUpgrade({
    recordedVersion: recorded?.version,
    pluginVersion: plugin,
    forApply,
    upgrade,
    archivePresent,
  });
}

test("stamp 往返：写入带版本，读回一致；旧文件缺 version 读回空串", () => {
  const home = tempHome();
  try {
    const current = pluginVersion();
    assert.ok(current.length > 0, "插件版本必须可读");

    // 默认参数：调用点不传版本也会记下当前插件版本。
    writeUnpackedAsarStamp({ size: 4242, mtimeMs: 1700000000000 });
    const onDisk = JSON.parse(fs.readFileSync(stampPath(home), "utf8"));
    assert.equal(onDisk.size, 4242);
    assert.equal(onDisk.mtimeMs, 1700000000000);
    assert.equal(onDisk.version, current);
    assert.deepEqual(readUnpackedAsarStamp(), {
      size: 4242,
      mtimeMs: 1700000000000,
      version: current,
    });

    // 显式传版本时以传入值为准。
    writeUnpackedAsarStamp({ size: 7, mtimeMs: 8 }, "  0.9.0  ");
    assert.deepEqual(readUnpackedAsarStamp(), { size: 7, mtimeMs: 8, version: "0.9.0" });

    // 旧版 stamp：只有 size/mtimeMs，版本视为未知。
    fs.mkdirSync(path.dirname(stampPath(home)), { recursive: true });
    fs.writeFileSync(stampPath(home), `${JSON.stringify({ size: 11, mtimeMs: 22 })}\n`, "utf8");
    assert.deepEqual(readUnpackedAsarStamp(), { size: 11, mtimeMs: 22, version: "" });

    // 非法版本字段和非 JSON 都不编版本。
    fs.writeFileSync(stampPath(home), `${JSON.stringify({ size: 11, mtimeMs: 22, version: 47 })}\n`, "utf8");
    assert.equal(readUnpackedAsarStamp()?.version, "");
    fs.writeFileSync(stampPath(home), "not json", "utf8");
    assert.equal(readUnpackedAsarStamp(), null);
  } finally {
    closeHome(home);
  }
});

test("版本不一致且 forApply/upgrade 才要求重解包，版本一致不重解", () => {
  const home = tempHome();
  try {
    const current = pluginVersion();
    const stale = { size: 100, mtimeMs: 200, version: "1.1.72" };
    assert.notEqual(stale.version, current);

    assert.equal(decidedExtract({ recorded: stale, forApply: true }), true);
    assert.equal(decidedExtract({ recorded: stale, forApply: true, upgrade: false }), true);
    assert.equal(decidedExtract({ recorded: stale, upgrade: true }), true);
    // 版本一致：归档身份也一致，就照旧增量改文件，不重解包。
    assert.equal(decidedExtract({ recorded: { ...stale, version: current }, forApply: true }), false);
    assert.equal(decidedExtract({ recorded: { ...stale, version: current }, upgrade: true }), false);
    // 归档已经不在（例如已换包），无从重解。
    assert.equal(decidedExtract({ recorded: stale, forApply: true, archivePresent: false }), false);
    // 目录不可用时本来就要解，与版本无关。
    assert.equal(decidedExtract({ recorded: stale, forApply: true, usable: false }), true);
  } finally {
    closeHome(home);
  }
});

test("旧 stamp 没记版本（空串）不因版本强制重解包", () => {
  const current = pluginVersion();
  for (const recorded of [{ size: 100, mtimeMs: 200, version: "" }, { size: 100, mtimeMs: 200 }]) {
    assert.equal(decidedExtract({ recorded, forApply: true }), false);
    assert.equal(decidedExtract({ recorded, upgrade: true }), false);
  }
  // 插件版本读不到（空串）同样视为未知，不据此重解。
  assert.equal(shouldReextractForPluginUpgrade({
    recordedVersion: "1.1.72",
    pluginVersion: "",
    forApply: true,
    upgrade: false,
    archivePresent: true,
  }), false);
  assert.equal(shouldReextractForPluginUpgrade({
    recordedVersion: current,
    pluginVersion: current,
    forApply: false,
    upgrade: false,
    archivePresent: true,
  }), false);
});

test("asar 身份变化仍然重解包（回归）", () => {
  const current = pluginVersion();
  const recorded = { size: 100, mtimeMs: 200, version: current };
  const changed = { size: 101, mtimeMs: 200 };
  assert.equal(sameAsarIdentity(changed, recorded), false);
  // 版本相同，但归档换了：保持既有语义，仍要重解。
  assert.equal(shouldExtractAsar({ usable: true, identity: changed, recorded, upgrade: false }), true);
  assert.equal(shouldExtractAsar({ usable: true, identity: changed, recorded, upgrade: true }), true);
  assert.equal(decidedExtract({ recorded, identity: changed }), true);

  // 归档没变、目录可用：两种身份下的判定都指向「不重解」。
  assert.equal(shouldExtractAsar({ usable: true, identity: { ...recorded }, recorded, upgrade: true }), false);
  assert.equal(decidedExtract({ recorded, identity: { ...recorded } }), false);
  // 归档读不到（identity 为 null）时保持既有语义：不解。
  assert.equal(shouldExtractAsar({ usable: false, identity: null, recorded: null, upgrade: true }), false);
});

test("普通定位/启动路径不看插件版本，版本不一致也不重解", () => {
  const current = pluginVersion();
  const stale = { size: 100, mtimeMs: 200, version: "1.1.72" };
  // 非 forApply/upgrade 且归档未换：启动路径行为完全不变。
  assert.equal(decidedExtract({ recorded: stale }), false);
  assert.equal(decidedExtract({ recorded: stale, forApply: false, upgrade: false }), false);
  assert.equal(shouldReextractForPluginUpgrade({
    recordedVersion: stale.version,
    pluginVersion: current,
    forApply: false,
    upgrade: false,
    archivePresent: true,
  }), false);
  // 这两个开关必须是布尔 true 才算；真值字符串不放大行为。
  assert.equal(shouldReextractForPluginUpgrade({
    recordedVersion: stale.version,
    pluginVersion: current,
    forApply: "true",
    upgrade: 1,
    archivePresent: true,
  }), false);
});
