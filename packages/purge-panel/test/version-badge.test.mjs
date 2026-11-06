// 面板版本必须来自后端上报的运行时事实：徽标不再自带固定版本号。
// 背景：1.7.9 发版漏跑 build:client，装的是 1.7.9、徽标却咬着 bundle 里的 1.7.8。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  installedVersion,
  bundleVersion,
  versionBadge,
  bundleDrift,
} from "../src/shared/versions.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");
const bundle = fs.readFileSync(path.join(root, "client.js"), "utf8");

test("badge follows the version the backend reports as installed", () => {
  assert.equal(versionBadge({ plugin_version: "1.7.10" }), "社区版 1.7.10");
  assert.equal(
    versionBadge({ plugin_version: "1.7.10" }, false),
    "独立界面 1.7.10",
  );
  assert.equal(versionBadge({ plugin_version: "v1.7.10" }), "社区版 1.7.10");
  assert.equal(versionBadge({ version: "1.7.10" }), "社区版 1.7.10");
});

test("badge never invents a version before the backend answers", () => {
  assert.equal(versionBadge(null), "社区版");
  assert.equal(versionBadge({}), "社区版");
  assert.equal(installedVersion({ plugin_version: "" }), "");
  assert.equal(bundleVersion({}), "");
});

test("drift only fires when the served bundle is a different build", () => {
  assert.equal(
    bundleDrift({ plugin_version: "1.7.10", panel_version: "1.7.10" }),
    null,
  );
  assert.equal(bundleDrift({ plugin_version: "1.7.10" }), null);
  assert.equal(bundleDrift({ panel_version: "1.7.9" }), null);
  assert.deepEqual(
    bundleDrift({ plugin_version: "1.7.10", panel_version: "1.7.9" }),
    { installed: "1.7.10", bundle: "1.7.9" },
  );
  assert.equal(bundleVersion({ panel_version: "v1.7.9" }), "1.7.9");
});

test("shipped bundle carries a marker and no fixed badge version", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const head = bundle.slice(0, 512);
  assert.match(head, new RegExp(`^// panel-version: ${pkg.version}$`, "m"));
  // 旧写法把 "\u793E\u533A\u7248 1.7.8" 直接编进 bundle；现在只允许变量拼接。
  assert.doesNotMatch(bundle, /(?:\\u793E\\u533A\\u7248|社区版) \d+\.\d+\.\d+/);
  assert.match(bundle, /panel_version/);
});
