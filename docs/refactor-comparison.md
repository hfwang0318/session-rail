# 重构对比：prompt-rail → session-rail

本文记录 fork 的重构范围、基线对比、验证方式和已知限制。基线是 `oikon48/prompt-rail`（下称“原项目”），新项目是 `session-rail`。原项目保持未改动。

## 1. 结论

原项目的历史列表只有一个数据源：会话的 transcript `.jsonl` 文件。文件读不到、路径猜错、读取晚于 `/clear`、或压缩边界链接方向不符合预期时，列表会缺项甚至整条为空。这些是**架构缺陷**，不是单个解析 bug：transcript 是 Claude Code 的落盘产物，不是稳定的会话历史接口。

重构后，历史列表以引擎自己的会话投影 `$.session.messages()` 为主源，transcript 降级为可选的增强源。transcript 只负责补充 uuid、回合详情和超出引擎 4096 条窗口的旧历史，读不到时只会让列表“少细节”，不会让列表“变空”。

## 2. 测试基线

| 项 | 原项目 | 重构后 |
| --- | --- | --- |
| 测试命令 | `claude plugin test plugins/prompt-rail` | `claude plugin test plugins/session-rail` |
| 结果 | 142 pass / 0 fail | 201 pass / 0 fail |
| 耗时 | 4.5s | 5.7s |
| 新增测试 | — | 59（15 个注入引擎列表场景 + 44 个纯函数/压缩/竞态场景） |

原项目的 142 个测试全部保留并通过，因此 UI、布局、命令、转场、轨道绘制的行为没有回退。

## 3. 架构对比

| 维度 | 原项目 | 重构后 |
| --- | --- | --- |
| 主数据源 | transcript `.jsonl` | `$.session.messages()` |
| transcript 的角色 | 唯一来源 | 可选增强（uuid、回合详情、旧历史） |
| 文件缺失 | 列表为空 | 引擎列表照常显示 |
| 路径猜错 | 只在启动时猜一次 | 每次回合边界重新查找，并提示一次 |
| `/compact` | 依赖边界行与父链 | 过滤摘要行；边界前提示词由 transcript 补回 |
| 4096 条上限 | 无此概念 | 超出部分由 transcript 补回 |
| `/clear` 竞态 | 迟到的读可能回填旧会话 | 会话 id/path 校验 + `seen` 对象换代 |
| 行 id | 全部来自 transcript uuid | uuid 优先；无 transcript 时用稳定引擎 id + 已渲染行 id |
| 读失败 | 静默 | 提示一次 |

核心新模块：`plugins/session-rail/hooks/history.ts`（约 210 行），把消息过滤、正向/反向双源对齐、旧历史恢复和对队列提示词的插入做成纯函数，便于单测。

## 4. 已修复的故障模式

| 故障 | 触发条件 | 修复 | 测试 |
| --- | --- | --- | --- |
| 压缩边界前的提示词整段消失 | 边界 `logicalParentUuid` 指向新段（2.1.270 一类构建） | `liveBranch` 在边界处并入文件中的上一行，并逐段回溯 | `a compaction boundary that links forward keeps the prompts before it` |
| 压缩后列表只剩摘要/最新几条 | 引擎用摘要替换内存消息列表 | 过滤压缩摘要；把 transcript 中早于首个匹配项的提示词放回列表头部 | `after a compaction the engine list adds the prompts it still holds to the older stored ones` |
| 摘要被当成用户提示词 | `messages()` 的摘要行也是 `role: "user"` | `COMPACT_SUMMARY` 固定文案过滤 | 同上 |
| 无 transcript 时列表为空 | 托管设置、Team/Enterprise、`--plugin-dir`、路径变更 | 引擎列表作为主源 | `the engine list lists prompts even when no transcript can be read` |
| 迟到的 transcript 读回填旧会话 | `/clear` 或 resume 与异步读交错 | `seen` 换代；回调校验 session id/path；引擎刷新也校验会话 | `a background read finishing after /clear lists no prompt of the old conversation` |
| 队列中的提示词丢失 | 引擎投影不包含 `queued_command` 附件 | 双源合并时按 transcript 位置补回队列提示词 | `a prompt delivered into a running turn is listed even when the engine list leaves it out` |
| 新提示词顶掉同文旧提示词的 uuid | 新提示词尚未落盘、文本重复（如两次 `continue`） | 从新到旧双指针 + 单步前瞻；平局时跳过引擎项 | `a new unstored prompt does not take the stored row of an older prompt with the same text` |
| 工具结果被当成提示词 | `messages()` 的用户行可能携带 `toolResults` | 纯函数过滤 | `a user row carrying tool results is not a prompt` |
| 引擎列表顶部被上限截断 | 超过 4096 条消息 | `older` 恢复 + 稳定的引擎 id | `an older prompt the engine list no longer holds is put back before it` |
| 读失败无提示 | 权限、文件被删、流式读取失败 | 每个路径提示一次 | 原项目既有测试 + 新提示逻辑 |

