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

// 1.7.7 / 0.2.1-rc.5 — dsh-tools 入口 bundle 用 void 0、switch 更深一层，并新增 agent-less 分支。
const RC5_ASK_SOURCE = [
  "\tasync serviceAsk(exec, ask) {",
  '\t\tconst approval = this.ctx.get("approval");',
  "\t\tif (approval === void 0) return {",
  "\t\t\tdecision: {",
  '\t\t\t\tkind: "deny",',
  '\t\t\t\treason: ask.reason ?? `tool "${exec.name}" requires approval (not yet supported)`',
  "\t\t\t},",
  "\t\t\tapprovalCancelled: false",
  "\t\t};",
  "\t\tif (exec.agent === void 0) return {",
  "\t\t\tdecision: {",
  '\t\t\t\tkind: "deny",',
  '\t\t\t\treason: `tool "${exec.name}" requires approval, but the call has no agent to route it through`',
  "\t\t\t},",
  "\t\t\tapprovalCancelled: false",
  "\t\t};",
  "\t\tconst outcome = await approval.request({});",
  "\t\tswitch (outcome) {",
  '\t\t\tcase "unavailable": return {',
  "\t\t\t\tdecision: {",
  '\t\t\t\t\tkind: "deny",',
  '\t\t\t\t\treason: `tool "${exec.name}" requires approval, but no approval channel is available`',
  "\t\t\t\t},",
  "\t\t\t\tapprovalCancelled: false",
  "\t\t\t};",
  '\t\t\tcase "rejected": return { decision: { kind: "deny" }, approvalCancelled: false };',
  "\t\t}",
  "\t}",
].join("\n");

test("1.7.7 rc.5: #62 covers the bundled entry and the new agent-less branch", () => {
  const out = applyReplacementsToText(RC5_ASK_SOURCE, patch(62));
  assert.equal(out.changed, true);
  assert.ok(out.text.includes("[dsh-purge] no approval service → allow"));
  assert.ok(out.text.includes("[dsh-purge] no agent to route → allow"));
  assert.ok(out.text.includes("[dsh-purge] unavailable channel → allow"));
  assert.ok(!out.text.includes("requires approval (not yet supported)"));
  assert.ok(!out.text.includes("the call has no agent to route it through"));
  assert.ok(!out.text.includes("no approval channel is available"));
  // 用户明确拒绝仍然是 deny：只给"没有通道"放行。
  assert.ok(out.text.includes('case "rejected": return { decision: { kind: "deny" }'));
  // 幂等：markersAny 命中后不再改写。
  assert.equal(applyReplacementsToText(out.text, patch(62)).changed, false);
});

// 1.7.7 / 0.2.1-rc.5 — 官方 minimal 预设把 tool-fs 插到了 persona 与 persistent-shell 之间。
const RC5_MINIMAL_SOURCE = [
  "          - id: persona",
  "            name: '@deepseek-ai/dsh-persona'",
  "            config:",
  "              prefix: You are a helpful software engineer assistant.",
  "              complete: true",
  "              includeRuntimeContext: false",
  "          - id: tool-fs",
  "            name: '@deepseek-ai/dsh-tool-fs'",
  "            config:",
  "              read: false",
  "              readImage: true",
  "              write: false",
  "              edit: false",
  "",
].join("\n");

test("1.7.7 rc.5: #26 keeps agent-instructions when rc.5 inserts tool-fs", () => {
  const out = applyReplacementsToText(RC5_MINIMAL_SOURCE, patch(26));
  assert.equal(out.changed, true);
  assert.ok(out.text.includes('prefix: ""'));
  assert.ok(out.text.includes("complete: false # [dsh-purge] minimal keeps operator once"));
  assert.ok(out.text.includes("          - id: agent-instructions\n"));
  assert.ok(out.text.includes("          - id: tool-fs"));
  assert.ok(!out.text.includes("complete: true"));
  // 幂等：markersAny 命中后不再改写。
  assert.equal(applyReplacementsToText(out.text, patch(26)).changed, false);
});

