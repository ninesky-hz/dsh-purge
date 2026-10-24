// 回归：首屏「环境还没配好」对话框（.dshp-auth-*）必须有样式。
//
// 历史故障：组件用单 p 的 .dshp-auth-mask / -modal / -ops / -warn，
// 而随包样式只写了双 p 的 .dshpp-*，四个类名全不命中，遮罩退化成普通 div，
// 落在文档流顶部压住侧栏标题（1.6.51 修复）。这里把「源样式」与「构建产物」
// 两侧都钉住，避免下次重建或改前缀时又静默丢失。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(
  path.join(root, "packages/purge-panel/src/styles/base.css"),
  "utf8",
);
const bundle = fs.readFileSync(path.join(root, "client.js"), "utf8");

const SELECTORS = [
  "dshp-auth-mask",
  "dshp-auth-modal",
  "dshp-auth-ops",
  "dshp-auth-warn",
];

test("base.css 定义了组件实际使用的 .dshp-auth-* 类名", () => {
  for (const sel of SELECTORS) {
    assert.match(
      css,
      new RegExp(`\\.${sel}\\s*\\{`),
      `base.css 缺少 .${sel} 规则（组件用了单 p，别再写成 .dshpp-）`,
    );
  }
});

test("遮罩是全屏固定层并留出安全区", () => {
  const mask = css.match(/\.dshp-auth-mask\s*\{([^}]*)\}/);
  assert.ok(mask, ".dshp-auth-mask 规则缺失");
  const body = mask[1];
  assert.match(body, /position:\s*fixed/);
  assert.match(body, /inset:\s*0/);
  assert.match(body, /safe-area-inset-top/);
  assert.match(body, /overflow:\s*auto/);
});

test("构建产物里同样存在这四组样式", () => {
  for (const sel of SELECTORS) {
    assert.ok(
      bundle.includes(`.${sel} {`) || bundle.includes(`.${sel}{`),
      `client.js 缺少 .${sel} 规则（被重新构建丢了？）`,
    );
  }
  assert.ok(
    bundle.includes("position: fixed"),
    "client.js 里的遮罩丢了 position: fixed",
  );
});

test("构建产物是纯 LF（CRLF 检出不应改变 bundle 字节）", () => {
  assert.equal(bundle.includes("\r\n"), false, "client.js 出现了 CRLF");
});

test("package.json 的 test 脚本包含本文件", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.ok(
    String(pkg.scripts.test).includes("test/ui-overlay-styles.test.mjs"),
    "npm test 未登记 test/ui-overlay-styles.test.mjs",
  );
});
