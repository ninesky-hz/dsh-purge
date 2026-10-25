# 随包知识库（hackskills）

自 1.7.0 起，本插件随包分发一份渗透知识库：**101 个技能、155 个 markdown、约 1.69 MB**，装完即用，
不需要再手动 `/skills import`。它在技能页里是与「红队技能」「官方技能」并列的第三类：**知识库技能**。

- 载荷目录：`skills/hackskills/`（本包内，`package.json` 的 `files` 已含 `skills`，随 npm 包一起发）
- 落地目录：`$DSH_HOME/redteam/hackskills/`（插件启动时同步）
- 预设接线：`presets/redteam/agent.cordis.yml` 的 `skill-filesystem.config.customSkillDirs` 里
  `- !!js dshHomePath('redteam/hackskills')`

**不要把这些技能写进 `$DSH_HOME/skills`。** 那是官方用户技能目录，本包不往里写任何东西
（`lib/redteam/platform-config.js` 的既有约束）；知识库单独占一个目录、单独一条 `customSkillDirs`。

## 1. 形态：目录束，不是单文件

```
skills/hackskills/
├── LICENSE                      # 上游 MIT 许可原文（必须保留）
├── SOURCE.json                  # 来源、commit、统计、本地改动（非 .md，不会被当成技能）
├── hack/SKILL.md                # 总路由：信号 → 优先方向
├── injection-checking/SKILL.md  # 分类路由
├── injection-checking/EXTRA_INJECTION_TYPES.md
└── business-logic-vulnerabilities/SKILL.md
```

- 每个技能是 `<id>/SKILL.md`，`id` 同时是 frontmatter 里的 `name`（kebab-case）。
- 部分技能带同目录深读文档（如 `ssti-.../ENGINE_PAYLOADS.md`），正文用相对链接指过去；
  宿主只把 `SKILL.md` 当技能入口，同目录的 md 由模型按需用 `read` 打开。
- 宿主 loader 只认根下**一层** `<id>/SKILL.md`（`segments.length > 2` 直接忽略），所以不要再往下嵌套。

## 2. 启动时发生了什么

1. `lib/redteam/index.js` 的 `installHackskillLibrary()` 逐文件比对包内与
   `$DSH_HOME/redteam/hackskills`，内容不同才写；`$DSH_HOME` 与 `~/.dsh` 分叉时两边各同步一份。
2. `installPreset()` 顺带保证预设里有 `redteam/hackskills` 那一行。老用户的预设**只加行、不覆盖**：
   缺就插在 `dshHomePath('redteam/skills')` 之后，其余内容原样保留（返回 `repaired: 'hackskills-dir'`）。
3. 宿主 `skill-filesystem` 按 `customSkillDirs` 扫到这些目录，`skill` 工具与 `/skill` 命令即可列出/加载。

同步是**内容比对**而不是整目录覆盖：你手动改过 `$DSH_HOME/redteam/hackskills` 里的文件，下次启动会被包内版本改回来；
要长期本地化，请复制一份改 `$DSH_HOME/skills`（官方目录优先级更高，同名取先出现的那份）。

## 3. 技能页里的三个库

| 库 | 来源 | 工具路径检查 | 说明 |
| --- | --- | --- | --- |
| 红队技能 | 本包 `skills/redteam/*.md`（23 个单文件） | **查** | 依赖 nmap/nuclei/impacket 等，缺工具会显示「不可用」与缺口 |
| 知识库技能 | 本包 `skills/hackskills/`（101 个目录束） | 不查 | 文档型：没有外部工具依赖，恒显示「已列出」 |
| 官方技能 | `$DSH_HOME/skills` | 不查 | 你自己的技能，本包只读不写 |

分类依据是 `lib/redteam/skill-availability.js` 的 `skillLibraryOf()`：先判
`/redteam/hackskills`（包内是 `/skills/hackskills`），**再**判 `/skills`。顺序不能反——`.../skills/hackskills/x`
同时含 `/skills/`，先判官方就会把整库错标成官方技能。

## 4. 覆盖范围

