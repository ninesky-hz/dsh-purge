// UI derived from YuJunZhiXue/dsh-purge 1.1.71 (MIT). See LICENSE.

/**
 * 界面版本一律来自后端上报的运行时事实，不在面板里写死。
 *
 * 历史坑：徽标曾经渲染构建期常量 __PANEL_VERSION__。1.7.9 发版漏跑 build:client，
 * bundle 里烙着的还是 1.7.8，装的是 1.7.9、面板却显示 1.7.8，还弹一条
 * 「界面与后端不一致」。现在：
 *   - installedVersion(info)  = 后端 runningVersion()，即真正装着的版本；
 *   - bundleVersion(info)     = 后端读 client.js 头部 marker，即界面代码是哪版构建的；
 * 两者都来自运行时，界面自己不再输出任何固定版本号。
 */
export function installedVersion(info) {
  if (!info) return "";
  return String(info.plugin_version || info.version || "")
    .trim()
    .replace(/^v/i, "");
}

export function bundleVersion(info) {
  if (!info) return "";
  return String(info.panel_version || "")
    .trim()
    .replace(/^v/i, "");
}

/** 徽标文本：后端未响应时留空占位，绝不回退到某个写死的版本。 */
export function versionBadge(info, community = true) {
  const ver = installedVersion(info);
  const prefix = community ? "社区版" : "独立界面";
  return ver ? prefix + " " + ver : prefix;
}

/** 界面 bundle 与运行中的插件不是同一版时返回两者，否则 null。 */
export function bundleDrift(info) {
  const installed = installedVersion(info);
  const bundle = bundleVersion(info);
  if (!installed || !bundle || installed === bundle) return null;
  return { installed, bundle };
}

export function splitListedVersion(raw) {
  const text = String(raw || "")
    .trim()
    .replace(/^v/i, "");
  const cut = text.split("-");
  const core = String(cut[0] || "")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  return {
    core: [core[0] || 0, core[1] || 0, core[2] || 0],
    pre: cut.slice(1).join("-"),
  };
}

export function listedVersionNewer(remote, local) {
  if (!remote || !local || String(remote) === String(local)) return false;
  const a = splitListedVersion(remote);
  const b = splitListedVersion(local);
  for (let i = 0; i < 3; i += 1) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i];
  }
  if (a.pre && !b.pre) return false;
  if (!a.pre && b.pre) return true;
  return a.pre > b.pre;
}

export function listedCeiling(versions, localVer) {
  let best = "";
  const rows = (versions || []).slice();
  const local = String(localVer || "").replace(/^v/i, "");
  if (
    local &&
    !/(?:^|[-._])(beta|rc|pre|preview|test)(?:\d|$|[-._])/i.test(local)
  ) {
    rows.push({ channel: "stable", version: local });
  }
  for (const item of rows) {
    if (!item || item.channel === "beta") continue;
    const ver = String(item.version || "").replace(/^v/i, "");
    if (
      !/^\d+\.\d+\.\d+/.test(ver) ||
      /(?:^|[-._])(beta|rc|pre|preview|test)(?:\d|$|[-._])/i.test(ver)
    )
      continue;
    if (!best || listedVersionNewer(ver, best)) best = ver;
  }
  return best;
}

export function keepListedVersion(item, _ceiling) {
  const ver = String((item && (item.version || item.ref || item.id)) || "");
  if (!item) return false;
  if (item.ref === "beta" || item.id === "beta") return true;
  if (item.channel === "beta") return false;
  if (/(?:^|[-._])(beta|rc|pre|preview|test)(?:\d|$|[-._])/i.test(ver))
    return false;
  return true;
}

export function preferListed(list, localVer, pin) {
  const pinned = pin ? (list || []).find((item) => item.ref === pin) : null;
  if (pinned) return pinned;
  const ver = String(localVer || "").replace(/^v/i, "");
  const same = (list || []).filter(
    (item) => ver && String(item.version || "").replace(/^v/i, "") === ver,
  );
  if (same.length) {
    return (
      same.find((item) => item.current) ||
      same.find((item) => item.latest) ||
      same[0]
    );
  }
  return (
    (list || []).find((item) => item.current) ||
    (list || []).find((item) => item.latest) ||
    (list || [])[0] ||
    null
  );
}

export function versionChoiceLabel(item, tr) {
  const ver = String((item && item.version) || "").replace(/^v/i, "");
  const base = ver ? "v" + ver : (item && (item.label || item.ref)) || "—";
  if (item && item.current) return base + " · " + tr("update.current");
  if (item && item.latest) return base + " · " + tr("update.tip");
  return base;
}