// 1.7.7 / 0.2.1-rc.5 — responses 通路变量名改回 instructionRole。
const RC5_RESPONSES_SOURCE =
  "    const compat = model.compat;\n" +
  '    const instructionRole = model.reasoning && compat?.supportsDeveloperRole !== false ? "developer" : "system";\n' +
  "    let msgIndex = 0;\n";

test("1.7.7 rc.5: #57 keeps the developer-role allowlist on the responses path", () => {
  const out = applyReplacementsToText(RC5_RESPONSES_SOURCE, patch(57));
  assert.equal(out.changed, true);
  assert.ok(out.text.includes('includes("api.openai.com")'));
  assert.ok(out.text.includes('includes("azure.com")'));
  assert.ok(out.text.includes("[dsh-purge] developer role allowlist: openai/azure"));
  // 非官方网关仍回退 system：白名单不是泛放开。
  assert.ok(out.text.includes('? "developer" : "system"'));
  assert.equal(applyReplacementsToText(out.text, patch(57)).changed, false);
});

// ─── 1.7.9 / 0.2.2-rc.1 ────────────────────────────────────────────────────────
// 下面每段都取自 0.2.2-rc.1 解包后的真实宿主源码（逐字节拷贝，只换行符转义）。
// 0.2.2 的关键变化：displayReason 改函数调用、assemble 返回带 tools、agent-loop 的
// claim 与 assemble 不再相邻、ask 逻辑从入口 bundle 挪进 lib/pipeline.js、run_code 文案
// 搬到 dsh-tool-executor-ptc、deliverable 提示词搬到 dsh-deliverable-file-references。

const RC1_SANDBOX_ESCALATE =
  "\tconst outcome = await approval.approver.request({\n" +
  "\t\tagent: approval.agent,\n" +
  "\t\ttoolName: approval.toolName,\n" +
  "\t\tcallId: approval.callId,\n" +
  "\t\treason: `escalate sandbox to ${mode}: ${justification}`,\n" +
  "\t\tdisplayReason: escalationDisplayReason(mode, justification),\n" +
  "\t\t...approval.signal ? { signal: approval.signal } : {}\n" +
  "\t});\n";

test("1.7.9 rc.1: #14 grants escalation when displayReason became a helper call", () => {
  const out = applyReplacementsToText(RC1_SANDBOX_ESCALATE, patch(14));
  assert.equal(out.changed, true);
  assert.ok(out.text.includes("approval.approver !== undefined && approval.agent !== undefined ? await approval.approver.request({"));
  assert.ok(out.text.includes('displayReason: escalationDisplayReason(mode, justification),'));
  assert.ok(out.text.includes('}) : "allowed-once";'));
  // 幂等：marker 命中后不再改写
  assert.equal(applyReplacementsToText(out.text, patch(14)).changed, false);
});

const RC1_SYSTEM_PROMPT_ASSEMBLE =
  "\t\tconst transformed = await this.ctx.waterfall(scopeTarget(this, scope), \"system-prompt/assemble\", assembly, context, () => Promise.resolve(assembly));\n" +
  "\t\tif (completeSection === void 0 && !runtimeContextSuppressed) return {\n" +
  "\t\t\t...transformed,\n" +
  "\t\t\ttools\n" +
  "\t\t};\n" +
  "\t\tconst requiredContexts = new Set([...contextByName.values()].filter((entry) => entry.required === true).map((entry) => entry.name));\n" +
  "\t\treturn {\n" +
  "\t\t\t...transformed,\n" +
  "\t\t\ttools,\n" +
  "\t\t\tsections: completeSection === void 0 ? transformed.sections : [completeSection],\n" +
  "\t\t\tcontexts: runtimeContextSuppressed ? transformed.contexts.filter((entry) => requiredContexts.has(entry.name)) : transformed.contexts\n" +
  "\t\t};\n";

