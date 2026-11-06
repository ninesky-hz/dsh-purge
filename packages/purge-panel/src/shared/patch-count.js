// 补丁计数口径：一条补丁 = 一个 id。
// 展示表可以按「升级链」把多条补丁合并成一行（见 core.js 的 PATCH_DISPLAY_GROUPS），
// 但计数必须回到 id —— 否则 hero 的 55/67 和顶部条的 64/76 会在同一屏互相打脸。
// 本文件不依赖 react，可与面板 bundle 分开单测（见 test/patch-count.test.mjs）。

export const LAYER_GROUP = {
  提示词: "prompt",
  代码: "code",
  工具: "tools",
  "0.1.5 兼容": "compat",
  "0.2.0 兼容": "dsh20",
};

export const GROUP_ORDER = ["prompt", "code", "tools", "compat", "dsh20"];

export function layerKeyOf(layer) {
  return LAYER_GROUP[layer] || "code";
}

/**
 * 逐条补丁行（id 口径，权威）。
 * patch_status 是后端按 id 算出来的结论；display 行只用来提供 layer 与合并关系。
 */
export function patchIdRowsOf(state) {
  if (!state || !state.ai_base) return [];
  const statuses = state.patch_status || {};
  const layerOf = new Map();
  for (const p of Array.isArray(state.patches) ? state.patches : []) {
    const ids = Array.isArray(p.ids) && p.ids.length ? p.ids : [p.id];
    for (const raw of ids) {
      const id = Number(raw);
      if (Number.isFinite(id)) layerOf.set(id, p.layer || "");
    }
  }
  const rows = [];
  for (const [raw, st] of Object.entries(statuses)) {
    const id = Number(raw);
    if (!Number.isFinite(id)) continue;
    if (!st || st === "na") continue;
    rows.push({ id, st, layer: layerOf.get(id) || "" });
  }
  if (rows.length) return rows.sort((a, b) => a.id - b.id);
  // 后端没给 patch_status（老面板契约 / 测试夹具）时，退回合并行：至少不能让计数器归零。
  return (Array.isArray(state.patches) ? state.patches : [])
    .flatMap((p) => {
      const ids = Array.isArray(p.ids) && p.ids.length ? p.ids : [p.id];
      const st = p.status || "missing_file";
      return ids
        .map(Number)
        .filter((id) => Number.isFinite(id))
        .filter(() => st !== "na")
        .map((id) => ({ id, st, layer: p.layer || "" }));
    })
    .sort((a, b) => a.id - b.id);
}

/** 展示表行（可能把升级链合并成一行）；每行都带 ids，方便标注覆盖范围。 */
export function patchRowsOf(state) {
  if (!state || !state.ai_base) return [];
  const fromList = Array.isArray(state.patches) ? state.patches : null;
  if (!fromList) return patchIdRowsOf(state);
  return fromList
    .map((p) => {
      const id = Number(p.id);
      const ids = (Array.isArray(p.ids) && p.ids.length ? p.ids : [p.id])
        .map(Number)
        .filter((n) => Number.isFinite(n));
      return {
        id,
        ids: ids.length ? ids : [id],
        st: p.status || "missing_file",
        layer: p.layer || "",
      };
    })
    .filter((r) => r.st && r.st !== "na" && Number.isFinite(r.id));
}

export function tallyPatches(rows) {
  const out = { applied: 0, pending: 0, unmatched: 0, skipped: 0, total: 0 };
  for (const row of rows || []) {
    out.total += 1;
    if (row.st === "applied" || row.st === "already") out.applied += 1;
    else if (row.st === "pending") out.pending += 1;
    else if (row.st === "unmatched") out.unmatched += 1;
    else out.skipped += 1;
  }
  return out;
}

const numOr = (value, fallback) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/**
 * 一处口径算给所有计数位用：hero、明细标题、顶部条。
 * 后端给的 patches_* 才是「磁盘上的真实结论」，逐条 tally 只在后端缺字段时兜底。
 */
export function patchCounters(state) {
  const located = !!(state && state.ai_base);
  const statuses = (state && state.patch_status) || {};
  const tally = tallyPatches(located ? patchIdRowsOf(state) : []);
  // 老后端/夹具可能没带 patches_na，就按 patch_status 里的 na 数兜底。
  const naFallback = Object.values(statuses).filter((st) => st === "na").length;
  const total = located ? numOr(state.patches_total, tally.total) : 0;
  const applied = located ? numOr(state.patches_applied, tally.applied) : 0;
  const pending = located ? numOr(state.patches_pending, tally.pending) : 0;
  const na = located ? numOr(state.patches_na, naFallback) : 0;
  const all = located ? numOr(state.patches_total_all, total + na) : 0;
  return {
    located,
    applied,
    pending,
    na,
    all,
    total,
    // 分母只算本机适用的；没应用、也没待应用的都归到「未生效」，不猜具体原因。
    notApplied: Math.max(0, total - applied - pending),
    skipped: tally.skipped,
    unmatched: tally.unmatched,
  };
}
