import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Maintenance } from "../lib/community.js";

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-lock-"));
  const profile = path.join(home, "profiles/desktop");
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, "package.json"), JSON.stringify({ name: "p", private: true }));
  const manager = new Maintenance({ home, profile });
  const lock = path.join(home, "dsh-purge-community", "maintenance.lock");
  return { home, manager, lock, close: () => fs.rmSync(home, { recursive: true, force: true }) };
}

/** 拿一个确定已经退出的 pid 当“遗留锁持有者”。 */
function deadPid() {
  const child = spawnSync(process.execPath, ["-e", ""], { stdio: "ignore" });
  assert.ok(Number.isInteger(child.pid) && child.pid > 0, "需要一个真实 pid");
  return child.pid;
}

test("持有进程已退出的遗留锁会被回收，维护操作照常执行", async () => {
  const f = setup();
  try {
    fs.mkdirSync(path.dirname(f.lock), { recursive: true });
    fs.writeFileSync(f.lock, String(deadPid()));
    const done = await f.manager.locked(async () => "ran");
    assert.equal(done, "ran");
    assert.equal(fs.existsSync(f.lock), false, "锁必须在结束时删除");
  } finally {
    f.close();
  }
});

test("空文件/损坏内容的锁仍按「有人持有」处理，不抢占", async () => {
  const f = setup();
  try {
    // open(wx) 到写入 pid 之间有窗口，读到空/非数字不能当成没人持有。
    for (const content of ["", "not-a-pid", "0", "fixture"]) {
      fs.mkdirSync(path.dirname(f.lock), { recursive: true });
      fs.writeFileSync(f.lock, content);
      await assert.rejects(
        () => f.manager.locked(async () => content.length),
        /已有维护操作或遗留锁/,
      );
      assert.equal(fs.readFileSync(f.lock, "utf8"), content, "内容必须原样保留");
    }
  } finally {
    f.close();
  }
});

test("仍在运行的持有者不会被抢占，锁保持原样", async () => {
  const f = setup();
  try {
    fs.mkdirSync(path.dirname(f.lock), { recursive: true });
    fs.writeFileSync(f.lock, String(process.pid));
    await assert.rejects(
      () => f.manager.locked(async () => "must not run"),
      /已有维护操作或遗留锁/,
    );
    assert.equal(fs.existsSync(f.lock), true, "活锁不能被删掉");
    assert.equal(fs.readFileSync(f.lock, "utf8"), String(process.pid));
  } finally {
    f.close();
  }
});

test("正常执行期间锁文件存在且只有自己的 pid，结束后消失", async () => {
  const f = setup();
  try {
    let seen = null;
    const done = await f.manager.locked(async () => {
      seen = fs.readFileSync(f.lock, "utf8");
      return "ok";
    });
    assert.equal(done, "ok");
    assert.equal(seen, String(process.pid));
    assert.equal(fs.existsSync(f.lock), false);
  } finally {
    f.close();
  }
});
