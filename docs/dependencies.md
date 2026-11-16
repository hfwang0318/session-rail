# 引擎依赖登记册

这份文档登记 session-rail 对 Claude Code 的**全部不稳定依赖**：插件假设了什么、假设失效时会发生什么、代码里已有（或应当有）的兜底、以及升级后怎样验证。

规则（同样写在 `CLAUDE.md`）：

1. **优先使用稳定依赖。** 能用已声明的 mods API、`classic.SessionStart` 的事件字段、`$.session.messages()` 与插件自己的 `store` / `state` 解决的事，不要从转录文件或引擎话术里推断。
2. **每一个不稳定依赖都要登记在这里。** 新增一条依赖（新的转录字段、新的引擎文本、新的磁盘布局）必须同时写清：位置、假设、失效表现、兜底、验证方法。没有登记的依赖不允许合入。
3. **失效只能降级，不能画错。** 读不出来就少一个标题/少一段时间/少一个跳转，绝不允许把非提示词列成提示词、把两个会话混成一个块、或让 `current session` 消失。任何新依赖的兜底都按这个标准设计。
4. **测试只锁定插件行为，不锁定引擎。** 测试里的转录行是构造的；引擎行为变化由每周对 `@anthropic-ai/claude-code@latest` 的 CI 和下面的手工清单发现。

稳定性分级：

| 级别 | 含义 | 例子 |
| --- | --- | --- |
| 稳定 | 已声明的 mods API，按文档语义使用 | hook 名称、事件字段、`$.store` / `$.state` |
| 半稳定 | 已声明但语义未承诺，或随 release 移动 | `$.session.messages()`、`$` 命名空间的方法集 |
| 不稳定 | 引擎内部实现，未承诺 | 转录 `.jsonl` 字段与语义、固定话术、磁盘布局、主题文件 |

---

## A. Mods API（已声明，仍随 release 变动）

mods API 的类型文件由 `/plugin-types` 生成，插件不提交它；CI 每周对最新版跑测试，签名变化会直接让测试失败。下列各项仍可能改变**语义**而不改变签名，测试不一定能发现。

