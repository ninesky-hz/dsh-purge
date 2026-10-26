// Anchors pinned to the real DSH 0.2.1-rc.1 host source. If the host changes shape,
// these fixtures and the patch table must be updated together — that is the point.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_PATCHES, applyReplacementsToText } from "../lib/core.js";

const patch = (id) => {
  const found = ALL_PATCHES.find((p) => p.id === id);
  assert.ok(found, `patch #${id} must exist`);
  return found;
};

const WEB_PROMPT = "const WEB_SURFACE_PROMPT = `You are interacting with the user through the DeepSeek Harness Web GUI whose URL the runtime context names. When the user refers to \"this page\", \"this GUI\", or \"this app\" without naming another target, they mean this GUI. The browser provides no implicit DOM, route, or screenshot context. The client-plugin HMR receiver is active, but client-plugin changes reload without a refresh only while \\`pnpm run dev:web\\` is also running from this same checkout to rebuild their bundles; verify that watcher before promising automatic updates. Every other change — the apps/web shell and plain packages — requires rebuilding the affected Web artifacts and verifying this existing URL after a page refresh. Starting another server does not update this GUI. The apps/web Vite entry builds the shell but is not a standalone application because only dsh web injects window.__DSH_BOOT__. Do not start a replacement server unless the user asks; if one is needed, use a managed background job and verify its exact URL.`;";

const SYSTEM_PROMPT_ASSEMBLE = "\t\tconst transformed = await this.ctx.waterfall(scopeTarget(this, scope), \"system-prompt/assemble\", assembly, context, () => Promise.resolve(assembly));\n\t\tif (completeSection === void 0 && !runtimeContextSuppressed) return transformed;\n\t\tconst requiredContexts = new Set([...contextByName.values()].filter((entry) => entry.required === true).map((entry) => entry.name));\n\t\treturn {\n\t\t\t...transformed,\n\t\t\tsections: completeSection === void 0 ? transformed.sections : [completeSection],\n\t\t\tcontexts: runtimeContextSuppressed ? transformed.contexts.filter((entry) => requiredContexts.has(entry.name)) : transformed.contexts\n\t\t};\n";

const CONVERSATION_APPEND = "\t\t\tappend(record) {\n\t\t\t\tconst event = record.event;\n\t\t\t\tif (this.inputs.has(event.seq)) return \"none\";\n\t\t\t\tif (this.revised.size > 0) this.revised.clear();\n\t\t\t\tthis.inputs.set(event.seq, record);\n";

test("0.2.1 web-surface prompt: #32 neutralizes the product name, #53 drops identity and do-not-start", () => {
  const branded = WEB_PROMPT;
  assert.ok(branded.includes("DeepSeek Harness Web GUI"));
  const after32 = applyReplacementsToText(branded, patch(32)).text;
  assert.ok(!after32.includes("DeepSeek Harness Web GUI"));
  assert.ok(after32.includes("the local web GUI whose URL the runtime context names"));
  const after53 = applyReplacementsToText(after32, patch(53)).text;
  assert.ok(after53.includes("Local web GUI: its URL is named in the runtime context."));
  assert.ok(!after53.includes("Do not start a replacement server"));
  // legacy paragraph text inside the same file must survive: it is used to match old sessions.
  const legacy = 'suffix: "Do not start a replacement server unless the user asks; if one is needed, use a managed background job and verify its exact URL."';
  const kept = applyReplacementsToText(legacy, patch(53)).text;
  assert.equal(kept, legacy);
  // idempotent
  assert.equal(applyReplacementsToText(after53, patch(32)).changed, false);
  assert.equal(applyReplacementsToText(after53, patch(53)).changed, false);
});

test("0.2.1 complete preset still carries the dsh-purge inject after assemble", () => {
  const out = applyReplacementsToText(SYSTEM_PROMPT_ASSEMBLE, patch(40));
  assert.equal(out.changed, true);
  assert.ok(out.text.includes("const dshPurgeSections ="));
  assert.ok(out.text.includes("[...dshPurgeRest, ...dshPurgeSections]"));
  assert.ok(out.text.includes("const requiredContexts = new Set("));
  assert.ok(out.text.includes("requiredContexts.has(entry.name)"));
  assert.equal(applyReplacementsToText(out.text, patch(40)).changed, false);
});

test("0.2.1 rewind marker drops sent messages on append", () => {
  const out = applyReplacementsToText(CONVERSATION_APPEND, patch(77));
  assert.equal(out.changed, true);
  assert.ok(out.text.includes("if (isRewindMarker(event)) {"));
  assert.ok(out.text.includes("return this.replaceWindow(entries, this.hasMore);"));
  assert.ok(out.text.includes("if (this.revised.size > 0) this.revised.clear();"));
  assert.equal(applyReplacementsToText(out.text, patch(77)).changed, false);
});

