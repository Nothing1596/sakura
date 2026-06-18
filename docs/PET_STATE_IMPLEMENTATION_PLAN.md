# 桌宠状态 Pet State 开发文档

本文记录 Sakura 桌宠状态模块的当前实现、开发边界和后续路线。该模块定性为**宿主内置能力 + 内置工具**，不是外部插件。当前实现已经从“依赖模型主动调用 `pet_state_update` 工具”调整为“结构化回复每次携带 `pet_state_delta`，本地自动校验、经过 Phase 2 harness 裁决、落盘并同步 UI”。

## 目标

为 Sakura 增加一个模型可见、宿主可校验、前端可同步的跨轮次状态层。

核心原则：

- `ChatSegment.tone` / `ChatSegment.portrait` 继续表示本轮每段回复的即时表现。
- `pet_state` 表示跨轮次稳定状态，不直接替代分段语气或立绘。
- 模型可以提出状态变化，但最终写入必须经过本地 schema、范围、长度、只读字段校验和确定性 harness 裁决。
- 前端只展示本地确认后的状态快照，不直接信任模型原始输出。
- 角色特异状态机放到后续阶段，不阻塞基础链路。

## 当前 MVP 链路

当前主路径不再依赖模型主动 tool call：

```text
PetStateStore.snapshot()
  -> PetWindow 注入 pet_state system context / event context
  -> 模型最终回复 JSON 同时输出 segments + pet_state_delta
  -> ChatReply 解析并保留 pet_state_delta
  -> AgentRuntime / API 层发现缺失 pet_state_delta 时触发一次结构修复
  -> PetWindow 收到 AgentResult 后应用 reply.pet_state_delta
  -> PetStateStore.update_from_reply() 校验、Phase 2 harness 裁决、审计、落盘
  -> state_changed signal 更新右键状态气泡
```

工具路径仍然保留：

- `pet_state_get`: 读取当前状态和最近审计。
- `pet_state_update`: 仅用于显式调试、手动修正或兼容旧工具调用。

普通回复的状态更新以顶层 `pet_state_delta` 为准，不要求也不鼓励先调用 `pet_state_update`。如果同一轮已经成功执行兼容更新工具，宿主会跳过最终回复中的 delta，避免重复裁决和落盘。

## 回复 JSON 合约

启用情绪模块后，最终回复 JSON 必须在 `segments` 同级包含 `pet_state_delta`。

示例：

```json
{
  "segments": [
    {
      "ja": "うん、今は落ち着いてるよ。",
      "zh": "嗯，我现在挺平静的。",
      "tone": "中性",
      "portrait": "站立待机"
    }
  ],
  "pet_state_delta": {
    "mood": "neutral",
    "affect": {
      "valence": 0.1,
      "arousal": 0.2,
      "confidence": 0.8
    },
    "evidence": {
      "last_user_signal": "用户直接询问当前心情",
      "last_trigger": "assistant_reply",
      "reason": "回复中表达当前状态平静，没有明显情绪波动"
    }
  }
}
```

边界：

- `segments[].tone` 控制当前段落语气和 TTS 参考。
- `segments[].portrait` 控制当前段落显示立绘。
- `pet_state_delta.mood` / `affect` 控制跨轮次整体状态。
- `pet_state_delta.evidence` 记录这次状态判断依据。
- `pet_state_delta` 只允许 `mood`、`affect`、`evidence`。
- `display` 只能由宿主派生，模型不能写。

如果模型漏掉 `pet_state_delta`：

- `AgentRuntime._parse_final_reply_with_retry()` 会把它视为结构缺失并修复一次。
- `OpenAICompatibleClient.chat()` 的工具总结路径也会尝试补齐一次。
- 修复失败时保留原回复，不阻断对话，但不会产生状态更新。

## 数据结构

状态持久化记录包含三部分：

```json
{
  "state": {
    "mood": "neutral",
    "affect": {
      "valence": 0.0,
      "arousal": 0.2,
      "confidence": 0.7
    },
    "evidence": {
      "last_user_signal": "",
      "last_trigger": "startup",
      "reason": "默认初始状态。"
    },
    "display": {
      "label": "平静",
      "idle_expression_hint": "站立待机"
    },
    "updated_at": "2026-06-18T12:00:00+08:00"
  },
  "harness_version": 2,
  "last_model_delta": null,
  "last_harness_decision": null
}
```