## 5. 真实运行验证（不是仅测试替身）

测试框架 `claude-code/testing` 的 `$.session` 确实没有 `messages()`。为此新增了一个**注入缝**：测试把消息列表写进插件自己的 store（键 `__session-rail-engine-test__`），`engineMessagesOf` 优先读取它。生产环境从不写这个键，并且只有在 `$.session.messages()` 调用失败时才会读它。上述 15 个注入场景走的是同一条 `refreshEngine` 代码路径，不是 transcript 回退路径；其中多个测试在没有 transcript 的情况下也能通过，证明主路径确实被使用。

为了验证真实运行时 `$.session.messages()` 的形状，另用临时探针插件在 **Claude Code 2.1.308 真实会话** 中采样（`--plugin-dir` + `claude -p`）：

- 首轮：返回 3 行 `[user 提示词, assistant "", assistant 回复]`。
- `--resume` 后：返回 6 行，完整保留旧提示词。
- 执行 `/compact` 后再开一轮：返回 8 行，关键片段如下：

```text
0 user  "This session is being continued from a previous conversation that ran ..."
1 assistant ""
2 assistant "done-again"
3 user  "<command-name>/compact</command-name>..."
4 user  "<local-command-stdout>Compacted..."
5 user  "Reply with just: probe-three"
6 assistant ""
7 assistant "probe-three"
```

这段实测同时证明了三点：

1. 压缩后引擎列表**只保留摘要和最近消息**，压缩前的提示词确实不在引擎列表里——必须靠 transcript 补回。
2. 摘要行确实是 `role: "user"` 且不带 `isCompactSummary` 标记——必须按固定文案过滤，否则会被列成一条提示词。
3. `/compact` 自身的命令行与输出行也是用户行，现有的 `WRAPPER` 过滤能正确排除。

另外用真实插件（`--plugin-dir .../plugins/session-rail`）跑了一轮无头会话，插件加载、hook 注册与执行无报错。

> 说明：`claude plugin test` 全部通过只能证明“回退路径 + 可注入的引擎主路径”通过；真实引擎路径由上面的探针会话单独验证。两者结论一致。

## 6. 子 agent 审查与修复

重构完成后，分别以架构/正确性、异步竞态、测试覆盖、安全隐私、TypeScript/可维护性五个维度做了独立审查。没有 CRITICAL 发现；已修复的高/中风险项：

