// UI derived from YuJunZhiXue/dsh-purge 1.1.71 (MIT). See LICENSE.
import { h, useState } from "../shared/react.js";
import { useT } from "../shared/locale.js";
import { statusKind, statusLabel } from "./patch-status.js";

export function formatSize(bytes) {
  if (typeof bytes !== "number" || !isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return bytes + " B";
  const kb = bytes / 1024;
  return (kb >= 100 ? Math.round(kb) : kb.toFixed(1)) + " KB";
}

export function noticeNode(notice) {
  if (!notice || notice.kind === "idle" || !notice.text) return null;
  return h(
    "span",
    {
      className:
        "dshpp-notice " + (notice.kind === "error" ? "is-bad" : "is-ok"),
    },
    notice.text,
  );
}

export function Btn(props) {
  const { kind, tiny, quiet, children, className, type, ...rest } = props;
  const cls = [
    "dshpp-btn",
    kind ? "dshpp-btn-" + kind : "dshpp-btn-ghost",
    tiny ? "dshpp-btn-tiny" : "",
    className || "",
  ]
    .filter(Boolean)
    .join(" ");
  const attrs = Object.assign({ type: type || "button", className: cls }, rest);
  if (quiet) attrs["data-quiet"] = "1";
  return h("button", attrs, children);
}

/** 折叠指示：全页同一种箭头，转 90° 表示展开。 */
export function Caret({ size = 12 } = {}) {
  return h(
    "svg",
    {
      className: "dshpp-caret",
      width: size,
      height: size,
      viewBox: "0 0 16 16",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.4,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": true,
    },
    h("path", { d: "M6 3.5L10.5 8 6 12.5" }),
  );
}

/**
 * 台账刻度：一条补丁一格。
 * 状态只影响颜色与高度，形状本身（等宽竖线）不变——它是这个面板的签名，
 * 在台账里用大号，在每组明细里用小号。
 */
export function Ticks({ rows, className }) {
  if (!rows || !rows.length) return null;
  return h(
    "div",
    { className: (className || "dshpp-ledger"), role: "presentation" },
    rows.map((row) =>
      h("i", {
        key: row.id,
        className: "dshpp-tick is-" + row.kind,
        title: `#${row.id} ${row.label || row.kind}`,
      }),
    ),
  );
}

export function Pill({ value, label }) {
  const t = useT();
  return h(
    "span",
    { className: "dshpp-pill is-" + statusKind(value) },
    label || statusLabel(value, t),
  );
}

/**
 * 名词解释：DSH 自己的设置页也是"标题 + 小问号 + 悬浮说明"，
 * 这里用同构的轻量实现（不依赖 react-dom portal，右侧栏/整页都能用）。
 */
export function HelpTip({ title, children, label }) {
  const [open, setOpen] = useState(false);
  return h(
    "span",
    { className: "dshpp-help" },
    h(
      "button",
      {
        type: "button",
        className: "dshpp-help-btn",
        "aria-label": (label || title || "说明") + "（查看说明）",
        "aria-expanded": open ? "true" : "false",
        onMouseEnter: () => setOpen(true),
        onMouseLeave: () => setOpen(false),
        onFocus: () => setOpen(true),
        onBlur: () => setOpen(false),
        onClick: (e) => {
          e.preventDefault();
          setOpen((v) => !v);
        },
      },
      h(
        "svg",
        {
          viewBox: "0 0 16 16",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.3,
          strokeLinecap: "round",
          "aria-hidden": true,
        },
        h("circle", { cx: 8, cy: 8, r: 6.2 }),
        h("path", { d: "M6.4 6.2a1.7 1.7 0 113.1 1c-.4.5-1.1.8-1.1 1.6" }),
        h("path", { d: "M8 11.4v.1" }),
      ),
    ),
    open
      ? h(
          "span",
          { className: "dshpp-tip", role: "tooltip" },
          title ? h("b", null, title) : null,
          children ? h("span", null, children) : null,
        )
      : null,
  );
}
