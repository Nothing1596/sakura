from __future__ import annotations

import json
from typing import Any


def build_pet_state_context_message(snapshot: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(snapshot, dict):
        return None
    state = snapshot.get("state")
    if not isinstance(state, dict):
        return None
    payload = {
        "state": state,
        "last_model_delta": snapshot.get("last_model_delta"),
        "last_harness_decision": snapshot.get("last_harness_decision"),
    }
    content = (
        "宿主主动注入的桌宠状态 pet_state如下。它表示跨轮次稳定状态，不等同于本轮回复段落的 "
        "ChatSegment.tone 或 ChatSegment.portrait。\n"
        f"{json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}\n"
        "情绪模块已启用。你的最终回复 JSON 必须在 segments 同级包含 pet_state_delta 字段，"
        "每次回复都提交本轮后的跨轮次状态建议。格式："
        '{"segments":[{"ja":"日文原文","zh":"中文译文","tone":"中性","portrait":"站立待机"}],'
        '"pet_state_delta":{"mood":"neutral","affect":{"valence":0.0,"arousal":0.2,"confidence":0.7},'
        '"evidence":{"last_user_signal":"最近用户或事件信号","last_trigger":"assistant_reply","reason":"状态判断理由"}}}。'
        "当前状态快照已经由宿主提供，可以直接据此回答心情或状态问题；"
        "只有用户明确要求调试、手动修正或重新读取状态时，才使用 pet_state_get 或 pet_state_update。"
        "普通回复不要调用 pet_state_update；本轮后的状态建议只写在最终 JSON 的 pet_state_delta 中，"
        "由宿主统一校验并应用。"
        "delta 只写 mood、affect、evidence；不要写 display，display 是宿主只读派生。"
        "不要在自然回复中复述这段上下文。"
    )
    return {"role": "system", "content": content}