字段约束：

| 字段 | 类型 | 约束 |
|---|---|---|
| `mood` | string | `neutral`, `happy`, `sad`, `angry`, `shy`, `anxious`, `curious`, `tired` |
| `affect.valence` | number | `-1.0` 到 `1.0` |
| `affect.arousal` | number | `0.0` 到 `1.0` |
| `affect.confidence` | number | `0.0` 到 `1.0` |
| `evidence.last_user_signal` | string | 最长 120 字符 |
| `evidence.last_trigger` | string | 常用值：`startup`, `user_message`, `assistant_reply`, `runtime_event`, `tool_result`, `harness` |
| `evidence.reason` | string | 最长 240 字符 |
| `display.label` | string | 只读派生字段 |
| `display.idle_expression_hint` | string | 只读派生字段 |
| `updated_at` | string | 本地时区 ISO 时间 |

审计字段：

```json
{
  "last_model_delta": {
    "submitted_at": "2026-06-18T12:00:00+08:00",
    "delta": {},
    "forced": false,
    "force_fields": []
  },
  "last_harness_decision": {
    "status": "applied",
    "reason": "Phase 2 harness 已通过本地规则并应用。",
    "harness_version": 2,
    "revised_fields": [],
    "rejected_fields": [],
    "forced_requested": false,
    "forced_fields": [],
    "rules": []
  }
}
```

`last_harness_decision.status` 可取：

- `applied`: 完全接受。
- `revised`: 接受但修正部分字段，例如数值钳制。
- `rejected`: 没有任何可应用字段，或提交只包含被 harness 拒绝的字段。
- `noop`: delta 没有造成状态变化。

`forced` 请求通过 `last_model_delta.forced`、`last_model_delta.force_fields` 以及
`last_harness_decision.forced_requested` / `forced_fields` 审计，不再覆盖 `status`。

## 模块职责

### `app/pet_state/models.py`

- 定义 `PetState`、`PetAffect`、`PetStateEvidence`、`PetStateDisplay`、`PetStateRecord`。
- 实现 `apply_pet_state_delta()`。
- 负责 mood 枚举、数值范围、文本长度、只读字段边界。
- 根据 mood 派生 `display.label` 和 `display.idle_expression_hint`。
- 将 schema-valid candidate 提交给 Phase 2 harness，并把 v2 decision 写入记录。

### `app/pet_state/harness.py`

- 定义 `PetStateHarnessPolicy` 和 `HARNESS_VERSION = 2`。
- 按固定顺序执行弱证据降置信、单轮 affect 限幅、极端 mood 跳变拒绝、mood / affect 明显矛盾拒绝、forced 审计。
- 只接收已通过 schema 的 `PetState` candidate，不做 I/O，不调用模型，不持有 UI 或 Store 状态。
- 返回 reviewed state 与字段级 rule trace。

### `app/pet_state/store.py`

- `PetStateStore(QObject)` 是本地状态权威。
- `snapshot()` 返回当前完整记录。
- `update_from_reply(delta)` 接受结构化回复中的原始 delta，保留未知字段供 schema / harness 拒绝。
- `update_from_tool(arguments)` 接受 `{"delta": ...}`，作为显式调试和兼容入口。
- 两个入口最终复用同一提交函数，先成功落盘，再替换内存状态并发送 signal。
- 写入成功后发出 `state_changed` signal。
- 读取失败或文件损坏时回退默认状态。

### `app/pet_state/tools.py`

- 注册工具组 `pet_state`。
- `pet_state_get` 读取当前快照。
- `pet_state_update` 保留为兼容和调试入口。

### `app/pet_state/prompting.py`

- `build_pet_state_context_message(snapshot)` 构造本轮 system context。
- 上下文明确说明：
  - `pet_state` 是跨轮次状态。
  - `tone` / `portrait` 是当前回复段表现。
  - 最终 JSON 必须包含 `pet_state_delta`。
  - `pet_state_delta` 不允许写 `display`。
  - 普通回复不调用 `pet_state_update`，避免工具路径和最终回复路径双写。

### `app/llm/chat_reply.py`