| 依赖 | 使用点 | 失效表现 | 兜底 / 现状 |
| --- | --- | --- | --- |
| `register(on, options)` 与 `plugin.json` 的 `userConfig` 行 | 整个模块入口 | 模块加载失败，rail 完全不出现 | 无法兜底；CI 与本地 `claude --plugin-dir` 会发现 |
| `session.start`：`e.cwd`、`e.surface` | `isTerminal`、`launchCwd`、转录查找 | 终端/桌面判断错，横幅与提示线画法退化；转录路径找不到 | 转录路径还有 `classic.SessionStart` 与目录枚举兜底 |
| `classic.SessionStart`：`e.source`（`startup` / `resume` / `clear` / `compact` / `fork`）、`e.session_id`、`e.transcript_path` | 续接/分支边界的种类与时刻 | `fork` 不再上报 → 分支边界退回 `resumed at …`，`current session` 不出现；路径缺失 → 多走磁盘查找 | 旧 `store` 用转录里的 `forkedFrom` 行推断分支起点；路径有 `transcriptCandidates` |
| `classic.Stop` | 回合结束后重读转录 | 只有轨道内容不更新（下一事件会补） | `turn.complete` 同样触发重读 |
| `turn.start`：`e.turnId`、`e.text`（空文本=续写）、`e.agentId` | 运行中标记、活行、`currentIndex` | 运行标记错误或一直转；跳转目标偏移 | 无 start 有完成时按 `lastStartedTurn` 容错；`agentId` 事件一律跳过 |
| `turn.complete`：`e.turnId`、`e.durationMs`、`e.reason`（`aborted` / `error`）、`e.agentId` | 卡片统计与失败标记 | 时长/结果缺失或落到错误提示词 | 捕获 `generation` 防止写到新对话；未知 turn 忽略 |
| `prompt.submit` / `session.receive`：`e.origin.kind`、`e.text`、`e.agentId` | 立即列出待存提示词、计数 | 新 kind 不在 `PROMPT_KINDS` → 少列一条；误判 → 多列一条 | `PROMPT_KINDS` 是白名单；转录读回时会以存储行为准 |
| `session.end` | 保存待接续的边界 | 重启后边界线丢失 | 边界同时存在于 `state` 与 `store` |
| `command.run` | 本插件命令 | 命令无响应 | 无 |
| `config.list()` 的 `theme` 行、`config.set`（`theme`）、`config.describe` | 亮/暗与卡片主题的说明 | 调色板不跟随主题（颜色错，布局不受影响） | 读不到时用插件自己的 `colorScheme` 设置；`config.set` 失败只影响重新着色 |
| `ui.render` 组件名与 props：`e.component`、`e.requestId`（`placeholder` / `placeholder-N` 回显）、`e.props.text`、`e.props.origin.kind`、`e.props.onScreen`、`e.props.bodyColumns`、`e.props.scroll.bodyRows/offset`、`e.props.view.agentId` | 全部三个座位与悬挂卡 | 回显 id 变了 → 会把临时行当跳转目标；`onScreen` 语义变了 → 在读提示词判断错；`view.agentId` 缺失 → 子代理的行污染主对话 | `isProvisionalId` 是模式匹配；`onScreen` 缺失时退回滚动位置；子代理检测还依赖 `turn.start` 的 `agentId` |
| 站点窗口的滚动方式：引擎按 `-offset` 把整棵树整体上移（负的上边距），`position: "absolute"` 的盒子随树一起移动，其 `top` 以树的行计 | 悬停卡的 `card-slot`（钉在窗口首行，卡片行以窗口行计） | 若引擎改为只平移流式内容、或改用窗口坐标放置绝对盒子 → 卡片整体错位，或在列表滚动后不再出现 | 无代码兜底；靠 `claude --plugin-dir` 手工验收（在已滚动的长列表上悬停一行，看卡片是否就在该行下方），测试只断言树的 props，不锁引擎布局 |
| `ui.focus` / `ui.scroll` / `ui.press`：`e.element`、`e.pointer`、`e.by`、`$.ui.scroll` 的 `{ to: { requestId }, block }` / `deny` | 悬停环、卡片滚动、父会话 id 复制 | 悬停/点击无效或跳转失败 | 跳转失败标记为不可达并给一次说明 |
| 悬停与点击的派发条件：引擎只在备用屏（`altScreenActive`，即 `"tui": "fullscreen"`）派发 `dispatchHover` / `dispatchMouseClick`，且鼠标跟踪模式为 `full`（请求 `?1003h` 移动事件）时才收到悬停；fullscreen 布局从 110 列起把 `Pane` dock 在对话记录旁，更窄则座位为 `inline` | 全部 `hover.scope` 组、`ui.press`、`ui.focus` | 收不到移动事件 → 卡片不开、行不亮（rail 变小，不画错）；`inline` 座位按设计没有悬停卡；`CLAUDE_CODE_DISABLE_MOUSE` / `CLAUDE_CODE_DISABLE_MOUSE_CLICKS` 会关闭或降级鼠标 | 无（事件到不了插件）；`/session-rail-preview` 可看卡片主题；README 的鼠标提示已写明 fullscreen 与 110 列的条件 |
| `$.ui.toast` / `open` / `close` / `invalidate` / `copy`、`$.command.register`、`$.clock.after` | 提示、预览页、重绘节流 | 提示丢失；预览 pane 不立即重绘（切换主题后仍显示旧色）；定时器不触发（重绘变慢或不发生） | 每个事件仍会触发重绘；定时器只影响节流、闪烁与动画 |
| `$.fs.read` / `stat` / `list` / `exists`、`$.env.get`、`$.plugin.root`、`$.session.id` / `cwd` / `root` | 读转录、找配置目录 | 读不到 → 列表退回引擎消息列表；路径错误 → `UNFOUND` 提示 | 每个读取都有 try/catch 与降级 |

