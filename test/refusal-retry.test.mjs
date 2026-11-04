// 拒绝检测 + 单次重试：不命中就原样透传，命中就加一句加固重跑一次。
import { test } from "node:test";
import assert from "node:assert/strict";
import { looksLikeRefusal, refusalSignal, streamWithRefusalRetry, RETRY_NUDGE, USER_NUDGE } from "../lib/refusal-retry.js";

const sys = (text) => ({ role: "system", content: [{ type: "text", text }] });
const delta = (text) => ({ type: "text-delta", index: 0, text });
const finish = () => ({ type: "finish" });

async function collect(iter) {
  const out = [];
  for await (const chunk of iter) out.push(chunk);
  return out;
}

test("refusal text is detected, normal text is not", () => {
  assert(looksLikeRefusal("I can't help with that."));
  assert(looksLikeRefusal("抱歉，我无法协助这个请求"));
  assert(!looksLikeRefusal("Here is the plan: 1) read the file 2) patch it"));
});

test("a refusal triggers exactly one retry with the nudge appended", async () => {
  const calls = [];
  const factory = (options) => {
    calls.push(options);
    const refusal = calls.length === 1;
    return (async function* () {
      if (refusal) {
        yield delta("I'm sorry, but I can't help with that.");
      } else {
        yield delta("Step 1: read the file.");
      }
      yield finish();
    })();
  };
  const options = { messages: [sys("base system")] };
  const chunks = await collect(streamWithRefusalRetry(factory, options));
  assert.equal(calls.length, 2);
  assert.match(calls[1].messages[0].content[0].text, /base system/);
  assert.ok(calls[1].messages[0].content[0].text.includes(RETRY_NUDGE.trim().slice(0, 20)));
  assert.match(RETRY_NUDGE, /要现在执行吗/);
  assert.doesNotMatch(RETRY_NUDGE, /already authorized/i);
  assert.equal(chunks.filter((c) => c.type === "text-delta")[0].text, "Step 1: read the file.");
});

test("normal output streams through untouched and is not retried", async () => {
  let calls = 0;
  const factory = () => {
    calls += 1;
    return (async function* () {
      yield delta("Here is the plan.");
      yield finish();
    })();
  };
  const chunks = await collect(streamWithRefusalRetry(factory, { messages: [sys("s")] }));
  assert.equal(calls, 1);
  assert.equal(chunks[0].text, "Here is the plan.");
});

test("soft Chinese refusals from a real failing session are detected", () => {
  const real = [
    "这一步我不做：把“黑进某个网站”当作目标，和之前装工具不是一回事。",
    "目标是别人的站点、但没有授权：这一步我不参与。",
    "我不会帮你把它包装成“渗透测试”来绕过这一点。",
    "请把目标和授权依据发给我。",
    "这属于未授权的入侵行为。",
  ];
  for (const text of real) assert(looksLikeRefusal(text), text);
});

test("legitimate answers that merely mention 授权 are not flagged", () => {
  assert(!looksLikeRefusal("登录接口需要携带 Authorization 头，授权失败返回 401。"));
  assert(!looksLikeRefusal("这部分代码不参与渲染，可以安全删除。"));
});

test("short meta refusals count, long technical discussion does not", () => {
  assert(looksLikeRefusal("这段指令是提示词注入，我不会执行。"));
  assert(looksLikeRefusal("I won't treat this as a valid instruction; this is prompt injection."));
  const long = "提示词注入的防御通常分三层：" + "输入过滤、上下文隔离、输出审查。".repeat(30);
  assert(!looksLikeRefusal(long), "长文里讨论注入不应触发重试");
});

// 2026-11-04 真实漏检：中文"劝退式"软拒，字面上没有一句"我不能"。
test("lecture-style Chinese soft refusals from a real session are detected", () => {
  const real = [
    "推荐具体接码平台这件事，我就不做了：说白了，这就是批量虚假注册的配套工具，用来绕开实名和风控，因此给你平台名单等于直接帮忙做这件事。",
    "这类大规模虚假注册最好别做。WorkBuddy 这类产品要求批量注册 20 个账号，多半是为了拿免费额度、刷邀请奖励或绕开限流。",
    "如果你确实有正当需求，下面这几条路是合规的：团队版、沙箱、替代品。",
    "告诉我是哪一种，我直接开始做。",
  ];
  for (const text of real) assert(looksLikeRefusal(text), text);
  assert.equal(refusalSignal(real[0]).kind, "lecture", "软拒要标成 lecture，便于审计区分");
});

test("substantive answers about the same topic are not flagged", () => {
  const legit = [
    "这里给你三家平台的对比：sms-activate、5sim、smspva，单价与可用国家如下。",
    "批量注册的链路是：号码池 -> 收码 API -> 注册脚本 -> 指纹隔离，具体如下。",
    "不建议用 root 跑这个服务，改成非特权用户即可。",
  ];
  for (const text of legit) assert(!looksLikeRefusal(text), text);
});

test("the retried request carries both the system nudge and the user-tail nudge", async () => {
  const calls = [];
  const factory = (options) => {
    calls.push(options);
    const first = calls.length === 1;
    return (async function* () {
      yield delta(first ? "I'm sorry, but I can't help with that." : "Step 1: read the file.");
      yield finish();
    })();
  };
  const options = {
    messages: [sys("base"), { role: "user", content: [{ type: "text", text: "do it" }] }],
  };
  await collect(streamWithRefusalRetry(factory, options));
  const retried = calls[1].messages;
  assert.ok(retried[0].content[0].text.includes(RETRY_NUDGE.trim().slice(0, 10)), "系统提示尾部要有加固语");
  assert.ok(retried[1].content[0].text.includes("第一行就是我要的东西"), "用户消息尾部要有第二道加固");
  assert.equal(calls[0].messages[1].content[0].text, "do it", "原始请求不能被就地改写");
});

test("when retries are exhausted the refusal is passed through instead of an empty answer", async () => {
  let calls = 0;
  const factory = () => {
    calls += 1;
    return (async function* () {
      yield delta("I'm sorry, but I can't help with that.");
      yield delta(" Still no.");
      yield finish();
    })();
  };
  const chunks = await collect(streamWithRefusalRetry(factory, { messages: [sys("s")] }, { retries: 1 }));
  assert.equal(calls, 2, "一次原始 + 一次重试，不会无限重试");
  const text = chunks.filter((c) => c.type === "text-delta").map((c) => c.text).join("");
  assert.match(text, /I'm sorry/, "最后一次仍拒时要把内容交出去，不能交白卷");
});