- `ChatReply` 新增 `pet_state_delta` 字段。
- `parse_chat_reply_result()` 保留顶层 `pet_state_delta`。
- `sanitize_reply_tones()` 修正 tone 时保留 `pet_state_delta`。

### `app/llm/api_client.py`

- `OpenAICompatibleClient.chat(..., require_pet_state_delta=True)` 在工具总结路径要求补齐状态 delta。
- 如果首次回复缺少 `pet_state_delta`，会以低温度请求模型修复一次 JSON。

### `app/agent/runtime.py`

- 常规 tool loop 最终回复走 `_parse_final_reply_with_retry()`。
- 当 working messages 中包含 `pet_state_delta` 契约时，缺失 delta 会触发一次结构修复。
- `_build_tool_system_prompt()` 仍保留 `pet_state_get/update` 工具说明，方便模型读取状态或调试。
- 主动事件的 `event_messages` 也会检测 `pet_state_delta` 契约。

### `app/ui/pet_window.py`

- 用户消息路径：
  - `_add_pet_state_context_to_messages()` 将 store snapshot 注入 request messages。
- 主动事件路径：
  - `_event_with_pet_state_context()` 将状态快照和回复契约放入 event payload。
- 回复消费路径：
  - `_apply_reply_pet_state_delta()` 在记录历史和显示前应用 `reply.pet_state_delta`。
  - 应用失败只写 debug log，不阻断回复展示。
- UI：
  - 右键菜单“桌宠状态”为 checkable action。
  - `ui.pet_state_popup_pinned` 控制状态气泡常显。
  - 状态气泡可拖动，使用对话气泡同款圆角样式。
  - 状态气泡置顶状态跟随主窗口 `always_on_top_enabled`。

### `app/core/bootstrap.py` / `app/core/app_context.py`

- 启动时创建 `PetStateStore`。
- 将 store 放入 `AppContext`。
- 内置工具注册时传入 store。

### `app/storage/paths.py`

- `data/pet_state/<character_id>.json` 是每个角色独立的状态文件。
- `StoragePaths.ensure_dirs()` 会创建 `data/pet_state/`。

## UI 行为

右键菜单：

- “桌宠状态”是可勾选项。
- 勾选：显示状态气泡，并保存 `ui.pet_state_popup_pinned = true`。
- 取消勾选：隐藏状态气泡，并保存 `ui.pet_state_popup_pinned = false`。
- 隐藏到托盘时状态气泡会一起隐藏。
- 桌宠恢复显示后，如果配置仍为勾选，会自动恢复状态气泡。

状态气泡：

- 独立顶层工具窗口。
- 可拖动。
- 使用 `#petStatePopupBubble` QSS，样式与 `#speechBubble` 保持一致。
- 展示中文键值，而不是原始 JSON。
- 只显示本地确认后的状态、审计和 harness 决策。
- 置顶状态跟随主窗口；主窗口不置顶时，状态气泡也不额外置顶。

显示字段：

- 心情
- 愉悦度
- 活跃度
- 置信度
- 判断信号
- 触发来源
- 判断依据
- 待机表情
- 更新时间
- 本地裁决
- 最近提交 / forced 审计

## 工具接口

### `pet_state_get`

用途：读取当前桌宠状态、最近一次模型提交和 harness 决策。

Schema：

```json
{
  "type": "object",
  "properties": {},
  "required": []
}
```

### `pet_state_update`

用途：兼容工具调用路径，提交状态修改建议。

Schema：

```json
{
  "type": "object",
  "properties": {
    "delta": {
      "type": "object",
      "properties": {
        "mood": {"type": "string"},
        "affect": {"type": "object"},
        "evidence": {"type": "object"}
      }
    },
    "forced": {"type": "boolean"},
    "force_fields": {
      "type": "array",
      "items": {"type": "string"}
    },
    "force_reason": {"type": "string"}
  },
  "required": ["delta"]
}
```

注意：

- 普通回复不依赖这个工具更新状态。
- 工具入口和结构化回复入口最终都复用 Store 内部的同一提交事务。
- `forced` 只记录请求，不绕过 schema、范围、长度、只读字段校验或 Phase 2 harness。

## 插件边界

当前 MVP 定性为宿主内置能力，不是外部插件：