test("1.7.5 host boot: an inactive ctx during shutdown exits quietly instead of raising fatal", () => {
  const source =
    "\tconst { ctx } = await application;\n" +
    "\tcontrol.updateTasks = installDesktopUpdateTaskControl(ctx);\n" +
    "\tcontrol.quitInspection = installDesktopQuitInspection(ctx);\n";
  const out = applyReplacementsToText(source, patch(91));
  assert.equal(out.changed, true);
  assert.ok(out.text.includes("[dsh-purge] boot 途中收到 shutdown"));
  assert.ok(out.text.includes('error.code === "INACTIVE_EFFECT"'));
  assert.ok(out.text.includes('stopping !== void 0'));
  assert.ok(out.text.includes('await send({ type: "shutdown-complete" })'));
  assert.ok(out.text.includes("throw error;"));
  // 幂等：已打过就不再改
  assert.equal(applyReplacementsToText(out.text, patch(91)).changed, false);
});

test("undo and chained patches declare their settle semantics", () => {
  assert.equal(patch(80).settleWhenAbsent, true);
  assert.equal(patch(88).chainedAfter, 87);
});

test("0.2.1 ask_user_question keeps the requested wait and caps only -1", () => {
  const src = "\t\tasync execute(args, exec) {\n\t\t\tconst timeout = validateTimeout(args.timeout ?? defaultTimeout);\n\t\t\tvalidateQuestionIds(args.questions);";
  const out = applyReplacementsToText(src, patch(89));
  assert.equal(out.changed, true);
  assert.ok(out.text.includes("args.timeout === -1 ? 300 : (args.timeout ?? defaultTimeout)"));
  assert.ok(!out.text.includes("const timeout = 1;"));
  assert.equal(applyReplacementsToText(out.text, patch(89)).changed, false);
});

// 1.7.6 / #92 — 试验性 Inspector 的状态帧预算：快照压线就抛错，宿主 fatal。
const INSPECTOR_TREE_PUBLISH =
  "\t\t\tdisposers.push(publishCordisTree(ctx, handle.source, {\n" +
  "\t\t\t\tmaxNodes: spec.maxCordisNodes,\n" +
  "\t\t\t\tmaxBytes: spec.maxSourceFrameBytes - 4096\n" +
  "\t\t\t}));\n";

const INSPECTOR_FRAME_DEFAULT = "const DEFAULT_MAX_SOURCE_FRAME_BYTES = 128 * 1024;";

test("1.7.6 inspector: the Cordis tree snapshot keeps state-record headroom (#92)", () => {
  const source = INSPECTOR_TREE_PUBLISH + INSPECTOR_FRAME_DEFAULT + "\n";
  const out = applyReplacementsToText(source, patch(92));
  assert.equal(out.changed, true);
  // 快照预算留出 record 包装余量
  assert.ok(out.text.includes("maxBytes: spec.maxSourceFrameBytes - 8192"));
  assert.ok(!out.text.includes("maxBytes: spec.maxSourceFrameBytes - 4096"));
  // 默认帧预算抬到 1 MiB：2048 节点的树不再被裁
  assert.ok(out.text.includes("const DEFAULT_MAX_SOURCE_FRAME_BYTES = 1024 * 1024;"));
  assert.ok(!out.text.includes("DEFAULT_MAX_SOURCE_FRAME_BYTES = 128 * 1024"));
  assert.ok(out.text.includes("[dsh-purge] #92"));
  // 幂等：已打过就不再改
  assert.equal(applyReplacementsToText(out.text, patch(92)).changed, false);
});

test("1.7.6 inspector: only the inspector call site is touched, other - 4096 budgets survive", () => {
  const unrelated = "\t\t\tconst budget = spec.maxSourceFrameBytes - 4096;\n";
  const out = applyReplacementsToText(unrelated, patch(92));
  assert.equal(out.changed, false);
  assert.equal(out.text, unrelated);
});

test("1.7.6 inspector: #92 margin satisfies InspectorSourceBuffer.setState arithmetic", () => {
  // 与 @deepseek-ai/dsh-experimental-inspector 一致：
  //   stateFits() => json([{monotonicMs,topic,payload}]) + 4096 <= maxSourceFrameBytes
  // 而采集器只按 maxSourceFrameBytes - margin 裁剪快照。record 比 payload 多几十字节，
  // 所以 margin 必须大于这段包装，否则快照压在上限附近时 setState 必抛。
  const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");
  const frame = 128 * 1024;
  const overhead = 4096;
  const wrapper = jsonBytes({ monotonicMs: 1234.5, topic: "cordis/tree", payload: {} }) - jsonBytes({});
  assert.ok(wrapper > 32, `state record wrapper costs ${wrapper} bytes`);
  // 旧预算：快照正好裁到 frame - overhead，加上包装就超了 → 抛 source state exceeds ...
  const oldBudget = frame - 4096;
  assert.ok(oldBudget + wrapper + overhead > frame);
  // 新预算：同样的落差下仍然装得下
  const newBudget = frame - 8192;
  assert.ok(newBudget + wrapper + overhead <= frame);
});

