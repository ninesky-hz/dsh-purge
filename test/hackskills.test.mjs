// 随包知识库 `skills/hackskills`（101 个目录束技能）。
//
// 这些断言挡四类回归：
//   1. 载荷坏了 —— 少了 SKILL.md、frontmatter 的 name 与目录不一致、description 空，
//      宿主会直接把该技能忽略（skill-filesystem 只认 name + description），用户看到的是"技能凭空消失"。
//   2. 相对链接指到不存在的文件 —— 模型会照着链接去读，读不到就中断推理。
//   3. 同步没落地 / 落地了但每次启动都重写 —— 前者技能加载不到，后者白磨磁盘。
//   4. 老用户预设没有 `redteam/hackskills` 那一行 —— 知识库进了作用域才有 `<available_skills>`，
//      自愈必须是"只加一行"，不能覆盖用户改过的其它内容。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installHackskillLibrary, installPreset, packagePaths } from "../lib/redteam/index.js";
import { skillLibraryOf } from "../lib/redteam/skill-availability.js";
import { skillCatalogInternals } from "../lib/redteam/ui.js";

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HACKSKILLS_DIR_EXPR = "dshHomePath('redteam/hackskills')";
const bundled = () => packagePaths().hackskills;

function bundleIds() {
  return fs
    .readdirSync(bundled(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function walkMarkdown(dir, rel = "", out = []) {
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const next = rel ? path.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) walkMarkdown(dir, next, out);
    else if (entry.name.endsWith(".md")) out.push(next);
  }
  return out;
}

function frontmatter(text) {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end < 0) return null;
  const body = text.slice(3, end);
  const pick = (key) => {
    const hit = new RegExp("^" + key + ":\\s*(.+)$", "m").exec(body);
    return hit ? hit[1].trim().replace(/^['"]|['"]$/g, "") : "";
  };
  return { name: pick("name"), description: pick("description") };
}

/** 沙箱：临时 DSH_HOME，顺带把 homedir() 也掰到临时目录，别写到用户真实 ~/.dsh。 */
function withTempHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-hackskills-"));
  const env = { DSH_HOME: process.env.DSH_HOME, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME };
  process.env.DSH_HOME = home;
  process.env.USERPROFILE = home;
  process.env.HOME = home;
  try {
    return fn(home);
  } finally {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test("知识库载荷是 101 个可解析的目录束技能", () => {
  const ids = bundleIds();
  assert.equal(ids.length, 101, "101 个技能目录");
  for (const id of ids) {
    const file = path.join(bundled(), id, "SKILL.md");
    assert(fs.existsSync(file), `${id}/SKILL.md 存在`);
    const meta = frontmatter(fs.readFileSync(file, "utf8"));
    assert(meta, `${id}/SKILL.md frontmatter 完整`);
    assert.equal(meta.name, id, `${id} 的 name 与目录一致`);
    assert(NAME_RE.test(meta.name), `${id} 的 name 是 kebab-case`);
    assert(meta.description.length > 0, `${id} 有 description`);
  }
  // 上游 MIT 许可必须随包（再分发条件），溯源文件必须给人看懂从哪来
  const license = fs.readFileSync(path.join(bundled(), "LICENSE"), "utf8");
  assert(license.includes("MIT"), "LICENSE 是 MIT");
  assert(license.includes("VillanCh"), "LICENSE 保留上游版权人");
  const source = JSON.parse(fs.readFileSync(path.join(bundled(), "SOURCE.json"), "utf8"));
  assert.equal(source.schema, "dsh-purge-hackskills/v1");
  assert.equal(source.upstream.commit, "a3ab667");
  assert.equal(source.license.spdx, "MIT");
  assert(Array.isArray(source.localEdits) && source.localEdits.length >= 2, "本地改动有记录");
});

test("知识库里的相对链接没有断链", () => {
  const files = walkMarkdown(bundled());
  assert(files.length > 150, "155 个 markdown");
  const broken = [];
  let total = 0;
  for (const rel of files) {
    const text = fs.readFileSync(path.join(bundled(), rel), "utf8");
    for (const hit of text.matchAll(/\]\(([^)\s#]+\.md)(?:#[^)]*)?\)/g)) {
      const target = hit[1];
      if (/^[a-z]+:/i.test(target)) continue;
      total += 1;
      const resolved = path.resolve(path.dirname(path.join(bundled(), rel)), target);
      if (!fs.existsSync(resolved)) broken.push(`${rel} -> ${target}`);
    }
  }
  assert(total > 500, `相对链接 ${total} 条`);
  assert.deepEqual(broken, [], "没有断链");
});

test("技能库分类：知识库不被错判成官方或红队", () => {
  const at = (p) => skillLibraryOf({ path: p });
  assert.equal(at("D:/dsh/skills/hackskills/hack/SKILL.md"), "hackskills");
  assert.equal(at("D:/dsh/redteam/hackskills/hack/SKILL.md"), "hackskills");
  assert.equal(at("D:/dsh/skills/redteam/active-scan.md"), "redteam");
  assert.equal(at("D:/dsh/redteam/skills/active-scan.md"), "redteam");
  // 官方技能目录在 /skills 根下：不能被 hackskills 规则抢走
  assert.equal(at("D:/dsh/skills/grill-me/SKILL.md"), "official");
  assert.equal(at("D:/elsewhere/x.md"), "");
  // 注册表直接给了 library 就照用
  assert.equal(skillLibraryOf({ library: "hackskills", path: "D:/whatever" }), "hackskills");
});

test("同步到 $DSH_HOME/redteam/hackskills，并且第二次不重写", () => {
  withTempHome((home) => {
    const first = installHackskillLibrary();
    assert.equal(first.action, "updated");
    assert.equal(first.bundles, 101);
    assert.equal(first.files, 155, "只同步 .md，不搬 LICENSE/SOURCE.json");
    assert.equal(first.written, 155);
    const target = path.join(home, "redteam", "hackskills");
    assert.equal(first.path, target, "主目标是 $DSH_HOME/redteam/hackskills");
    assert(fs.existsSync(path.join(target, "hack", "SKILL.md")), "总路由落盘");
    assert.equal(
      fs.readdirSync(target, { withFileTypes: true }).filter((e) => e.isDirectory()).length,
      101,
    );
    assert.equal(fs.existsSync(path.join(target, "LICENSE")), false, "许可文件不进技能目录");

    const second = installHackskillLibrary();
    assert.equal(second.action, "kept", "内容一致就不重写");
    assert.equal(second.written, 0);
  });
});

test("包内预设带三行 customSkillDirs，老预设只补一行", () => {
  const template = fs.readFileSync(path.join(packagePaths().presetDir, "agent.cordis.yml"), "utf8");
  assert(template.includes(HACKSKILLS_DIR_EXPR), "模板里有知识库目录");
  assert(template.includes("dshHomePath('redteam/skills')"), "模板里仍有红队技能目录");
  assert(template.includes("dshHomePath('skills')"), "模板里仍有官方技能目录");

  withTempHome((home) => {
    const installed = installPreset({});
    assert.equal(installed.action, "installed");
    assert.equal(installed.knowledgeSkills, 101);
    const file = path.join(home, ".agent-presets", "redteam", "agent.cordis.yml");
    assert(fs.readFileSync(file, "utf8").includes(HACKSKILLS_DIR_EXPR), "新装就有这一行");

    // 模拟老版本用户：删掉知识库那一行，并留下自己的改动
    const edited = "# 我自己加的注释\n" + fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => !line.includes("redteam/hackskills"))
      .join("\n");
    fs.writeFileSync(file, edited);
    assert.equal(edited.includes(HACKSKILLS_DIR_EXPR), false);

    const repaired = installPreset({});
    assert.equal(repaired.action, "repaired");
    assert(repaired.repaired.includes("hackskills-dir"), "自愈原因是补知识库目录");
    const after = fs.readFileSync(file, "utf8");
    assert(after.includes(HACKSKILLS_DIR_EXPR), "那一行回来了");
    assert(after.includes("# 我自己加的注释"), "用户自己的改动保留");
    assert(after.includes("dshHomePath('redteam/skills')"), "原有技能目录没被动过");

    // 再跑一次不该再有可修的东西
    assert.equal(installPreset({}).action, "kept");
  });
});

test("技能页把知识库单列一库，且不按红队工具路径判可用", () => {
  const items = skillCatalogInternals.hackskillsCatalogItems();
  assert.equal(items.length, 101);
  for (const item of items.slice(0, 5)) {
    assert.equal(item.library, "hackskills");
    assert.equal(item.availability, "listed");
    assert.deepEqual(item.problems, []);
  }
  const merged = skillCatalogInternals.withBothLibraries({
    ok: true,
    items: [{ name: "active-scan", library: undefined, availability: "available", problems: [] }],
  });
  assert.equal(merged.libraries.hackskills, 101, "三库计数含知识库");
  assert.equal(merged.libraries.redteam, 1, "红队只数真红队");
  assert.equal(merged.total, merged.items.length);
  assert(merged.items.some((item) => item.name === "hack" && item.library === "hackskills"));
  // 同名去重：知识库条目不能把红队同名技能顶掉
  const dup = skillCatalogInternals.withBothLibraries({
    ok: true,
    items: [{ name: "hack", library: "redteam", availability: "available", problems: [] }],
  });
  const hack = dup.items.filter((item) => item.name === "hack");
  assert.equal(hack.length, 1);
  assert.equal(hack[0].library, "redteam");
  const read = skillCatalogInternals.readHackskill("hack");
  assert.equal(read.ok, true);
  assert(read.content.includes("SKILL"), "能读到总路由正文");
});