- `PetStateStore` 由 `AppContext` 持有。
- 工具注册由内置工具系统完成。
- UI 更新依赖 Qt signal。
- 状态上下文由 `PetWindow` 主动注入模型请求。

不采用纯插件的原因：

- 当前插件 SDK 可以注册工具、动态上下文和私有存储，但不能扩展 `ChatReply` 顶层协议并消费 `pet_state_delta`。
- 插件 SDK 没有托盘菜单、独立状态气泡和置顶生命周期贡献点。
- 状态写入需要与宿主回复消费、角色切换、原子落盘和 Qt signal 保持同一事务边界。
- 若为此增加多组宿主扩展点，复杂度高于直接保留内置能力。

未来插件 SDK 可以扩展：

- 新权限：`pet_state`。
- `PluginContext.pet_state` 只暴露受限 facade。
- 第三方插件可读状态或提交 delta，但仍走同一个 store / harness。

## 线程与安全边界

- LLM 请求和工具执行在 worker 线程。
- `PetStateStore` 内部用 `RLock` 保护 `_record`。
- `state_changed` 通过 Qt signal 通知 UI。
- UI 不直接解析模型原始 JSON，只消费本地 store snapshot。
- 状态落盘使用 `atomic_write_text()`。
- 状态 delta 应用失败只记录 debug log，不阻断用户回复。

## 已完成测试覆盖

关键测试：

- `tests/unit/test_pet_state.py`
  - store 更新、钳制、持久化。
  - Phase 2 harness：affect 单轮限幅、弱 evidence 降置信、极端 mood 跳转拒绝、mood / affect 明显矛盾拒绝。
  - forced 请求审计，不覆盖最终裁决状态。
  - 旧 Phase 1 状态文件兼容读取，首次更新后写入 v2 decision。
  - `display` 只读保护。
  - 干净进程导入、未知字段拒绝、重复 delta noop、落盘失败回滚。
  - `pet_state_get/update` 工具路径。
  - pet state context 包含 `pet_state_delta` 契约。
- `tests/unit/test_api_client.py`
  - `ChatReply.pet_state_delta` 解析。
  - tone 清洗保留 pet_state delta。
- `tests/unit/test_agent_runtime.py`
  - 固定工具提示包含 pet_state 路由。
  - 缺少 `pet_state_delta` 时触发最终回复修复。
- `tests/ui/test_pet_window.py`
  - 右键菜单 checkable “桌宠状态”。
  - 状态气泡持久化显示/解除。
  - 状态气泡置顶跟随主窗口。
  - 结构化 `pet_state_delta` 应用到 store。
  - 兼容更新工具与最终 delta 的同轮去重。
  - 主动事件注入 `pet_state_context`。
- `tests/unit/test_bootstrap.py`
  - `AppContext` 创建 pet state store。
  - 内置工具注册 `pet_state_get/update`。

常用验证命令：

```bash
.venv/bin/python -m pytest -q tests/unit/test_pet_state.py tests/unit/test_api_client.py tests/unit/test_agent_runtime.py tests/ui/test_pet_window.py
.venv/bin/python -m pytest -q tests/unit/test_prompt_templates.py tests/integration/test_agent_core.py tests/integration/test_chat_worker.py tests/integration/test_chat_pipeline.py tests/integration/test_native_tool_calls.py
.venv/bin/python -m pytest -q
```

当前开发目录验证结果：

```text
1138 passed, 1 skipped
```

skip 是 CI 条件下跳过需要真实音频设备的 `AudioSinkPlayer` 测试。

## 后续路线

### Phase 2: 标准 Harness（已实现）

目标是把当前 MVP 的 schema / 数值钳制扩展为**确定性、可审计、可测试**的通用状态裁决。
Harness 只负责审核模型提交，不调用第二个模型，也不改变 `ChatReply.pet_state_delta`
和 `PetStateStore` 的对外接口。

### Phase 2.1 设计依据

- Russell 的环形情感模型将 affect 组织为 valence / arousal 连续维度，支持继续以当前
  `PetAffect` 数值作为变化限幅基础，而不是只依赖离散 mood。
- Marsella 与 Gratch 的情感计算综述强调 appraisal 与状态更新过程；在本项目中对应为：
  模型提交候选状态，宿主根据当前状态、证据和固定规则完成裁决。