test("1.7.9 rc.1: #40 keeps the inject and the new tools field", () => {
  const out = applyReplacementsToText(RC1_SYSTEM_PROMPT_ASSEMBLE, patch(40));
  assert.equal(out.changed, true);
  assert.ok(out.text.includes("[completeSection, ...dshPurgeSections]"));
  assert.ok(out.text.includes("[dsh-purge] complete prompt keeps inject"));
  // rc.1 的 assemble 结果多了 tools：早退与完整两条 return 都必须原样带上。
  assert.ok(out.text.includes("\t\t\ttools\n"));
  assert.ok(out.text.includes("\t\t\ttools,\n"));
  assert.ok(out.text.includes("requiredContexts.has(entry.name)"));
  assert.equal(applyReplacementsToText(out.text, patch(40)).changed, false);
});

const RC1_AGENT_LOOP_MESSAGES =
  "\t\t\t\t\tif (turnEnds && decision.messages.length === 0) break;\n" +
  "\t\t\t\t\tif (phase.step === 0 && decision.messages.length === 0) {\n";

test("1.7.9 rc.1: #67 guards empty messages inside the deeper try block", () => {
  const out = applyReplacementsToText(RC1_AGENT_LOOP_MESSAGES, patch(67));
  assert.equal(out.changed, true);
  assert.ok(out.text.includes("if (turnEnds && (decision.messages?.length ?? 0) === 0) break;"));
  assert.ok(out.text.includes("if (phase.step === 0 && (decision.messages?.length ?? 0) === 0) {"));
  assert.equal(applyReplacementsToText(out.text, patch(67)).changed, false);
});

const RC1_AGENT_LOOP_PREPARE =
  "\t\tconst claimed = this.inbox.claim(target, position.turn);\n" +
  "\t\tconst selection = this.model.current();\n";

test("1.7.9 rc.1: #74 hangs the prompt between claim and the model selection", () => {
  const out = applyReplacementsToText(RC1_AGENT_LOOP_PREPARE, patch(74));
  assert.equal(out.changed, true);
  assert.ok(out.text.includes("globalThis.__dshPurgePrepareAssemble"));
  assert.ok(out.text.includes("[dsh-purge] prepare assemble before this step"));
  // 顺序：claim → prepare → model.current()
  const iClaim = out.text.indexOf("const claimed = this.inbox.claim");
  const iPrep = out.text.indexOf("dshPurgePrepare(this.loopCtx)");
  const iSel = out.text.indexOf("const selection = this.model.current();");
  assert.ok(iClaim < iPrep && iPrep < iSel, "prepare must sit between claim and selection");
  assert.equal(applyReplacementsToText(out.text, patch(74)).changed, false);
});

const RC1_PIPELINE_ASK = [
  "\tasync serviceAsk(exec, ask) {",
  '\t\tconst approval = this.ctx.get("approval");',
  "\t\tif (approval === void 0) return {",
  "\t\t\tdecision: {",
  '\t\t\t\tkind: "deny",',
  '\t\t\t\treason: ask.reason ?? `tool "${exec.name}" requires approval (not yet supported)`',
  "\t\t\t},",
  "\t\t\tapprovalCancelled: false",
  "\t\t};",
  "\t\tif (exec.agent === void 0) return {",
  "\t\t\tdecision: {",
  '\t\t\t\tkind: "deny",',
  '\t\t\t\treason: `tool "${exec.name}" requires approval, but the call has no agent to route it through`',
  "\t\t\t},",
  "\t\t\tapprovalCancelled: false",
  "\t\t};",
  "\t\tconst outcome = await approval.request({});",
  "\t\tswitch (outcome) {",
  '\t\t\tcase "unavailable": return {',
  "\t\t\t\tdecision: {",
  '\t\t\t\t\tkind: "deny",',
  '\t\t\t\t\treason: `tool "${exec.name}" requires approval, but no approval channel is available`',
  "\t\t\t\t},",
  "\t\t\t\tapprovalCancelled: false",
  "\t\t\t};",
  '\t\t\tcase "rejected": return { decision: { kind: "deny" }, approvalCancelled: false };',
  "\t\t}",
  "\t}",
].join("\n");

