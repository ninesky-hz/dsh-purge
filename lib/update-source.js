// Where the updater reads release metadata from.
//
// Defaults keep the historic behaviour: the community fork on GitHub. Two
// environment variables move that source without touching code:
//
//   PURGE_UPDATE_REPO      "owner/repo" or a repository URL (GitHub or Gitee)
//   PURGE_UPDATE_PROVIDER  "github" | "gitee" (optional; inferred from the URL)
//
// A mirror is a first-class source, not a download prefix: the release list,
// the per-tag metadata request, the tag fallback and the asset URLs all follow
// it, so a Gitee-hosted fork advertises its own versions.

export const DEFAULT_REPOSITORY = "kingcharleslzy-ai/dsh-purge";
export const DEFAULT_PROVIDER = "github";

const PROVIDERS = {
  github: {
    name: "github",
    label: "GitHub",
    tokenEnv: ["GITHUB_TOKEN", "GH_TOKEN"],
    tokenScheme: "Bearer",
    releasesUrl: (repo) => `https://api.github.com/repos/${repo}/releases?per_page=20`,
    releaseByTagUrl: (repo, ref) => `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(ref)}`,
    tagsUrl: (repo, perPage) => `https://api.github.com/repos/${repo}/tags?per_page=${perPage}`,
    releasePageUrl: (repo, ref) => `https://github.com/${repo}/releases/tag/${ref}`,
    assetBaseUrl: (repo, ref) => `https://github.com/${repo}/releases/download/${ref}`,
    gitUrls: (repo) => [`git+https://github.com/${repo}.git`, `https://github.com/${repo}.git`],
    hosts: [],
  },
  gitee: {
    name: "gitee",
    label: "Gitee",
    tokenEnv: ["GITEE_TOKEN"],
    tokenScheme: "token",
    releasesUrl: (repo) => `https://gitee.com/api/v5/repos/${repo}/releases?per_page=20`,
    releaseByTagUrl: (repo, ref) => `https://gitee.com/api/v5/repos/${repo}/releases/tags/${encodeURIComponent(ref)}`,
    tagsUrl: (repo, perPage) => `https://gitee.com/api/v5/repos/${repo}/tags?per_page=${perPage}`,
    releasePageUrl: (repo, ref) => `https://gitee.com/${repo}/releases/tag/${ref}`,
    assetBaseUrl: (repo, ref) => `https://gitee.com/${repo}/releases/download/${ref}`,
    gitUrls: (repo) => [`git+https://gitee.com/${repo}.git`, `https://gitee.com/${repo}.git`],
    // Release assets 302 to a file host; both ends must stay on the allowlist.
    hosts: ["gitee.com", "file.gitee.com", "objects.gitee.com"],
  },
};

const HOST_PROVIDERS = [
  ["github.com", "github"],
  ["gitee.com", "gitee"],
];

export function providerNames() {
  return Object.keys(PROVIDERS);
}

export function providerFor(name) {
  return PROVIDERS[name] || null;
}

/** "owner/repo", "https://gitee.com/owner/repo.git", "git@gitee.com:owner/repo" → {repo, provider}. */
export function normalizeRepository(input) {
  const raw = String(input || "").trim();
  if (!raw) return { repo: "", provider: "" };
  let provider = "";
  const scp = /^[a-z0-9._-]+@([a-z0-9.-]+):(.+)$/i.exec(raw);
  const candidate = scp ? `https://${scp[1]}/${scp[2]}` : raw;
  if (/^[a-z]+:\/\//i.test(candidate)) {
    let url;
    try {
      url = new URL(candidate);
    } catch {
      return { repo: "", provider: "" };
    }
    const host = url.hostname.toLowerCase();
    for (const [domain, name] of HOST_PROVIDERS) {
      if (host === domain || host.endsWith(`.${domain}`)) provider = name;
    }
    const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
    if (parts.length < 2) return { repo: "", provider };
    const repo = `${parts[0]}/${parts[1].replace(/\.git$/i, "")}`;
    return { repo, provider };
  }
  const repo = raw
    .replace(/^\/+/, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) return { repo: "", provider };
  return { repo, provider };
}

/** Explicit provider wins; otherwise it follows PURGE_UPDATE_REPO's URL, else GitHub. */
export function updateProvider(env = process.env) {
  const explicit = String(env.PURGE_UPDATE_PROVIDER || "").trim().toLowerCase();
  if (explicit) {
    if (!PROVIDERS[explicit]) throw Error(`PURGE_UPDATE_PROVIDER 无效（${explicit}）；可选 ${providerNames().join(" / ")}`);
    return explicit;
  }
  const { provider } = normalizeRepository(env.PURGE_UPDATE_REPO);
  return provider || DEFAULT_PROVIDER;
}

export function releaseRepository(env = process.env) {
  const configured = String(env.PURGE_UPDATE_REPO || "").trim();
  if (!configured) return DEFAULT_REPOSITORY;
  const { repo } = normalizeRepository(configured);
  if (!repo) throw Error("PURGE_UPDATE_REPO 需要形如 owner/repo 或仓库地址");
  return repo;
}

/** Resolved source: provider descriptor plus the repository it points at. */
export function releaseSource(env = process.env) {
  const provider = updateProvider(env);
  const repo = releaseRepository(env);
  return { ...PROVIDERS[provider], repo };
}

export function listReleasesUrl(env = process.env) {
  const source = releaseSource(env);
  return source.releasesUrl(source.repo);
}

export function releaseByTagUrl(ref, env = process.env) {
  const source = releaseSource(env);
  return source.releaseByTagUrl(source.repo, ref);
}

export function tagsUrl(perPage = 50, env = process.env) {
  const source = releaseSource(env);
  return source.tagsUrl(source.repo, perPage);
}

/** Release page, archive and checksum URLs for one tag — identical shape for both providers. */
export function releaseUrls(ref, assetName, env = process.env) {
  const source = releaseSource(env);
  const base = source.assetBaseUrl(source.repo, ref);
  return {
    url: source.releasePageUrl(source.repo, ref),
    asset: `${base}/${assetName}`,
    sums: `${base}/SHA256SUMS.txt`,
  };
}

export function gitUrls(env = process.env) {
  const source = releaseSource(env);
  return source.gitUrls(source.repo);
}

/** Extra hosts the transport must accept for this source (Gitee redirects assets). */
export function sourceHosts(env = process.env) {
  return releaseSource(env).hosts.slice();
}

/** Token for the active provider, if the operator configured one. */
export function sourceToken(env = process.env) {
  const source = releaseSource(env);
  for (const key of source.tokenEnv) {
    const value = String(env[key] || "").trim();
    if (value) return { token: value, scheme: source.tokenScheme };
  }
  return { token: "", scheme: source.tokenScheme };
}

/** Human label for status lines: "GitHub kingcharleslzy-ai/dsh-purge". */
export function sourceLabel(env = process.env) {
  const source = releaseSource(env);
  return `${source.label} ${source.repo}`;
}

/** GitHub and Gitee release rows share this shape; map it onto the updater's item. */
export function normalizeReleaseRow(row) {
  const ref = String(row?.tag_name || "").trim();
  const assets = Array.isArray(row?.assets) ? row.assets : [];
  return {
    ref,
    url: String(row?.html_url || ""),
    assetNamed: (name) => String(assets.find((asset) => asset?.name === name)?.browser_download_url || ""),
  };
}
