// 1.7.4：桌面已解包时点「应用」不再自动重启。
// 自动重启与用户手动重启撞车会让宿主在 boot 途中被 shutdown，
// 桌面宿主随后在 installDesktopUpdateTaskControl 里拿到已 dispose 的 ctx，
// 抛 CordisError: cannot create effect on inactive context（INACTIVE_EFFECT）。
import test from "node:test";
import assert from "node:assert/strict";

const { applyShouldRestart, isInactiveContextError } = await import("../lib/settle-policy.js");

test("sealed desktop still restarts: the asar swap needs that quit", () => {
  assert.equal(
    applyShouldRestart({ sealed: true, surface: "desktop", appliedCount: 58, complete: true }),
    true,
  );
});

test("unpacked desktop does not auto-restart", () => {
  assert.equal(applyShouldRestart({ surface: "desktop", complete: true, appliedCount: 58 }), false);
  assert.equal(applyShouldRestart({ surface: "desktop", appliedCount: 3 }), false);
  assert.equal(applyShouldRestart({ surface: "desktop", promptReady: true }), false);
});

test("web and unknown surface keep the previous rule", () => {
  assert.equal(applyShouldRestart({ surface: "web", appliedCount: 2 }), true);
  assert.equal(applyShouldRestart({ surface: "", complete: true }), true);
  assert.equal(applyShouldRestart({ surface: "web", appliedCount: 0 }), false);
});

test("INACTIVE_EFFECT is recognised as an inactive-context error", () => {
  assert.equal(isInactiveContextError({ code: "INACTIVE_EFFECT" }), true);
  assert.equal(isInactiveContextError(new Error("cannot create effect on inactive context")), true);
  assert.equal(isInactiveContextError(new Error("unrelated failure")), false);
  assert.equal(isInactiveContextError(null), false);
});