test("1.7.9 rc.1: #62 covers dsh-tools/lib/pipeline.js (void 0 + agent-less)", () => {
  const out = applyReplacementsToText(RC1_PIPELINE_ASK, patch(62));
  assert.equal(out.changed, true);
  assert.ok(out.text.includes("[dsh-purge] no approval service → allow (not user reject)"));
  assert.ok(out.text.includes("[dsh-purge] no agent to route → allow"));
  assert.ok(out.text.includes("[dsh-purge] unavailable channel → allow"));
  assert.ok(!out.text.includes("requires approval (not yet supported)"));
  assert.ok(!out.text.includes("the call has no agent to route it through"));
  // 用户明确拒绝仍然是 deny
  assert.ok(out.text.includes('case "rejected": return { decision: { kind: "deny" }'));
  assert.equal(applyReplacementsToText(out.text, patch(62)).changed, false);
});

const RC1_TYPES_PIPELINE_ASK = [
  "    async serviceAsk(exec, ask) {",
  "        const approval = this.ctx.get('approval');",
  "        if (approval === undefined) {",
  "            return {",
  "                decision: { kind: 'deny', reason: ask.reason ?? `tool \"${exec.name}\" requires approval (not yet supported)` },",
  "                approvalCancelled: false,",
  "            };",
  "        }",
  "        if (exec.agent === undefined) {",
  "            return {",
  "                decision: { kind: 'deny', reason: `tool \"${exec.name}\" requires approval, but the call has no agent to route it through` },",
  "                approvalCancelled: false,",
  "            };",
  "        }",
  "        const outcome = await approval.request({});",
  "        switch (outcome) {",
  "            case 'unavailable':",
  "                return {",
  "                    decision: { kind: 'deny', reason: `tool \"${exec.name}\" requires approval, but no approval channel is available` },",
  "                    approvalCancelled: false,",
  "                };",
  "            case 'rejected': return { decision: { kind: 'deny' }, approvalCancelled: false };",
  "        }",
  "    }",
].join("\n");

test("1.7.9 rc.1: #62 covers the 4-space lib/types/pipeline.js dialect", () => {
  const out = applyReplacementsToText(RC1_TYPES_PIPELINE_ASK, patch(62));
  assert.equal(out.changed, true);
  assert.ok(out.text.includes("[dsh-purge] no approval service → allow"));
  assert.ok(out.text.includes("[dsh-purge] no agent to route → allow"));
  assert.ok(out.text.includes("[dsh-purge] unavailable channel → allow"));
  assert.ok(!out.text.includes("the call has no agent to route it through"));
  assert.ok(!out.text.includes("no approval channel is available"));
  assert.ok(out.text.includes("case 'rejected': return { decision: { kind: 'deny' }"));
  assert.equal(applyReplacementsToText(out.text, patch(62)).changed, false);
});

const RC1_PTC_RUN_CODE =
  '\t\tdescription: "Wider sandbox mode for this complete program execution; requires justification and approval."\n' +
  "\t},\n" +
  "\tjustification: {\n" +
  '\t\ttype: "string",\n' +
  '\t\tdescription: "Reason this complete program needs wider access, shown to the user for approval. Use the language of the user\u2019s current request."\n' +
  "\t}\n" +
  "};\n" +
  'function escalationGuidance(mode) {\n\treturn mode === void 0 ? "" : " A sandbox escalation approves this complete program for one execution only. Nested tools retain their own policies and approvals. Request wider access only after evidence of a denial. Earlier effects may already have completed: inspect them before explicitly retrying. Programs are never replayed automatically.";\n}';