- NIST AI 600-1 的风险管理思路支持把生成式输出视为不可信候选值，保留确定性边界、
  可追溯决策和失败降级。
- JSON Schema 2020-12 继续作为对象字段、类型和未知属性边界的语义参考；项目当前仍使用
  Python 本地校验，不为了 Phase 2 新增 JSON Schema 运行时依赖。

这些资料只支持状态维度、宿主裁决和可审计边界，不直接给出 Sakura 的阈值。阈值必须由
场景测试和后续真实交互样本校准，不能把论文中的实验参数直接移植为产品参数。

参考资料：

- James A. Russell, *A Circumplex Model of Affect* (1980), DOI:
  https://doi.org/10.1037/h0077714
- Stacy Marsella, Jonathan Gratch, *Computationally Modeling Human Emotion* (2014), DOI:
  https://doi.org/10.1145/2631912
- NIST, *Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile*,
  DOI: https://doi.org/10.6028/NIST.AI.600-1
- JSON Schema Draft 2020-12 Core: https://json-schema.org/draft/2020-12/json-schema-core

### Phase 2.2 处理链路

```text
raw pet_state_delta
  -> 现有 schema / 类型 / 只读字段校验
  -> evaluate_pet_state_delta(current, candidate, submitted_delta, policy)
  -> 字段级 applied / revised / rejected 结果
  -> 生成 candidate PetState + HarnessDecision
  -> PetStateStore 原子落盘
  -> 替换内存快照并发送 state_changed
```

实现边界：

- 新增 `app/pet_state/harness.py`，放置纯函数式裁决和不可变 policy；不把规则继续堆进 UI 或 Store。
- `PetStateStore` 仍是事务边界，只有落盘成功后才能替换内存状态并发送 signal。
- `models.py` 保留数据模型和基础 schema 校验；Harness 不接收未通过 schema 的对象。
- `pet_state_update` 与结构化回复继续复用同一 Harness，不产生两套裁决语义。
- 持久化记录新增 `harness_version` 和字段级 rule trace；读取旧 JSON 时使用兼容默认值。

### Phase 2.3 规则顺序

规则按固定顺序执行，后续规则只能进一步收紧，不能恢复前序已拒绝字段：

1. **硬边界**：沿用 mood 枚举、数值范围、文本长度、未知字段和只读 `display` 校验；失败时整次提交不落盘。
2. **证据质量**：`reason` 或 `last_user_signal` 缺失、仅空白或信息不足时，保留可用状态字段，
   但下调 `confidence` 并记录 `revised_fields`。
3. **连续维度限幅**：基于当前状态限制单次 `valence` / `arousal` 变化；只修正越界维度，
   不把整个 delta 一并拒绝。
4. **极端 mood 跳转**：从明显正向到明显负向（或反向）的离散 mood 跳转必须同时有明确
   `reason` 和可归因信号；证据不足时保留旧 mood，允许其他通过的字段落地。
5. **mood / affect 一致性**：只检查明显矛盾，不把角色表达差异编码成通用规则；冲突时优先
   保留连续 affect，将 mood 修正为旧值或 `neutral`，并留下 rule trace。
6. **forced 审计**：`forced` 永不绕过 schema 和只读边界。逐个记录 `force_fields` 是否请求、
   是否有效、最终是 applied / revised / rejected，以及 `force_reason`；未声明字段不享受 forced 语义。
7. **最终状态**：没有可见状态变化为 `noop`；全部字段通过为 `applied`；部分修正或拒绝为
   `revised`；没有任何可应用字段为 `rejected`；存在 forced 请求时通过单独字段记录，不再用
   `model_forced` 覆盖裁决结果。

### Phase 2.4 Policy 参数

所有产品阈值集中在不可变 `PetStateHarnessPolicy`，规则实现中禁止散落魔法数字。当前默认值如下：

| 参数 | 候选默认值 | 作用 |
|---|---:|---|
| `max_valence_step` | `0.35` | 单轮 valence 最大绝对变化 |
| `max_arousal_step` | `0.30` | 单轮 arousal 最大绝对变化 |
| `weak_evidence_confidence_cap` | `0.45` | 证据不足时 confidence 上限 |
| `min_reason_chars` | `8` | reason 的最低有效字符数 |
| `min_signal_chars` | `2` | last_user_signal 的最低有效字符数 |

