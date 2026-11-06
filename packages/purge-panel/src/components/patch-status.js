// UI derived from YuJunZhiXue/dsh-purge 1.1.71 (MIT). See LICENSE.
import { h, useState } from "../shared/react.js";
import { useT } from "../shared/locale.js";
import {
  GROUP_ORDER,
  LAYER_GROUP,
  layerKeyOf,
  patchIdRowsOf,
  patchRowsOf,
  tallyPatches,
} from "../shared/patch-count.js";
import { Pill } from "./primitives.js";

export { GROUP_ORDER, LAYER_GROUP, patchRowsOf, tallyPatches };

export function statusKind(st) {
  if (st === "applied" || st === "already") return "ok";
  if (st === "pending") return "wait";
  if (st === "unmatched") return "bad";
  if (st === "na") return "ok";
  if (
    st === "missing_file" ||
    st === "skipped" ||
    st === "unlocated" ||
    st === "off"
  )
    return "miss";
  return "bad";
}

export function statusLabel(st, t) {
  if (st === "applied" || st === "already") return t("status.applied");
  if (st === "off") return t("status.skipped");
  if (st === "pending") return t("status.pending");
  if (st === "unmatched") return t("status.unmatched");
  if (st === "skipped") return t("status.skipped");
  if (st === "missing_file") return t("skip");
  if (st === "unlocated") return t("status.unlocated");
  if (st === "na") return t("status.na");
  return st || t("unknown");
}

export function shimKind(v) {
  if (v === "patched" || v === "n/a") return "ok";
  if (v === "original") return "wait";
  if (v === "missing" || !v) return "miss";
  return "bad";
}

/** 合并行的 id 范围：`#1–3`；单条仍是 `#17`。 */
export function idRangeLabel(ids) {
  const list = (ids || []).filter((n) => Number.isFinite(n));
  if (!list.length) return "";
  const min = Math.min(...list);
  const max = Math.max(...list);
  return min === max ? "#" + min : "#" + min + "–" + max;
}

export function PatchGroups({ state }) {
  const t = useT();
  const [open, setOpen] = useState({});
  if (!state || !state.patch_status)
    return h("div", { className: "dshpp-skel", style: { height: 120 } });
  if (!state.ai_base) return null;
  // 表格行按升级链合并，分组计数仍按 id：两条口径不能互相污染。
  const rowGroups = new Map();
  for (const row of patchRowsOf(state)) {
    const key = layerKeyOf(row.layer);
    if (!rowGroups.has(key)) rowGroups.set(key, []);
    rowGroups.get(key).push(row);
  }
  const idGroups = new Map();
  for (const row of patchIdRowsOf(state)) {
    const key = layerKeyOf(row.layer);
    if (!idGroups.has(key)) idGroups.set(key, []);
    idGroups.get(key).push(row);
  }
  return GROUP_ORDER.filter((key) => rowGroups.has(key)).map((key) => {
    const rows = rowGroups
      .get(key)
      .slice()
      .sort((a, b) => a.id - b.id);
    const tally = tallyPatches(idGroups.get(key));
    const notes = [];
    if (tally.pending)
      notes.push(t("metric.pendingShort", { n: tally.pending }));
    if (tally.unmatched)
      notes.push(t("metric.unmatchedShort", { n: tally.unmatched }));
    if (tally.skipped > 0 && tally.skipped !== tally.unmatched)
      notes.push(t("metric.skipShort", { n: tally.skipped }));
    const expanded = !!open[key];
    return h(
      "div",
      { key: key, className: "dshpp-group" },
      h(
        "button",
        {
          type: "button",
          className: "dshpp-group-h",
          "aria-expanded": expanded ? "true" : "false",
          onClick: () =>
            setOpen((prev) => Object.assign({}, prev, { [key]: !prev[key] })),
        },
        h("strong", null, t("group." + key)),
        h(
          "span",
          { className: "dshpp-count" },
          tally.applied +
            "/" +
            tally.total +
            (notes.length ? " · " + notes.join(" · ") : ""),
        ),
      ),
      expanded
        ? h(
            "table",
            { className: "dshpp-table" },
            h(
              "thead",
              null,
              h(
                "tr",
                null,
                h("th", null, "#"),
                h("th", null, t("table.patch")),
                h("th", null, t("table.status")),
              ),
            ),
            h(
              "tbody",
              null,
              rows.map((r) =>
                h(
                  "tr",
                  { key: r.id },
                  h("td", { className: "dshpp-id" }, idRangeLabel(r.ids)),
                  h("td", null, t("patch." + r.id)),
                  h("td", null, h(Pill, { value: r.st })),
                ),
              ),
            ),
          )
        : null,
    );
  });
}
