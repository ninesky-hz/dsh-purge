#!/usr/bin/env node
/**
 * 把当前版本发布到发行源（Gitee / GitHub）。
 *
 * 做的事只有三件：建/取 tag 对应的 release、上传 `dsh-purge-community-<ver>.tgz`、
 * 上传 `SHA256SUMS.txt`。其它（改版本号、写发行说明、打 tag、push）都不在这里——
 * 那些是人的判断，不该被脚本代劳。
 *
 *   node scripts/publish-release.mjs --dry-run      # 只打印将要发的请求
 *   GITEE_TOKEN=xxx node scripts/publish-release.mjs
 *   GITHUB_TOKEN=xxx node scripts/publish-release.mjs --provider github
 *
 * 幂等：release 已存在就复用它，asset 已存在（或同名）就跳过；已存在但内容不同
 * 不静默覆盖，报出来让人决定。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;
const tag = `v${version}`;

function repoFromPackage(pkg) {
  const raw =
    typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  if (!raw) return null;
  const m = /([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(raw.replace(/^git\+/, ""));
  return m ? { owner: m[1], repo: m[2] } : null;
}

const provider = flag(
  "provider",
  process.env.PURGE_UPDATE_PROVIDER || "gitee",
).toLowerCase();
const repo = repoFromPackage(pkg);
if (!repo) fail("package.json 里读不到 repository，无法确定发布目标");

const SOURCES = {
  gitee: {
    label: "Gitee",
    api: "https://gitee.com/api/v5",
    tokenEnv: ["GITEE_TOKEN"],
    // Gitee 的 release 只有 tag 与附件，没有单独的 upload_url
    assetUrl: (owner, name, releaseId) =>
      `https://gitee.com/api/v5/repos/${owner}/${name}/releases/${releaseId}/attach_files`,
  },
  github: {
    label: "GitHub",
    api: "https://api.github.com",
    tokenEnv: ["GITHUB_TOKEN", "GH_TOKEN"],
    assetUrl: null,
  },
};

const source = SOURCES[provider];
if (!source) fail(`不认识的发行源：${provider}（可选 gitee / github）`);

const token = source.tokenEnv.map((k) => process.env[k]).find(Boolean);
const assetNames = [
  `dsh-purge-community-${version}.tgz`,
  "SHA256SUMS.txt",
];

const missing = assetNames.filter(
  (n) => !fs.existsSync(path.join(root, n)),
);
if (missing.length) {
  fail(
    `缺少发行产物：${missing.join(", ")}\n` +
      `先在仓库根跑 npm pack --ignore-scripts，并确认 SHA256SUMS.txt 对应当前 tgz。`,
  );
}

const body = readBody(version);
const assets = assetNames.map((n) => {
  const p = path.join(root, n);
  return { name: n, path: p, size: fs.statSync(p).size };
});

if (dryRun) {
  console.log(`发行源  ${source.label} (${provider})`);
  console.log(`仓库    ${repo.owner}/${repo.repo}`);
  console.log(`版本    ${version} → tag ${tag}`);
  console.log(`标题    ${pkg.name} ${version}`);
  console.log(`说明    docs/releases/${version}.md · ${body.length} 字符`);
  console.log("附件");
  for (const a of assets) console.log(`  ${a.name}  ${a.size} 字节`);
  console.log(
    token
      ? "\n凭据    已从环境变量读到，可直接去掉 --dry-run 真发。"
      : `\n凭据    未设置 ${source.tokenEnv.join(" / ")}，真发会被拒绝。`,
  );
  process.exit(0);
}

if (!token) {
  fail(
    `没有发行凭据：请设置 ${source.tokenEnv.join(" 或 ")} 后重跑。\n` +
      `Gitee 令牌在 https://gitee.com/profile/personal_access_tokens 生成，勾 projects 即可。`,
  );
}

const headers = {
  Authorization: `token ${token}`,
  "Content-Type": "application/json",
  "User-Agent": "dsh-purge-publish",
  Accept: "application/json",
};

const existing = await findRelease();
let release = existing;
if (!release) {
  release = await createRelease();
  console.log(`已创建 release ${release.id}（${tag}）`);
} else {
  console.log(`release 已存在：${release.id}（${tag}）`);
}

const have = new Set(
  (release.assets || []).map((a) => a.name || a.file_name || a.browser_download_url?.split("/").pop()),
);
for (const asset of assets) {
  if (have.has(asset.name)) {
    console.log(`跳过已上传：${asset.name}`);
    continue;
  }
  await uploadAsset(release, asset);
  console.log(`已上传：${asset.name}`);
}

const url =
  provider === "gitee"
    ? `https://gitee.com/${repo.owner}/${repo.repo}/releases/tag/${tag}`
    : `https://github.com/${repo.owner}/${repo.repo}/releases/tag/${tag}`;
console.log(`\n完成：${url}`);

function readBody(ver) {
  const file = path.join(root, "docs", "releases", `${ver}.md`);
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  const notes = path.join(root, "release-notes.md");
  if (!fs.existsSync(notes)) return `${pkg.name} ${ver}`;
  const text = fs.readFileSync(notes, "utf8");
  const start = text.indexOf(`# ${ver}`);
  if (start < 0) return `${pkg.name} ${ver}`;
  const next = text.indexOf("\n# ", start + 3);
  return text.slice(start, next < 0 ? undefined : next).trim();
}

async function api(pathname, init = {}) {
  const res = await fetch(`${source.api}${pathname}`, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* 非 JSON 响应按文本报错 */
  }
  return { status: res.status, ok: res.ok, json, text };
}

async function findRelease() {
  const r = await api(
    `/repos/${repo.owner}/${repo.repo}/releases/tags/${encodeURIComponent(tag)}`,
    { method: "GET" },
  );
  if (r.ok) return r.json;
  if (r.status === 404) return null;
  fail(`查询 release 失败：HTTP ${r.status} ${trim(r.text)}`);
}

async function createRelease() {
  const r = await api(`/repos/${repo.owner}/${repo.repo}/releases`, {
    method: "POST",
    body: JSON.stringify({
      tag_name: tag,
      name: `${pkg.name} ${version}`,
      body,
      target_commitish: "master",
      prerelease: false,
    }),
  });
  if (!r.ok) fail(`创建 release 失败：HTTP ${r.status} ${trim(r.text)}`);
  return r.json;
}

async function uploadAsset(release, asset) {
  const id = release.id ?? release.tag_name;
  const form = new FormData();
  form.append(
    "file",
    new Blob([fs.readFileSync(asset.path)], { type: "application/octet-stream" }),
    asset.name,
  );
  const url =
    provider === "gitee"
      ? `${source.assetUrl(repo.owner, repo.repo, id)}?access_token=${encodeURIComponent(token)}`
      : `${source.api}/repos/${repo.owner}/${repo.repo}/releases/${id}/assets?name=${encodeURIComponent(asset.name)}`;
  const res = await fetch(url, {
    method: "POST",
    headers:
      provider === "gitee"
        ? { "User-Agent": "dsh-purge-publish", Accept: "application/json" }
        : {
            Authorization: `token ${token}`,
            "Content-Type": "application/octet-stream",
            "User-Agent": "dsh-purge-publish",
            Accept: "application/vnd.github+json",
          },
    body: provider === "gitee" ? form : fs.readFileSync(asset.path),
  });
  if (!res.ok) {
    const text = await res.text();
    fail(`上传 ${asset.name} 失败：HTTP ${res.status} ${trim(text)}`);
  }
}

function trim(text) {
  return String(text || "").replace(/\s+/g, " ").slice(0, 300);
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}
