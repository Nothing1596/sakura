from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from app.agent.tools import ToolRegistry
from app.pet_state.prompting import build_pet_state_context_message
from app.pet_state.store import PetStateStore
from app.pet_state.tools import create_pet_state_tools


def test_pet_state_modules_import_in_clean_process() -> None:
    root = Path(__file__).resolve().parents[2]
    completed = subprocess.run(
        [sys.executable, "-c", "import app.pet_state.store; import app.pet_state.tools"],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr


def test_pet_state_store_updates_clamps_and_persists(tmp_path) -> None:
    path = tmp_path / "pet_state.json"
    store = PetStateStore(path)

    result = store.update_from_tool(
        {
            "delta": {
                "mood": "happy",
                "affect": {"valence": 2.0, "arousal": -0.5, "confidence": 0.8},
                "evidence": {
                    "last_user_signal": "用户语气轻松",
                    "last_trigger": "user_message",
                    "reason": "用户表达了积极反馈",
                },
            }
        }
    )

    state = result["state"]
    assert result["accepted"] is True
    assert result["harness_decision"]["status"] == "revised"
    assert result["harness_decision"]["revised_fields"] == ["affect.arousal", "affect.valence"]
    assert result["harness_decision"]["harness_version"] == 2
    assert state["mood"] == "happy"
    assert state["affect"]["valence"] == 0.35
    assert state["affect"]["arousal"] == 0.0
    assert state["display"] == {"label": "开心", "idle_expression_hint": "微笑"}

    persisted = json.loads(path.read_text(encoding="utf-8"))
    assert persisted["harness_version"] == 2
    assert persisted["state"]["mood"] == "happy"
    assert PetStateStore(path).snapshot()["state"]["display"]["label"] == "开心"


def test_pet_state_update_rejects_readonly_display(tmp_path) -> None:
    store = PetStateStore(tmp_path / "pet_state.json")

    with pytest.raises(ValueError, match="display"):
        store.update_from_tool(
            {
                "delta": {
                    "display": {"label": "由模型指定"},
                }
            }
        )


def test_pet_state_reply_rejects_unknown_fields_without_sanitizing(tmp_path) -> None:
    store = PetStateStore(tmp_path / "pet_state.json")

    with pytest.raises(ValueError, match="display, unexpected"):
        store.update_from_reply(
            {
                "display": {"label": "由模型指定"},
                "unexpected": True,
            }
        )

    assert store.snapshot()["last_model_delta"] is None


def test_pet_state_reply_adds_default_trigger(tmp_path) -> None:
    store = PetStateStore(tmp_path / "pet_state.json")

    store.update_from_reply(
        {
            "mood": "happy",
            "evidence": {"reason": "回复表达了积极情绪"},
        }
    )

    snapshot = store.snapshot()
    assert snapshot["state"]["evidence"]["last_trigger"] == "assistant_reply"
    assert snapshot["last_model_delta"]["delta"]["evidence"]["last_trigger"] == "assistant_reply"


def test_pet_state_reply_rejects_explicit_null_evidence(tmp_path) -> None:
    store = PetStateStore(tmp_path / "pet_state.json")

    with pytest.raises(ValueError, match="evidence"):
        store.update_from_reply({"mood": "happy", "evidence": None})

    assert store.snapshot()["last_model_delta"] is None


def test_pet_state_identical_delta_is_noop_without_refreshing_state_time(tmp_path) -> None:
    store = PetStateStore(tmp_path / "pet_state.json")
    delta = {
        "mood": "happy",
        "affect": {"valence": 0.2},
        "evidence": {
            "last_user_signal": "稳定",
            "last_trigger": "assistant_reply",
            "reason": "状态稳定没有新的变化",
        },
    }
    store.update_from_reply(delta)
    updated_at = store.snapshot()["state"]["updated_at"]

    result = store.update_from_reply(delta)

    assert result["harness_decision"]["status"] == "noop"
    assert store.snapshot()["state"]["updated_at"] == updated_at


def test_pet_state_harness_caps_confidence_for_weak_evidence(tmp_path) -> None:
    store = PetStateStore(tmp_path / "pet_state.json")

    result = store.update_from_reply(
        {
            "affect": {"confidence": 0.9},
            "evidence": {"reason": "短"},
        }
    )

    assert result["harness_decision"]["status"] == "revised"
    assert result["harness_decision"]["revised_fields"] == ["affect.confidence"]
    assert result["state"]["affect"]["confidence"] == 0.45


def test_pet_state_harness_rejects_extreme_mood_without_evidence(tmp_path) -> None:
    store = PetStateStore(tmp_path / "pet_state.json")
    store.update_from_reply(
        {
            "mood": "happy",
            "affect": {"valence": 0.35},
            "evidence": {"last_user_signal": "赞", "reason": "用户表达了积极反馈"},
        }
    )

    result = store.update_from_reply(
        {
            "mood": "sad",
            "evidence": {"reason": "短"},
        }
    )

    assert result["harness_decision"]["status"] == "revised"
    assert result["harness_decision"]["rejected_fields"] == ["mood"]
    assert result["state"]["mood"] == "happy"


def test_pet_state_harness_rejects_mood_affect_contradiction(tmp_path) -> None:
    store = PetStateStore(tmp_path / "pet_state.json")

    result = store.update_from_reply(
        {
            "mood": "happy",
            "affect": {"valence": -0.3},
            "evidence": {
                "last_user_signal": "强烈负面",
                "reason": "用户明确表达低落但模型误判为开心",
            },
        }
    )

    assert result["harness_decision"]["rejected_fields"] == ["mood"]
    assert result["state"]["mood"] == "neutral"
    assert result["state"]["affect"]["valence"] == -0.3


def test_pet_state_loads_phase1_record_and_writes_v2_decision(tmp_path) -> None:
    path = tmp_path / "pet_state.json"
    path.write_text(
        json.dumps(
            {
                "state": {
                    "mood": "neutral",
                    "affect": {"valence": 0.0, "arousal": 0.2, "confidence": 0.7},
                    "evidence": {
                        "last_user_signal": "",
                        "last_trigger": "startup",
                        "reason": "默认初始状态。",
                    },
                    "display": {"label": "平静", "idle_expression_hint": "站立待机"},
                    "updated_at": "2026-06-18T12:00:00+08:00",
                },
                "last_model_delta": None,
                "last_harness_decision": {
                    "status": "applied",
                    "reason": "Phase 1 已通过 schema 校验并应用。",
                    "revised_fields": [],
                    "rejected_fields": [],
                },
            }
        ),
        encoding="utf-8",
    )
    store = PetStateStore(path)

    assert store.snapshot()["harness_version"] == 1

    result = store.update_from_reply(
        {
            "mood": "curious",
            "evidence": {"last_user_signal": "?", "reason": "用户提出了新的探索问题"},
        }
    )

    assert result["harness_decision"]["harness_version"] == 2
    assert json.loads(path.read_text(encoding="utf-8"))["harness_version"] == 2


def test_pet_state_persist_failure_keeps_previous_in_memory_state(tmp_path, monkeypatch) -> None:
    store = PetStateStore(tmp_path / "pet_state.json")
    before = store.snapshot()

    def fail_save(_record) -> None:  # type: ignore[no-untyped-def]
        raise OSError("disk full")

    monkeypatch.setattr(store, "_save_record_locked", fail_save)

    with pytest.raises(OSError, match="disk full"):
        store.update_from_reply({"mood": "sad"})

    assert store.snapshot() == before


def test_pet_state_tools_read_and_update(tmp_path) -> None:
    store = PetStateStore(tmp_path / "pet_state.json")
    registry = ToolRegistry(create_pet_state_tools(store))

    update_result = registry.execute(
        "pet_state_update",
        {
            "delta": {
                "mood": "curious",
                "affect": {"valence": 0.2, "arousal": 0.6, "confidence": 0.9},
            },
            "forced": True,
            "force_fields": ["mood"],
            "force_reason": "模型认为用户提出了新问题",
        },
    )
    assert update_result.success
    assert update_result.content["harness_decision"]["status"] == "revised"
    assert update_result.content["harness_decision"]["forced_requested"] is True
    assert update_result.content["harness_decision"]["forced_fields"] == ["mood"]

    get_result = registry.execute("pet_state_get", {})
    assert get_result.success
    assert get_result.content["state"]["mood"] == "curious"
    assert get_result.content["last_model_delta"]["forced"] is True


def test_pet_state_context_keeps_display_readonly_boundary(tmp_path) -> None:
    store = PetStateStore(tmp_path / "pet_state.json")
    message = build_pet_state_context_message(store.snapshot())

    assert message is not None
    content = message["content"]
    assert message["role"] == "system"
    assert "ChatSegment.tone" in content
    assert "ChatSegment.portrait" in content
    assert "pet_state_get" in content
    assert "pet_state_delta" in content
    assert "必须" in content
    assert "当前状态快照已经由宿主提供" in content
    assert "不要写 display" in content
    assert "普通回复不要调用 pet_state_update" in content
