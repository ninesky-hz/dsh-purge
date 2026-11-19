// 计数口径回归：本机这版宿主**没有可改目标**的补丁，不进「是否生效」的分母。
// 真实事故（2026-11-14 / DSH 0.2.2-rc.3）：72/76 旁边挂「4 条对不上锚点」，
// 而这 4 条（#56 #76 #77 #80）在本机本来就没有目标可改——不是锚点漂移，也不是没生效。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_PATCHES,
  patchSettledHere,
  tallyPatchState,
} from "../lib/core.js";

const byId = (id) => ALL_PATCHES.find((p) => p.id === id);

function allApplied() {
  const status = {};
  for (const p of ALL_PATCHES) status[p.id] = "applied";
  return status;
}

test("settleWhenAbsent 的 skipped 归入不适用（#56 #77 #80）", () => {
  for (const id of [56, 77, 80]) {
    const p = byId(id);
    assert.ok(p, `#${id} 必须存在`);
    assert.equal(p.settleWhenAbsent, true, `#${id} 应带 settleWhenAbsent`);
    assert.equal(patchSettledHere(p, "skipped"), true, `#${id} 的 skipped 是「无目标」，不是失效`);
  }
});

test("#76 的 not_needed（预设正文已干净）同样归入不适用", () => {
  assert.equal(patchSettledHere(byId(76), "not_needed"), true);
  // 但预设正文里真的还留着官方身份句时，它必须留在分母里被盯着。
  assert.equal(patchSettledHere(byId(76), "skipped"), false);
});

test("没有 settleWhenAbsent 的 skipped 仍是真正的未生效", () => {
  const p = ALL_PATCHES.find((item) => !item.settleWhenAbsent && item.id !== 76);
  assert.equal(patchSettledHere(p, "skipped"), false);
});

test("可选补丁的目标没装算不适用；必需补丁缺文件仍留在分母", () => {
  const optional = ALL_PATCHES.find((p) => p.optional && !p.settleWhenAbsent);
  const required = ALL_PATCHES.find(
    (p) => !p.optional && !p.settleWhenAbsent && !(p.surfaces && p.surfaces.length),
  );
  assert.equal(patchSettledHere(optional, "missing_file"), true);
  assert.equal(patchSettledHere(required, "missing_file"), false);
});

test("rc.3 现场：4 条无目标补丁从分母里出去，notApplied 归零", () => {
  const status = allApplied();
  status[56] = "skipped";
  status[77] = "skipped";
  status[80] = "skipped";
  status[76] = "not_needed";

  const base = tallyPatchState(allApplied(), { located: true });
  const now = tallyPatchState(status, { located: true });

  assert.deepEqual(now.settledIds.sort((a, b) => a - b), [56, 76, 77, 80]);
  assert.equal(now.settled, 4);
  assert.equal(now.total, base.total - 4, "分母减去 4 条无目标补丁");
  assert.equal(now.na, base.na + 4, "它们归到不适用，不是失效");
  assert.equal(now.applied, base.applied - 4, "只有这 4 条从「生效」里挪走");
  assert.equal(now.applied, now.total, "剩下的全部在位 —— hero 就是 72/72，不再挂未生效数");
  assert.equal(now.skipped, 0, "不再有「对不上」的 skipped");
  assert.equal(now.total + now.na, ALL_PATCHES.length, "分母 + 不适用 = 全部补丁");
});

test("没定位到宿主时分母为 0，全部记不适用", () => {
  const t = tallyPatchState({}, { located: false });
  assert.equal(t.total, 0);
  assert.equal(t.na, ALL_PATCHES.length);
  assert.equal(t.settled, 0);
});