## B. 引擎消息列表 `$.session.messages()`

- **依赖**：这是提示词的主列表；行只有角色与文本，没有 uuid、时间戳、turn 详情；新提示词在存储前以 `placeholder` / `placeholder-N` 回显；最多保留 4096 条。
- **失效表现**：
  - 列表不再包含用户提示词或有额外包装 → 轨道缺行或多行（`promptTextOf` / `promptsFromMessages` 是过滤层）。
  - 4096 条窗口缩小 → 更早的提示词只能靠转录恢复；转录缺失时看不到。
  - 测试环境没有 `messages()`（见 G）。
- **兜底**：转录读回只做**增量**，永远不会清空引擎列表（`engineMode`）；合并按文本对齐（`matchStored`），对不上时保留双方。

## C. 转录文件的位置与命名

- **依赖**：会话转录在 `<config>/projects/<folder>/<session id>.jsonl`；`<folder>` 由 cwd 得到（字母数字之外的字符变 `-`），超过 200 字符时截断并加哈希（`PROJECT_FOLDER_MAX`）；续接/分支的文件与其前一个会话放在同一目录。
- **失效表现**：找不到转录 → 没有存储 uuid（跳转退回引擎行）、没有发送时间、没有 turn 详情、没有 `/compact` 前的历史；找不到父会话文件 → 不出现 `prompts from <id> ⧉` 与加载按钮。
- **兜底**：`transcriptCandidates` 枚举候选（含目录列表匹配）、`store` 记住路径、`UNFOUND` 提示只出现一次；引擎列表照常绘制。

## D. 转录行字段与语义

这些字段**没有任何公开承诺**。每一行的使用点都在 `parseRow` / `indexRows`。

| 字段 / 结构 | 插件假设 | 失效表现 | 兜底 |
| --- | --- | --- | --- |
| `uuid` | 每条消息有稳定 uuid，用作跳转目标与合并键 | 缺失/改变 → 跳转失败、提示词重复 | `rowKey` 退回 `engine:<ordinal>`；失败标记为不可达 |
| `parentUuid` 链、`isSidechain` | 活跃分支由 parent 链与 sidechain 标记界定（`liveBranch`） | 链断裂 → 列出被放弃的分支行 | 列出所有非 sidechain 行（可能多） |
| `type`（`user` / `assistant` / `system`）、`subtype: compact_boundary` | 用户行是提示词；助手行把回复归属到上一个提示词；`compact_boundary` 分段 | 新行类型 → 少归属或多提示词；边界缺失 → `compacted` 分隔线消失 | 不认识的行忽略；引擎列表仍提供提示词 |
| `timestamp`（ISO） | 发送时间、turn 起止、续接/压缩边界定位 | 缺失/格式变 → 时间戳与块标题时间消失，边界线改用计数定位 | `Date.parse` 失败即当作无时间；`sinceResume` 计数兜底 |
| `sessionId`（驼峰） vs `session_id`（蛇形） | 驼峰是本文件写入者；蛇形是原始写入者 | 语义互换 → 复制行被误判来源 | 只在 `/fork` 的 note 时间窗内使用蛇形；续接文件一律不用 |
| `message.role` / `message.content`（字符串或块数组）、`tool_use`（`id` / `name` / `input.file_path`）、`tool_result` | 用户提示词是字符串或文本块；工具调用把行归属到提示词，并记录编辑的文件 | 结构改变 → turn 统计缺文件、工具行被当成提示词 | 只取已知字段；未知块忽略 |
| `isMeta`、`origin.kind`（`human`、`composer`、`bridge`、`sdk` 是提示词；`peer`、`task-notification`、`auto-continuation`、`plugin` 不是） | 区分人写的与引擎/代理写的行 | 新 kind 归错 → 多列或少列一条提示词 | 以“排除已知非提示词 kind”为准（`OTHER_ORIGINS`）；`isMeta` 兜底 |
| `isCompactSummary` + 蛇形 `session_id` ≠ 驼峰 `sessionId` | 本文件续接了另一个会话，蛇形 id 指向它 | 识别失败 → 没有父会话块、没有 `load-parent`；或相反 → 复制行被当成块 | 识别不到时降级为“只看本文件”；**不会**产生重复标题 |
| `forkedFrom.sessionId`（`/branch` / fork 机制的复制戳） | 这一行被复制进本文件，来自该会话，可作为块标题（行在本文件，可跳转） | 戳消失 → 少若干 `prompts from` 标题（降级） | 与合并出的父块重名时由 `continueFrom` 去掉重复标题 |
| `attachment.type: queued_command`、`attachment.isMeta` / `origin` | 排队中的提示词 | 少列/多列一条 | 只作为补充，存储行到达后以其为准 |
| 文件大小与增量读（`READ_CAP`） | 大文件按偏移增量读、按 mtime/size 缓存 | 偏移语义变化 → 重读或漏读 | 每次 `turn.complete` / `classic.Stop` 后按 mtime 重读；失败给一次提示 |

