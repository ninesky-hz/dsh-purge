import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_REPOSITORY,
  gitUrls,
  listReleasesUrl,
  normalizeRepository,
  releaseByTagUrl,
  releaseRepository,
  releaseSource,
  releaseUrls,
  sourceHosts,
  sourceLabel,
  tagsUrl,
  updateProvider,
} from "../lib/update-source.js";
import { UPDATE_HOSTS, githubHeaders } from "../lib/update-http.js";

test("默认仍是上游 GitHub 源", () => {
  assert.equal(releaseRepository({}), DEFAULT_REPOSITORY);
  assert.equal(updateProvider({}), "github");
  assert.equal(listReleasesUrl({}), `https://api.github.com/repos/${DEFAULT_REPOSITORY}/releases?per_page=20`);
  assert.equal(sourceLabel({}), `GitHub ${DEFAULT_REPOSITORY}`);
});

test("owner/repo 形式只换仓库，不换平台", () => {
  const env = { PURGE_UPDATE_REPO: "n-sky/dsh-purge" };
  assert.equal(releaseRepository(env), "n-sky/dsh-purge");
  assert.equal(updateProvider(env), "github");
  assert.equal(listReleasesUrl(env), "https://api.github.com/repos/n-sky/dsh-purge/releases?per_page=20");
});

test("仓库地址里的域名推断出 Gitee", () => {
  const env = { PURGE_UPDATE_REPO: "https://gitee.com/n-sky/dsh-purge.git" };
  assert.deepEqual(normalizeRepository(env.PURGE_UPDATE_REPO), { repo: "n-sky/dsh-purge", provider: "gitee" });
  assert.equal(updateProvider(env), "gitee");
  assert.equal(releaseRepository(env), "n-sky/dsh-purge");
});

test("Gitee 源的列表、元数据、标签、资产 URL 全部跟着切", () => {
  const env = { PURGE_UPDATE_REPO: "n-sky/dsh-purge", PURGE_UPDATE_PROVIDER: "gitee" };
  assert.equal(listReleasesUrl(env), "https://gitee.com/api/v5/repos/n-sky/dsh-purge/releases?per_page=20");
  assert.equal(releaseByTagUrl("v1.6.50", env), "https://gitee.com/api/v5/repos/n-sky/dsh-purge/releases/tags/v1.6.50");
  assert.equal(tagsUrl(50, env), "https://gitee.com/api/v5/repos/n-sky/dsh-purge/tags?per_page=50");
  assert.deepEqual(releaseUrls("v1.6.50", "dsh-purge-community-1.6.50.tgz", env), {
    url: "https://gitee.com/n-sky/dsh-purge/releases/tag/v1.6.50",
    asset: "https://gitee.com/n-sky/dsh-purge/releases/download/v1.6.50/dsh-purge-community-1.6.50.tgz",
    sums: "https://gitee.com/n-sky/dsh-purge/releases/download/v1.6.50/SHA256SUMS.txt",
  });
  assert.deepEqual(gitUrls(env), ["git+https://gitee.com/n-sky/dsh-purge.git", "https://gitee.com/n-sky/dsh-purge.git"]);
  assert.ok(sourceHosts(env).includes("gitee.com"));
  assert.equal(sourceLabel(env), "Gitee n-sky/dsh-purge");
  assert.equal(releaseSource(env).name, "gitee");
});

test("配置错误立即报错，不静默退回默认源", () => {
  assert.throws(() => updateProvider({ PURGE_UPDATE_PROVIDER: "gitlab" }), /PURGE_UPDATE_PROVIDER/);
  assert.throws(() => releaseRepository({ PURGE_UPDATE_REPO: "not a repo" }), /PURGE_UPDATE_REPO/);
});

test("传输层接受 Gitee 主机并按 provider 选择认证方式", () => {
  assert.ok(UPDATE_HOSTS.has("gitee.com"));
  assert.ok(UPDATE_HOSTS.has("file.gitee.com"));
  const gitee = githubHeaders(new URL("https://gitee.com/api/v5/repos/n-sky/dsh-purge/releases"), {}, { GITEE_TOKEN: "T" });
  assert.equal(gitee.authorization, "token T");
  const github = githubHeaders(new URL("https://api.github.com/repos/a/b/releases"), {}, { GITHUB_TOKEN: "G" });
  assert.equal(github.authorization, "Bearer G");
  const anon = githubHeaders(new URL("https://gitee.com/api/v5/repos/a/b/releases"), {}, {});
  assert.equal(anon.authorization, undefined);
});

test("scp 形式的地址也能识别 Gitee", () => {
  assert.deepEqual(normalizeRepository("git@gitee.com:n-sky/dsh-purge.git"), { repo: "n-sky/dsh-purge", provider: "gitee" });
});
