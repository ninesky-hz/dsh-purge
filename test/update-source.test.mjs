// 发行源现在是我们自己的 Gitee 仓库：默认值必须指向它，且不能再回落到已失效的上游。
import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCE_REPO, UPSTREAM_REPO, archiveZipUrl, archiveTarballUrl } from "../lib/update-net.js";
import { REPOSITORY } from "../lib/community.js";

test("update sources point at this repository", () => {
  assert.equal(SOURCE_REPO, "n-sky/dsh-purge");
  assert.equal(UPSTREAM_REPO, SOURCE_REPO);
  assert.equal(REPOSITORY, SOURCE_REPO);
});

test("archive URLs never reference the removed upstream", () => {
  for (const url of [archiveZipUrl("v1.6.36"), archiveTarballUrl("v1.6.36")]) {
    assert.match(url, /n-sky\/dsh-purge/);
    assert.doesNotMatch(url, /kingcharleslzy-ai|YuJunZhiXue/);
  }
});
