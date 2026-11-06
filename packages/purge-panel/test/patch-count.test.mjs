// 补丁计数回归：展示行会按「升级链」合并，计数必须回到 patch id。
// 真实事故（1.7.10 / DSH 0.2.2-rc.1）：面板 hero 显示 55/67，顶部条显示 64/76，
// 同一屏两个数都对不上——因为 hero 数的是 67 个展示行，不是 82 个补丁 id。
import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_PATCHES } from "../../../lib/core.js";
import {
  patchCounters,
  patchIdRowsOf,
  patchRowsOf,
  tallyPatches,
} from "../src/shared/patch-count.js";

// 与 2026-11-06 实测一致：82 条补丁，6 条本机不适用，12 条 skipped。
const SKIPPED = new Set([14, 17, 40, 54, 60, 62, 67, 74, 76, 80, 82, 91]);
const NA = new Set([28, 30, 31, 64, 65, 71]);
const MERGED = [
  [1, 2, 3],
  [5, 11, 12],
  [8, 9, 10],
  [45, 46],
  [83, 84],
  [87, 88],
];

function fixture() {
  const patch_status = {};
  for (const p of ALL_PATCHES) {
    if (NA.has(p.id)) patch_status[p.id] = "na";
    else if (SKIPPED.has(p.id)) patch_status[p.id] = "skipped";
    else patch_status[p.id] = "applied";
  }
  const mergedInto = new Map();
  for (const ids of MERGED) for (const id of ids) mergedInto.set(id, ids[0]);
  const buckets = new Map();
  for (const p of ALL_PATCHES) {
    const st = patch_status[p.id];
    if (st === "na") continue;
    const lead = mergedInto.get(p.id) || p.id;
    if (!buckets.has(lead)) buckets.set(lead, { ids: [], layer: p.layer || "" });
    buckets.get(lead).ids.push(p.id);
  }
  const patches = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([lead, bucket]) => ({
      id: lead,
      ids: bucket.ids,
      layer: bucket.layer,
      status: bucket.ids.some((id) => patch_status[id] === "applied")
        ? "applied"
        : patch_status[bucket.ids[0]],
    }));
  return { ai_base: "/fixture", patch_status, patches };
}

test("展示行合并升级链，计数仍按补丁 id", () => {
  const state = fixture();
  const rows = patchRowsOf(state);
  // 76 条适用补丁被合并成 67 行：hero 曾经的 55/67 就是数这些行得来的。
  assert.equal(rows.length, 67);
  const byRows = tallyPatches(rows);
  assert.equal(byRows.applied, 55);
  assert.equal(byRows.total, 67);
  // id 口径才是真实结论：64/76。
  const counters = patchCounters(state);
  assert.equal(counters.applied, 64);
  assert.equal(counters.total, 76);
  assert.equal(counters.notApplied, 12);
  assert.equal(counters.na, 6);
  assert.equal(counters.all, 82);
  assert.equal(patchIdRowsOf(state).length, 76);
  assert.equal(
    rows.reduce((n, r) => n + r.ids.length, 0),
    76,
    "合并行必须带齐 ids，否则无法还原 id 口径",
  );
});

test("后端 counts 优先：与顶部条同源，不再自己数行", () => {
  const counters = patchCounters({
    ai_base: "/fixture",
    patch_status: {},
    patches: [],
    patches_applied: 66,
    patches_total: 68,
    patches_skipped: 2,
    patches_pending: 0,
    patches_na: 0,
    patches_total_all: 68,
  });
  assert.equal(counters.applied, 66);
  assert.equal(counters.total, 68);
  assert.equal(counters.notApplied, 2);
});

test("na 与不适用不进入分母，但出现在「共 N 条」里", () => {
  const counters = patchCounters(fixture());
  const rows = patchIdRowsOf(fixture());
  assert.ok(!rows.some((r) => r.st === "na"));
  assert.equal(counters.total + counters.na, counters.all);
});

test("未定位宿主时所有计数归零", () => {
  const counters = patchCounters({ ai_base: "", patch_status: { 1: "applied" } });
  assert.equal(counters.located, false);
  assert.equal(counters.applied, 0);
  assert.equal(counters.total, 0);
});