- **异步竞态（HIGH）**：`engineMessagesOf` 的 await 之后、`refreshEngine` 之前重新校验会话 id 与代际计数；`/clear` 中途发生时，旧的刷新不会再回填新会话。
- **读取互斥（HIGH）**：`readTranscript` 在第一个 await 之前就抢占 `Seen`，避免 `session.start` 与 `classic.SessionStart`（以及 `classic.Stop` 与 `turn.complete`）同时流式读入同一个对象。
- **会话绑定竞态（MEDIUM）**：`transcriptOf`/`reconsiderTranscript` 的 await 之后，只有在会话仍未绑定、且代际未变时才写入路径；路径变更时清空 `lastIndex`。
- **turn.complete 时序（MEDIUM）**：在 `next(e)` 之前捕获回合与提示词；`next` 期间发生 `/clear` 或新回合时，不再把旧回合的时长/中断状态写到新提示词上。
- **同文新提示词被吞（MEDIUM）**：`held` 尾部改为按 id 判断，不再按文本；重复的 "continue" 不会因为文本相同而被当成已列出。
- **重命名迁移（MEDIUM）**：引擎 id 升级为 uuid 时，`rowEntry`、`starter`、`reading`、`unreachable`、`aliases`、`pending` 一并迁移。
- **类型错误（HIGH）**：`TranscriptIndex.prompts` 的 `queued` 字段用 `IndexedPrompt` 类型承载（此前会被 tsconfig 的 excess-property 检查拒绝）。
- **读取失败语义（HIGH）**：引擎读取失败不再把 `engineMode` 翻回 transcript 模式，避免一次瞬时失败让旧列表被 transcript 覆盖。
- **重复文本配对（HIGH）**：双源对齐改为从最旧一端开始，相邻的同文提示词按“旧配旧”配对；新发出的同文提示词不会再抢占旧提示词的 uuid 与回合详情。
- **`/rewind` 残留（HIGH）**：引擎列表会记录上一轮列出的 id；被引擎丢弃（如 `/rewind` 分支）的提示词不会因为处于列表尾部而被保留，而刚发出、引擎尚未列出的提示词仍会保留。
- **无匹配时的顺序（MEDIUM）**：压缩后新提示词已进入引擎列表、而它的 transcript 行尚未落盘时，旧历史作为更早的提示词放在它前面，而不是倒序追加。
- **队列尾部顺序（LOW）**：引擎新提示词之前的 queued 提示词先于它列出。
- **命令注入面收紧**：`tail` 的参数加上 `--`，路径不可能被解释为选项。
- **隐私文案校正**：首次读取大文件会流式读完整个文件；PowerShell 子进程会收到两个临时环境变量；网络共享上的 transcript 会走 SMB。
- **终审测试加固**：第三轮以变异测试逐条验证新增用例的区分度，补上了“新会话 id 重置”“classic `/clear` 重基线”“读取失败只提示一次”“新回合在 `next()` 内开始时旧回合仍记在原提示词上”四个此前会漏过的守卫，并新增 `scrollTargetOf`、`reconsiderDecision` 的纯函数测试。
- **队列提示词抢占配对（HIGH）**：对齐时优先选择匹配到非 queued 存储行的方向。进入回合的真实提示词保留 uuid、回合详情和跳转目标，排队副本按原位置单独列出。
- **拆分行重复（MEDIUM）**：引擎把一条消息拆成多行时，按行键把第二行认作同一提示词；无 transcript 时不再多出一条。
- **迟到读取的旧历史（MEDIUM）**：后台 transcript 读完成后，立即用最近的引擎列表再刷新一次，超出引擎窗口的旧历史不必等到下一个回合边界才出现。
- **跨会话的完成事件（MEDIUM）**：`turn.start` 记录会话代际与最近启动的回合；切换会话后到达的 `turn.complete` 不再把时长/中断状态写到新会话的提示词上，无论新会话尚未开始、正在运行还是已经结束了自己的回合。
- **命名（发布前）**：插件与仓库改名为 `session-rail`，避开 Anthropic 公共目录保留的 `claude-` 前缀；`claude plugin validate plugins/session-rail` 已通过，命令、pane id、设置键、state 键与 marketplace 条目一并更新。

## 7. 已知限制

- `messages()` 只返回 `{role, text, toolUses, toolResults?}`，**没有 uuid、时间戳、origin、isCompactSummary 标记**。摘要只能按固定文案识别；非人类来源的提示词只能靠 transcript 的 origin 字段过滤。
- `messages()` 最多返回 4096 条投影消息，超出部分依赖 transcript。
- 没有 transcript 时，跳转只能指向已经渲染过一次的行（引擎列表没有行 id）。
- 测试框架的 `$.plugin.root` 不是 marketplace 形状，`reconsiderTranscript` 找到新路径后的“采纳并重读”分支无法在单测里走到；其决策逻辑有纯函数测试，真实路径需在 marketplace 安装环境下验证。
- 若引擎异常地对同一 `turnId` 重复投递 `turn.complete`，且期间已列出新提示词，重复的时长仍会记到最新提示词。这是重构前就有的行为；正常引擎不会重复投递，本次未改动。
- 未做交互式 TUI 的人工验收；布局与交互由原项目的 142 个测试覆盖。

## 8. 复现

```bash
cd /path/to/session-rail
claude plugin test plugins/session-rail
claude --plugin-dir plugins/session-rail

# 基线（原项目，未改动）
cd /path/to/prompt-rail
claude plugin test plugins/prompt-rail
```
