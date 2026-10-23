// 应用入口必须共用 prepareApplyHost：插件版本变了要先干净重解包。
// 面板工具（purge_apply）与重启前预检曾直接拿 gatherState 的 ai_base 去洗，
// 于是 1.6.47 的「升级后重解包」只在 CLI 路径生效，工具应用仍在老解包树上增量打补丁，
// 留下新版已删除的改写（例如 1.1.72 的 tool-result pruning disable、hide-console import）。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { prepareApplyHost } from "../lib/core.js";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");

test("prepareApplyHost 以 forApply 解析宿主并补写解包戳", () => {
  assert.equal(typeof prepareApplyHost, "function");
  const src = read("../lib/core.js");
  const body = src.slice(src.indexOf("export async function prepareApplyHost"));
  assert.match(body.slice(0, 500), /resolveOfficialAiBase\(aiBase, \{ forApply: true \}\)/);
  assert.match(body.slice(0, 500), /writeUnpackedAsarStamp\(located\.handoff\.archive\)/);
});

test("重启前预检走同一个入口", () => {
  const src = read("../lib/core.js");
  const body = src.slice(src.indexOf("export async function ensureHostClean"));
  assert.match(body.slice(0, 800), /await prepareApplyHost\(findAiBase\(\)\)/);
  assert.doesNotMatch(body.slice(0, 800), /await resolveOfficialAiBase\(findAiBase\(\)\)/);
});

test("purge_apply 工具在打补丁之前解析宿主", () => {
  const src = read("../lib/index.js");
  const start = src.indexOf('name: "purge_apply"');
  assert.ok(start > 0, "找不到 purge_apply 工具注册");
  const toolBody = src.slice(start, src.indexOf('name: "purge_revert"'));
  const prep = toolBody.indexOf("core.prepareApplyHost(");
  const patch = toolBody.indexOf("core.applyPatchesAllHosts(");
  assert.ok(prep > 0, "purge_apply 必须先调用 core.prepareApplyHost");
  assert.ok(patch > prep, "prepareApplyHost 必须在 applyPatchesAllHosts 之前");
});

test("CLI 与该 HTTP 应用入口复用同一入口，不各自解析", () => {
  const src = read("../lib/index.js");
  const cli = src.slice(src.indexOf('case "apply":'), src.indexOf('case "revert":'));
  assert.ok(cli.indexOf("core.prepareApplyHost(") > 0, "CLI apply 应调用 prepareApplyHost");
  assert.ok(
    cli.indexOf("core.prepareApplyHost(") < cli.indexOf("core.applyPatchesAllHosts("),
    "CLI apply 先解析宿主再打补丁",
  );
});

test("purge-community apply 转发的原版 CLI 也先解析宿主", () => {
  const bin = read("../bin/dsh-purge.js");
  const body = bin.slice(bin.indexOf('if (mode === "--apply")'), bin.indexOf("applyPatchesAllHosts("));
  assert.match(body, /core\.prepareApplyHost\(state\.ai_base\)/);
});