## E. 引擎写入的固定话术

插件用固定文本识别引擎写的行。改文案会让识别静默失效。

| 文本 / 正则 | 假设 | 失效表现 | 兜底 |
| --- | --- | --- | --- |
| `COMPACT_SUMMARY`（“This session is being continued from …”） | 引擎列表里的压缩摘要不是提示词 | 摘要被列成一条提示词 | 转录侧还有 `isCompactSummary` 标记 |
| `SIDE_NOTE`（“Here is a note offered by a side agent: …”） | 提示词前另一代理的便条，要剥掉后显示用户输入 | 行与卡片显示便条而不是用户的字 | 无（只影响这一条提示词的文本） |
| `FORK_SHARED_UNTIL`（“The conversation up to <ISO> is shared history with it”） | `/fork` 的共享历史截止时刻 | fork 复制块没有标题（降级）；不会误造标题 | 只在没有 `/branch` 戳、且不是续接文件时读取 |
| `WRAPPER` 标签（`<command-*>`, `<bash-input>`, `<system-reminder>`, `<task-notification>`, `<cross-session-message>`, `<agent-message>`, `<teammate-message>`, `<relay…>` 等） | 引擎包装行不是提示词 | 包装行被列成提示词 | `isMeta` / `origin.kind` 同时过滤 |
| `<command-name>` / `</command-name>` | 斜杠命令行：带参数是提示词，裸命令不是 | 命令行多列或少列 | 无 |
| `<artifact-view-context …>` 块 | 提示词前附带的查看器状态要剥掉 | 行首显示 JSON 上下文 | 无 |
| `[Request interrupted by user` | 中断提示不是提示词 | 多列一条“提示词” | 无 |
| `<fork-source>` 内的共享历史文本 | `/fork` 会话的来源说明 | 与 `FORK_SHARED_UNTIL` 相同 | 同上 |

## F. 主题与系统文件

| 依赖 | 失效表现 | 兜底 |
| --- | --- | --- |
| `config.list()` 中 `theme` 行的字符串值，以及内建主题名的明/暗归类 | 调色板选错侧（浅色终端上画深色文本） | 插件自己的 `colorScheme` 设置；读不到就保持当前调色板 |
| 自定义主题 `<config>/themes/<slug>.json` 的 `base`（`light` / `dark`） | 自定义主题按默认侧绘制 | 名字不在内建表才读；读不到返回 `undefined`，保持当前 |
| `/etc/localtime` 的 `realPath` 推导时区 | 卡片上的发送时间用错时区（Windows 无此文件） | 读不到就不展示时区换算 |
| 引擎对 raw color 的映射：`#hex` / `rgb()` / `ansi256()` / `ansi:<name>` 各自生成 SGR，未知字符串不产生 SGR；颜色深度不足时 24 位量化到 256 色 | 卡片面板、accent tint 与行高亮落到终端默认或近似色（外观级） | 无；`/session-rail-preview` 在同一终端逐族对照，可区分主题/侧别与终端绘制 |