首版不把这些参数暴露到普通设置 UI，避免用户配置面扩大；测试和未来角色特异 Harness 可显式注入
policy。真实样本显示误修正率偏高或偏低后，再讨论是否增加高级设置。

### Phase 2.5 审计结构

`last_harness_decision` 保留现有顶层字段，并新增可选字段：

```json
{
  "harness_version": 2,
  "status": "revised",
  "reason": "Phase 2 harness 已按本地规则修正或部分拒绝状态字段。",
  "revised_fields": ["affect.valence", "affect.confidence"],
  "rejected_fields": ["mood"],
  "forced_requested": false,
  "forced_fields": [],
  "rules": [
    {
      "id": "affect_step_limit",
      "outcome": "revised",
      "fields": ["affect.valence"],
      "reason": "单轮 affect 变化超过本地阈值，已限制步长。",
      "detail": {
        "requested": 0.9,
        "applied": 0.35,
        "max_step": 0.35
      }
    }
  ]
}
```

审计中不复制完整对话文本，只记录现有长度限制内的 evidence 和必要的字段前后值，避免状态文件
持续膨胀或额外保存敏感内容。

### Phase 2.6 已完成实施与验收

1. 已补场景化测试，覆盖正向、边界、矛盾、forced、旧记录迁移和落盘失败回滚。
2. 已新增 policy / decision 数据结构和旧 JSON 兼容读取。
3. 已实现纯 Harness 并接入 Store 的统一提交事务。
4. 状态气泡继续展示简化后的 revised / rejected 字段和说明；UI 不解释规则算法。
5. 已更新本文件与 `TECHNICAL_README.md` 的实际实现状态。
6. 每次提交前运行 `tests/unit/test_pet_state.py`、API/runtime/UI 相关测试，再运行全量 `pytest -q`。

最低验收场景：

- 合法小幅变化原样 applied。
- 大幅 affect 变化只被限幅，不丢失有效 evidence。
- 弱 evidence 导致 confidence 下调。
- 极端 mood 跳转证据不足时只拒绝 mood。
- forced 不能写 `display`、不能绕过范围，并产生字段级 trace。
- 同一输入、当前状态和 policy 必须得到完全一致的裁决结果。
- 旧 Phase 1 状态文件可无损加载，首次更新后写成 v2 审计格式。
- 原子写失败时内存、文件和 signal 均不表现为成功。

### Phase 2.7 风险与后续启示

- **过度限幅**会让状态显得迟钝：阈值必须通过真实场景回放校准，并观察 revised 比例。
- **低质量 evidence 判断**只做可解释的长度/空白规则，首版不引入额外 LLM 或文本分类器。
- **mood / affect 映射**存在文化和角色差异：通用 Harness 只拒绝明显矛盾，细粒度规则留给 Phase 3。
- **forced 语义**如果同时表示“调试覆盖”和“模型强烈建议”会混淆权限；Phase 2 只把它当审计标记，
  不提升模型权限。
- 字段级 rule trace 可作为后续校准数据源，但默认不上传、不跨角色聚合。

### Phase 3: 角色特异状态机

目标是基于角色包、游戏内文本或角色资料生成角色特异 harness，作为标准 harness 之后的增强层。

可能资产：

```json
{
  "pet_state_harness": "pet_state/harness.json"
}
```

角色特异 harness 可以包含：

- 角色状态枚举扩展。
- 游戏内文本证据片段。
- 状态转移图。
- mood 到 display label / idle expression hint 的映射。
- 角色特有的禁跳规则。
- 角色特有的 decay 规则。

角色特异 harness 不应该：

- 绕过 schema。
- 绕过 forced 审计。
- 直接操作 UI。
- 把大段游戏文本注入每轮模型上下文。

## 暂缓项

以下内容不进入当前 MVP：

- 基于游戏内文本自动提炼状态机。
- 状态驱动主动行为。
- 状态衰减和定时恢复。
- 多角色状态迁移策略。
- 第三方插件直接扩展 harness。
- 状态驱动空闲立绘自动切换。