18 个分类、101 个技能（1 个总路由 + 6 个分类路由 + 94 个专题）：

| 类 | 数 | 类 | 数 | 类 | 数 |
| --- | --- | --- | --- | --- | --- |
| injection | 18 | advweb | 10 | logic | 8 |
| pwn | 8 | infra | 7 | windows | 7 |
| auth | 6 | api | 5 | linux | 5 |
| crypto | 5 | re | 4 | recon | 3 |
| file | 3 | mobile | 3 | forensics | 3 |
| macos | 2 | blockchain | 2 | ai | 2 |

入口先读 `hack/SKILL.md`（信号 → 方向），再下钻分类路由，最后到专题。

## 5. 成本

- **目录摘要**：101 条 name + description 每次会话注入 `<available_skills>`，约 **28 KB ≈ 8 k tokens**。
  这是常驻成本，也是把它做成"可关"而不是"永远塞"的原因。
- **正文**：155 个文件共 1.69 MB，只在模型真的加载某个技能时才读，不常驻上下文。
- 红队会话本身已带 23 个红队技能摘要，加上这 101 条，目录摘要仍是几万字节量级；真正的上下文压力来自正文。

## 6. 来源与许可

- 上游：[`yaklang/hack-skills`](https://github.com/yaklang/hack-skills)，`main@a3ab667`，索引 schema
  `hack-skills-index/v1`（上游自报 101 skills / 49,121 行 / 18 分类）。
- 许可：**MIT，Copyright (c) 2026 VillanCh**。原文见 `skills/hackskills/LICENSE`，再分发必须保留版权与许可声明。
- 本仓库改动（只删断链，不改内容）逐条记在 `skills/hackskills/SOURCE.json` 的 `localEdits`。

## 7. 已知缺口

- **NoSQL 注入没有正文**。上游总路由和注入分类路由都链到 `../nosql-injection/SKILL.md`，但上游从未提供该目录，
  全库也没有 NoSQL 正文。本包删掉了这两条死链；需要时按 SQLi + 注入分类里的思路自行推导。
- **`SCENARIOS.md` 未随包**：`ssti-server-side-template-injection` 与 `upload-insecure-files` 的正文提到
  同名深读文档，上游没有打包。本包把 6 处链接降级成纯文本，避免模型去加载一个不存在的文件。
- 全库 534 条相对链接已校验，断链 0。
- 内容为上游原样（`ssti` 的 `ENGINE_PAYLOADS.md` 之类深读文档都在），未做质量重写。

## 8. 校验与排错

```bash
# 载荷是否合规 + 同步是否幂等 + 预设是否只补一行（6 个用例，几秒）
node --test test/hackskills.test.mjs

# 落地是否发生
ls "$DSH_HOME/redteam/hackskills" | head
grep -n "redteam/hackskills" "$DSH_HOME/.agent-presets/redteam/agent.cordis.yml"
npm run check:docs                # 文档与版本一致
```

- 技能页看不到知识库：先看预设里那一行在不在（老预设由 `installHackskillLibrary()` 的自愈补上，
  需要重启插件才生效），再看 `$DSH_HOME/redteam/hackskills/<id>/SKILL.md` 是否落盘。
- 模型不调用：检查会话是否跑在红队预设下——知识库靠预设的 `customSkillDirs` 才进作用域，
  default 预设看不到它们。
- 想整库关掉：从预设删掉 `redteam/hackskills` 那一行（`repaired` 自愈会再加回来），
  或在 `$DSH_HOME/redteam/hackskills` 不存在的情况下不加载红队预设。**不要**靠删包内目录——
  下次启动会从包里重新同步。

## 9. 升级上游

1. 拉上游新 commit，按 `SOURCE.json` 的 `layout` 覆盖 `skills/hackskills/`（保留 `LICENSE`、`SOURCE.json`）。
2. 重跑断链检查（`test/hackskills.test.mjs` 里有链接遍历用例）与 `npm test`。
3. 更新 `SOURCE.json` 的 `commit` / `counts` 与本文的数字。
4. 发版说明里写清"知识库从哪一版升到哪一版"。