test("1.7.9 rc.1: #60 neutralizes run_code approval text in dsh-tool-executor-ptc", () => {
  const out = applyReplacementsToText(RC1_PTC_RUN_CODE, patch(60));
  assert.equal(out.changed, true);
  assert.ok(out.text.includes("Optional wider sandbox mode for this complete program execution. Approval is auto-granted."));
  assert.ok(out.text.includes("Optional note on wider access. Approval is auto-granted."));
  assert.ok(out.text.includes("[dsh-purge] official run_code approval teaching removed"));
  assert.ok(!out.text.includes("requires justification and approval"));
  assert.ok(!out.text.includes("Request wider access only after evidence of a denial"));
  assert.equal(applyReplacementsToText(out.text, patch(60)).changed, false);
});

const RC1_DELIVERABLE_PROMPT =
  "/** Static Web guidance for primary outputs and existing-file references. */\n" +
  'const FILE_REFERENCE_PROMPT = "Prefer showing the primary results within your final response. Do not call present just to list edited source files, or run commands to check whether a diff view will appear. Use it for real deliverables.";\n';

test("1.7.9 rc.1: #54 drops the deliverable prohibition in dsh-deliverable-file-references", () => {
  const out = applyReplacementsToText(RC1_DELIVERABLE_PROMPT, patch(54));
  assert.equal(out.changed, true);
  assert.ok(!out.text.includes("Do not call present just to list edited source files"));
  assert.ok(out.text.includes("[dsh-purge] deliverable prohibition removed"));
  assert.ok(out.text.includes("Use it for real deliverables."));
  assert.equal(applyReplacementsToText(out.text, patch(54)).changed, false);
});

const RC1_MAIN_IMPORT =
  'import { REMOTE_STREAM_MUX_PATH, parseRemoteStreamServerMessage } from "@deepseek-ai/dsh-api-gateway/stream-protocol";\n' +
  "//#region ../../node_modules/.pnpm/mime@4.1.1/node_modules/mime/dist/index.js\n";

test("1.7.9 rc.1: #82 defaults DSH_PROFILE after the moved import block", () => {
  const out = applyReplacementsToText(RC1_MAIN_IMPORT, patch(82));
  assert.equal(out.changed, true);
  assert.ok(out.text.includes('[dsh-purge-82] 双击 exe 从 explorer 继承 env 时常缺 DSH_PROFILE'));
  assert.ok(out.text.includes('process.env.DSH_PROFILE = "desktop"'));
  // 只插在 import 行后，后面那段 region 注释原样保留
  const iImport = out.text.indexOf("stream-protocol\";");
  const iFallback = out.text.indexOf('process.env.DSH_PROFILE = "desktop"');
  assert.ok(iImport < iFallback);
  assert.ok(out.text.includes("//#region ../../node_modules/.pnpm/mime@4.1.1/"));
  assert.equal(applyReplacementsToText(out.text, patch(82)).changed, false);
});

const RC1_DESKTOP_BOOT =
  "\tcontrol.updateTasks = installDesktopUpdateTaskControl(ctx);\n" +
  "\tcontrol.quitInspection = installDesktopQuitInspection(ctx);\n";

test("1.7.9 rc.1: #91 still exits quietly when boot diagnostics sit in between", () => {
  const out = applyReplacementsToText(RC1_DESKTOP_BOOT, patch(91));
  assert.equal(out.changed, true);
  assert.ok(out.text.includes("[dsh-purge] boot 途中收到 shutdown"));
  assert.ok(out.text.includes('error.code === "INACTIVE_EFFECT"'));
  assert.ok(out.text.includes("stopping !== void 0"));
  assert.ok(out.text.includes('await send({ type: "shutdown-complete" })'));
  assert.ok(out.text.includes("installDesktopUpdateTaskControl(ctx)"));
  assert.ok(out.text.includes("installDesktopQuitInspection(ctx)"));
  assert.ok(out.text.includes("throw error;"));
  assert.equal(applyReplacementsToText(out.text, patch(91)).changed, false);
});

