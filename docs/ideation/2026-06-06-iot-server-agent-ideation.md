---
date: 2026-06-06
topic: iot-server-agent
focus: 服务端 AI Agent，DeepSeek API，小米 MiMo TTS/ASR，语音或文本交互，远程查看/控制设备，先跑通服务端
mode: elsewhere-software
---

# Ideation: IoT 服务端 AI Agent

## Grounding Context

### Topic Context

- 服务端 AI Agent 是“自然语言/语音交互层 + 物联网设备能力层”的中间服务。
- 输入侧支持文本或语音；推理侧用 DeepSeek 理解意图并决定是否查询/控制设备；输出侧文本回复，必要时用 MiMo TTS。
- 设备侧对接公司已有物联网平台，不从零重建设备接入、连接、状态管理。
- 初期不考虑前端，优先把服务端闭环跑通。
- 用户偏前端，服务端编排、权限、安全审计、异步设备控制、外部 API 稳定性是主要工程风险。

### Stated Constraints And Risks

- 语音输入只明确了 TTS，ASR 未明确；不过 MiMo 官方已有 V2.5-ASR，可作为后续输入适配器。
- LLM 不能直接驱动设备；设备控制需要经过服务端工具层、权限校验、参数校验、确认和审计。
- IoT 控制天然存在设备离线、状态滞后、指令下发失败、平台超时、状态回报延迟。
- 米家式体验隐含低延迟、明确反馈、多设备上下文、多轮指代和稳定控制，但 MVP 先验证服务端链路。

### Past Learnings

- 本地已有 agent 相关经验可复用：`agent_runs`、`tool_calls`、`audit_logs`、user confirmation、tool schema。
- 敏感写操作应走服务端，前端不直写；所有权过滤、权限校验、审计字段要前置。
- 设备控制需要离线禁用、二次确认、下发反馈、参数回显。
- 真实设备控制前应保留模拟/演示模式，先覆盖成功、失败、禁用、状态回报路径。

### External Context

- DeepSeek 官方文档当前列出 `deepseek-v4-flash` 和 `deepseek-v4-pro`，支持 JSON Output 与 Tool Calls，OpenAI 格式 base URL 为 `https://api.deepseek.com`。
- DeepSeek strict tool schema beta 要求对象属性全 required 且 `additionalProperties: false`，适合由服务端生成稳定 schema。
- MiMo-V2.5-TTS 支持内置音色、音色设计、音色克隆；TTS 目标文本放 assistant role，style 可放 user role，流式音频建议 `pcm16`。
- MiMo-V2.5-ASR 支持中英/方言/噪声，wav/mp3 base64，10MB 限制，可补齐语音输入链路。