## G. 测试接口（`claude-code/testing`）

- **依赖**：测试工具包的 `register` / `mount` / `find` / `findAll` / `press` / `unmount`、`mock.clock` / `mock.store`、`clock.settle` / `advance`，以及测试环境的 `$.session` 没有 `messages()` 和 `/config` 菜单。
- **失效表现**：套件整体加载失败（CI 直接发现）。
- **兜底（生产侧接缝）**：引擎列表用 `ENGINE_MESSAGES_TEST_KEY`、主题名用 `THEME_TEST_KEY` 注入；两者**只在真实调用失败后**才读，真实会话永远不会写这两个键。改读取顺序会破坏接缝。

## H. 本插件自己的持久化格式

不是引擎依赖，但同样没有版本号，读旧值必须兼容；改动时按不稳定格式对待。

| 键 | 形状 | 读取规则 |
| --- | --- | --- |
| state `moved` | 数字 | 缺失按 0 |
| state `resume` | `{ sessionId, at, moments, branches, counts, total, since }` | 逐字段校验；未知字段忽略；缺 `branches` 视为空；`moments` 缺失时退回 `at` |
| store `rail-on:<id>` | 布尔 | 非布尔值忽略，按显示处理 |
| store `transcript:<id>` | `{ path, at }` | 只接受字符串路径 |
| store `resume-moments:<id>` | `{ moments, branches, at }` | 只接受数字数组，且 `branches ⊆ moments` |

新增字段只能“可缺省、可忽略”；改名或改变含义之前必须同时写兼容读取。

---

## 失效影响分级与设计原则

| 级别 | 表现 | 例子 |
| --- | --- | --- |
| 正确性 | 列错内容（多/少/混） | `origin.kind` 新值、`isCompactSummary` 语义变化、包装话术变化 |
| 完整度 | 少功能，但不错 | 戳消失 → 少块标题；父转录读不到 → 没有父会话列表；note 变化 → fork 块无标题 |
| 外观 | 颜色、时间、对齐 | 主题行变化、`timestamp` 缺失 |

**所有新增推断都必须落在“完整度”或“外观”级别**：读不出就少画，不允许画错。评审时先问这一条的失效表现属于哪一级。

## 升级后的手工检查清单

CI 每周跑一次测试，只能发现签名/接口变化；字段语义与话术变化要靠真实会话。升级 Claude Code 后，建议依次过一遍：

1. **普通长会话**：提示词齐全、点击能跳、发送时间正确。
2. `/compact`：出现 `compacted` 分隔线，压缩前的提示词仍在。
3. `claude --resume <id>`（或上下文溢出续接）：出现 `resumed at …` 或 `current session`，`load-parent` 能逐层加载，父行是点线刻度。
4. `/branch`：子会话里有 `prompts from <父会话> ⧉`，边界是 `current session`，复制行可跳转。
5. `/compact` 之后再 `/branch`：分块标题仍在。
6. `/fork`（会话内 fork）：复制块有标题，fork 之后写的提示词不算复制。
7. `/config` 切换 light/dark 主题与卡片主题：颜色立即跟随，无需重载。
8. 面板与窄面板时的横条卡片都能画出块起点（`⇡`）。

以上任何一步与预期不符，先对照本文件定位是哪一条依赖变了，再改代码并更新这一条登记。

## 维护

- 新增/修改任何对引擎内部（转录字段、话术、磁盘布局、配置行）的读取：在同一提交里更新本文件对应条目。
- 删除依赖时删掉条目，不留下过期描述。
- 位置以**符号名**（函数、常量）记录，不写行号——行号会随代码移动。