Sources: [DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing), [DeepSeek Tool Calls](https://api-docs.deepseek.com/guides/tool_calls), [Xiaomi MiMo llms.txt](https://platform.xiaomimimo.com/llms.txt), [MiMo-V2.5-TTS](https://platform.xiaomimimo.com/static/docs/usage-guide/speech-synthesis-v2.5.md), [MiMo-V2.5-ASR](https://platform.xiaomimimo.com/static/docs/usage-guide/Speech-Recognition.md)

## Topic Axes

1. 语音/文本交互链路
2. 设备语义工具层
3. 权限与高风险控制
4. 执行反馈与可观测性
5. MVP 服务端边界

## Ranked Ideas

### 1. 任务接口 + Agent Plan Contract

**Description:** 第一版不要把服务端 Agent 定义成聊天机器人，而是定义成任务接口：输入自然语言，输出结构化 `intent`、`device_query`、`proposed_action`、`reply`、`confirmation_required`、`run_id`。DeepSeek 负责理解和生成受控计划，服务端负责校验、执行、拒绝、确认或降级为查询。聊天、语音和前端都只是这个任务协议的不同呈现方式。

**Axis:** MVP 服务端边界

**Basis:** `direct:` 用户明确“初期不考虑前端，先把服务端跑通”；本地经验已有 `agent_runs`、`tool_calls`、`audit_logs`。`external:` DeepSeek 支持 Tool Calls 和 JSON Output。

**Rationale:** 这会把 MVP 的成功标准从“像聊天框”变成“自然语言能落成可审计、可确认、可执行的服务端任务”，更符合先跑通服务端的目标。

**Downsides:** 需要先设计一份稳定协议；短期看起来不如直接调 API 快。

**Confidence:** 92%

**Complexity:** Medium

**Status:** Unexplored

### 2. Device Capability Registry

**Description:** 把既有 IoT 平台里的设备、属性、动作、状态、参数范围、风险级别、离线行为统一抽象成服务端能力注册表。LLM 不直接看原始设备 API，只看到经过治理的语义工具，例如 `get_device_state`、`set_light_brightness`、`set_air_conditioner_mode`。后续新增设备优先补能力描述和平台映射，而不是重写 Agent 主流程。

**Axis:** 设备语义工具层

**Basis:** `direct:` 公司已有 IoT 平台，不从零接设备；grounding 明确 LLM 不能直接驱动设备。`external:` DeepSeek strict tool schema 要求 required 与 `additionalProperties: false`，适合由服务端稳定生成 schema。

**Rationale:** 这是 AI Agent 接入 IoT 平台的核心复利层。没有它，项目会退化为 prompt 拼接平台 API；有它，设备越多，统一语义工具越有价值。

**Downsides:** 需要整理现有平台的设备元数据；早期只支持少数设备时会觉得抽象偏重。

**Confidence:** 90%

**Complexity:** High

**Status:** Unexplored

### 3. 默认只读 + 控制申请 + Control Policy Engine

**Description:** MVP 默认支持查询设备状态，写操作必须显式升级为控制申请。LLM 只生成申请，包括目标设备、动作、参数、理由、风险等级和预期结果；服务端策略引擎再决定允许、拒绝、二次确认、要求设备在线或降级为建议。高风险设备如门锁、燃气、安防、断电类动作默认不能一步执行。

**Axis:** 权限与高风险控制

**Basis:** `direct:` grounding 风险包含越权、误控、高风险动作；本地经验强调敏感写操作走服务端、二次确认、离线禁用、参数回显。

**Rationale:** 这个边界能把 DeepSeek 的不确定性限制在“理解/申请”层，把最终控制权留给可测试、可审计的服务端代码。

**Downsides:** 用户会多一步确认；第一版“自动控制”的炫技感会降低。

**Confidence:** 94%

**Complexity:** Medium

**Status:** Unexplored

### 4. Command Timeline + 可回放审计

**Description:** 每次查询或控制都生成标准时间线：用户输入、ASR 转写、模型计划、工具调用、权限判断、平台下发、设备响应、最终状态、失败原因、用户可见回复。前端暂时不做，也先在服务端沉淀事件。未来语音播报、App 进度条、客服排障、审计和调试都复用同一条时间线。

**Axis:** 执行反馈与可观测性

**Basis:** `direct:` 本地经验包含 `agent_runs`、`tool_calls`、`audit_logs`；grounding 提到离线、失败、状态回报延迟。`reasoned:` IoT 控制链路问题可能发生在识别、推理、权限、平台下发、设备执行任何一层。

**Rationale:** IoT Agent 的可信度来自它如何处理不确定状态，而不是只处理成功路径。时间线让失败可解释、成功可验证、问题可复盘。

**Downsides:** 需要事件模型和存储；如果日志过粗，价值会打折。

**Confidence:** 91%

**Complexity:** Medium

**Status:** Unexplored

### 5. Conversation I/O Adapter

**Description:** 把文本输入、语音输入、文本回复、TTS 回复收敛到统一会话接口。主流程只处理标准 message、transcript、reply text 和 audio artifact；ASR、LLM、TTS 通过适配器接入，不互相耦合。第一阶段可以只跑文本，随后接 MiMo ASR 和 MiMo TTS。

**Axis:** 语音/文本交互链路

**Basis:** `direct:` 用户提到 TTS 但未明确 ASR；初期目标是服务端跑通。`external:` MiMo-V2.5-ASR 和 MiMo-V2.5-TTS 都已有官方能力，且有格式/角色/流式输出要求。

**Rationale:** 这能防止语音链路阻塞 Agent 核心能力，让“文本 MVP”和“完整语音体验”共用同一条服务端任务链。

**Downsides:** 如果团队强行第一版就做实时语音，这个分层会显得不够直接；ASR 置信度和音频存储还需要额外设计。

**Confidence:** 88%

**Complexity:** Medium

**Status:** Unexplored

### 6. 模拟设备沙箱 + Dry Run

**Description:** 真实设备接入前，服务端内置一套模拟家庭、模拟设备状态和模拟 IoT 平台响应，覆盖在线、离线、延迟、失败、状态不同步等情况。每次自然语言请求先能 dry run：展示将要查询/控制什么、为什么、是否需要确认、预计回复什么。确认后再在模拟或真实适配器里执行。

**Axis:** MVP 服务端边界

**Basis:** `direct:` 本地经验建议保留模拟/演示模式；用户目标是先跑通服务端。`reasoned:` IoT 写操作测试会受真实设备在线、现场环境和安全风险影响。

**Rationale:** 它让偏前端的全栈开发者可以用 curl/Postman/CLI 演示完整闭环，不被真实设备稳定性拖住，也降低误控压力。

**Downsides:** 模拟结果可能掩盖真实平台的延迟、错误码和设备差异；后续必须做真实适配器验证。

**Confidence:** 89%

**Complexity:** Low

**Status:** Unexplored

### 7. Context Snapshot

**Description:** 每轮对话开始时构建轻量上下文快照，包括用户身份、可访问空间、常用设备、候选目标、最近状态、上一次执行结果和状态可信度。LLM 只拿到必要摘要，不直接访问全量平台数据；快照也写入 agent run，方便复盘。它专门解决“把它关掉”“再调低一点”“卧室那个灯”这类多轮和指代问题。

**Axis:** 执行反馈与可观测性

**Basis:** `reasoned:` 自然语言控制依赖上下文，尤其是省略设备名和参数的多轮请求。`direct:` grounding 提到设备状态实时性、状态回报延迟和 audit logs。

**Rationale:** 这是从“单句命令 Demo”走向米家式日常体验的关键底座，也能帮助权限隔离和问题排查。

**Downsides:** 需要定义快照生命周期和数据最小化；过多上下文会增加 token 和隐私风险。

**Confidence:** 82%

**Complexity:** Medium

**Status:** Unexplored

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | 把语音输入缺口显性化 | 合并进 Conversation I/O Adapter。 |
| 2 | 设备能力翻译层，而不是让模型直接控设备 | 合并进 Device Capability Registry。 |
| 3 | 高风险动作的二次确认体验 | 合并进 Control Policy Engine，单独作为想法偏窄。 |
| 4 | 设备离线与状态滞后的诚实回复 | 合并进 Command Timeline。 |
| 5 | 先做只读设备问答 | 合并进默认只读 + 控制申请。 |
| 6 | 把用户一句话里的歧义当成核心产品摩擦 | 合并进 Context Snapshot 和控制申请。 |
| 7 | 每次 Agent 决策都留下可回放痕迹 | 合并进 Command Timeline。 |
| 8 | 模拟设备模式降低真实误控压力 | 合并进模拟设备沙箱 + Dry Run。 |
| 9 | 文本优先的语音可插拔链路 | 合并进 Conversation I/O Adapter。 |
| 10 | LLM 只生成设备意图，不直接控制设备 | 合并进 Agent Plan Contract。 |
| 11 | 自动生成设备工具 Schema | 合并进 Device Capability Registry。 |
| 12 | 离线设备自动降级为解释与建议 | 合并进 Command Timeline 和策略引擎。 |
| 13 | 服务端 MVP 只保留四个端点 | 太具体，适合 plan 阶段在技术栈确定后再定。 |
| 14 | 只支持“设备能力胶囊” | 合并进 Device Capability Registry。 |
| 15 | 查询优先，控制作为查询后的升级动作 | 合并进默认只读 + 控制申请。 |
| 16 | 用“无前端体验回放”验证米家式反馈 | 合并进模拟设备沙箱 + Dry Run。 |
| 17 | 场景编排原语 | 有价值，但超过“先跑通服务端 MVP”的第一阶段范围，适合作为后续 brainstorm。 |
| 18 | 飞行员 checklist 式执行前校验 | 合并进 Control Policy Engine。 |
| 19 | 银行转账式授权链路 | 合并进默认只读 + 控制申请 + 审计。 |
| 20 | CI/CD dry-run 模式 | 合并进模拟设备沙箱 + Dry Run。 |
| 21 | 工业 SCADA 告警分级 | 可作为后续“设备诊断 Agent”方向，当前范围偏宽。 |
| 22 | 客服工单式设备控制任务 | 合并进 Agent Plan Contract 和 Command Timeline。 |
| 23 | 数据库事务式场景编排 | 与场景编排原语重复，且超出 MVP。 |
| 24 | 如果预算为 0：只做文本 + 模拟设备 + 本地日志 | 合并进模拟设备沙箱；单独保留价值较低。 |
| 25 | 如果未来换掉 DeepSeek 或 MiMo | 合并进 Conversation I/O Adapter 和 Agent Plan Contract。 |

## Recommended Next Step

优先进入 `ce-brainstorm` 深化第 1 个想法：**任务接口 + Agent Plan Contract**。它会决定 API 边界、数据模型、工具调用协议、确认链路和后续实现计划；其它想法基本都可以挂在这份契约下面。
