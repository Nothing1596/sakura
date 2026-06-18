from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.pet_state.models import PetAffect, PetState, display_for_mood


HARNESS_VERSION = 2


@dataclass(frozen=True)
class PetStateHarnessPolicy:
    max_valence_step: float = 0.35
    max_arousal_step: float = 0.30
    weak_evidence_confidence_cap: float = 0.45
    min_reason_chars: int = 8
    min_signal_chars: int = 2


DEFAULT_PET_STATE_HARNESS_POLICY = PetStateHarnessPolicy()

_POSITIVE_MOODS = {"happy", "curious"}
_NEGATIVE_MOODS = {"sad", "angry", "anxious", "tired"}


def evaluate_pet_state_delta(
    *,
    current: PetState,
    candidate: PetState,
    submitted_delta: dict[str, Any],
    schema_revised_fields: list[str],
    forced: bool = False,
    force_fields: list[str] | None = None,
    force_reason: str = "",
    policy: PetStateHarnessPolicy = DEFAULT_PET_STATE_HARNESS_POLICY,
) -> tuple[PetState, dict[str, Any]]:
    """Review a schema-valid pet_state candidate with deterministic local rules."""

    revised_fields = set(schema_revised_fields)
    rejected_fields: set[str] = set()
    rules: list[dict[str, Any]] = []

    mood = candidate.mood
    affect_values = candidate.affect.to_dict()
    weak_evidence = _weak_evidence_reasons(candidate, policy)

    if weak_evidence and affect_values["confidence"] > policy.weak_evidence_confidence_cap:
        affect_values["confidence"] = policy.weak_evidence_confidence_cap
        revised_fields.add("affect.confidence")
        rules.append(
            _rule(
                "weak_evidence_confidence_cap",
                "revised",
                ["affect.confidence"],
                "依据不足，降低本次状态判断置信度。",
                {"weak_evidence": weak_evidence},
            )
        )

    _limit_affect_step(
        current=current,
        submitted_delta=submitted_delta,
        affect_values=affect_values,
        field_name="valence",
        maximum_step=policy.max_valence_step,
        revised_fields=revised_fields,
        rules=rules,
    )
    _limit_affect_step(
        current=current,
        submitted_delta=submitted_delta,
        affect_values=affect_values,
        field_name="arousal",
        maximum_step=policy.max_arousal_step,
        revised_fields=revised_fields,
        rules=rules,
    )

    if _delta_has_field(submitted_delta, "mood") and mood != current.mood:
        if weak_evidence and _is_extreme_mood_jump(current.mood, mood):
            rules.append(
                _rule(
                    "extreme_mood_jump_requires_evidence",
                    "rejected",
                    ["mood"],
                    "缺少足够依据时拒绝跨极性心情跳变。",
                    {"from": current.mood, "to": mood, "weak_evidence": weak_evidence},
                )
            )
            mood = current.mood
            rejected_fields.add("mood")

    if _delta_has_field(submitted_delta, "mood") and "mood" not in rejected_fields:
        contradiction = _mood_affect_contradiction(mood, affect_values)
        if contradiction:
            rules.append(
                _rule(
                    "mood_affect_consistency",
                    "rejected",
                    ["mood"],
                    contradiction,
                    {"mood": mood, "affect": dict(affect_values)},
                )
            )
            mood = current.mood
            rejected_fields.add("mood")

    if forced:
        rules.append(
            _rule(
                "forced_request_audit",
                "audited",
                sorted(set(force_fields or [])),
                "模型请求 forced；Phase 2 记录请求但不绕过本地 harness。",
                {"force_reason": force_reason} if force_reason else {},
            )
        )

    reviewed = PetState(
        mood=mood,
        affect=PetAffect(**affect_values),
        evidence=candidate.evidence,
        display=display_for_mood(mood),
        updated_at=current.updated_at,
    )
    decision = _build_decision(
        current=current,
        reviewed=reviewed,
        revised_fields=sorted(revised_fields),
        rejected_fields=sorted(rejected_fields),
        forced=forced,
        force_fields=force_fields or [],
        force_reason=force_reason,
        rules=rules,
    )
    return reviewed, decision


def _weak_evidence_reasons(
    candidate: PetState,
    policy: PetStateHarnessPolicy,
) -> list[str]:
    reasons: list[str] = []
    if len(candidate.evidence.reason.strip()) < policy.min_reason_chars:
        reasons.append("evidence.reason")
    if len(candidate.evidence.last_user_signal.strip()) < policy.min_signal_chars:
        reasons.append("evidence.last_user_signal")
    return reasons


def _limit_affect_step(
    *,
    current: PetState,
    submitted_delta: dict[str, Any],
    affect_values: dict[str, float],
    field_name: str,
    maximum_step: float,
    revised_fields: set[str],
    rules: list[dict[str, Any]],
) -> None:
    if not _delta_has_affect_field(submitted_delta, field_name):
        return
    old_value = getattr(current.affect, field_name)
    target_value = affect_values[field_name]
    limited = _limited_step(old_value, target_value, maximum_step)
    if limited == target_value:
        return
    affect_values[field_name] = limited
    field_path = f"affect.{field_name}"
    revised_fields.add(field_path)
    rules.append(
        _rule(
            "affect_step_limit",
            "revised",
            [field_path],
            "单轮 affect 变化超过本地阈值，已限制步长。",
            {
                "from": old_value,
                "requested": target_value,
                "applied": limited,
                "max_step": maximum_step,
            },
        )
    )


def _limited_step(old_value: float, target_value: float, maximum_step: float) -> float:
    delta = target_value - old_value
    if abs(delta) <= maximum_step:
        return target_value
    direction = 1.0 if delta > 0 else -1.0
    return round(old_value + direction * maximum_step, 6)


def _is_extreme_mood_jump(current_mood: str, candidate_mood: str) -> bool:
    current_polarity = _mood_polarity(current_mood)
    candidate_polarity = _mood_polarity(candidate_mood)
    return current_polarity * candidate_polarity == -1


def _mood_polarity(mood: str) -> int:
    if mood in _POSITIVE_MOODS:
        return 1
    if mood in _NEGATIVE_MOODS:
        return -1
    return 0


def _mood_affect_contradiction(mood: str, affect_values: dict[str, float]) -> str:
    valence = affect_values["valence"]
    arousal = affect_values["arousal"]
    if mood in _POSITIVE_MOODS and valence < -0.20:
        return "正向心情不能与明显负向 valence 同时提交。"
    if mood in _NEGATIVE_MOODS and valence > 0.35:
        return "负向心情不能与明显正向 valence 同时提交。"
    if mood == "tired" and arousal > 0.75:
        return "疲惫状态不能与高 arousal 同时提交。"
    return ""


def _delta_has_affect_field(delta: dict[str, Any], field_name: str) -> bool:
    affect = delta.get("affect")
    return isinstance(affect, dict) and field_name in affect


def _delta_has_field(delta: dict[str, Any], field_name: str) -> bool:
    return field_name in delta


def _build_decision(
    *,
    current: PetState,
    reviewed: PetState,
    revised_fields: list[str],
    rejected_fields: list[str],
    forced: bool,
    force_fields: list[str],
    force_reason: str,
    rules: list[dict[str, Any]],
) -> dict[str, Any]:
    changed = current.to_dict() != reviewed.to_dict()
    if not changed and not revised_fields and not rejected_fields:
        status = "noop"
        reason = "delta 没有造成状态变化。"
    elif rejected_fields and not changed and not revised_fields:
        status = "rejected"
        reason = "Phase 2 harness 已拒绝缺少依据或自相矛盾的状态字段。"
    elif revised_fields or rejected_fields:
        status = "revised"
        reason = "Phase 2 harness 已按本地规则修正或部分拒绝状态字段。"
    else:
        status = "applied"
        reason = "Phase 2 harness 已通过本地规则并应用。"

    decision: dict[str, Any] = {
        "status": status,
        "reason": reason,
        "harness_version": HARNESS_VERSION,
        "revised_fields": revised_fields,
        "rejected_fields": rejected_fields,
        "forced_requested": bool(forced),
        "forced_fields": sorted(set(force_fields)),
        "rules": rules,
    }
    if force_reason:
        decision["force_reason"] = force_reason
    return decision


def _rule(
    rule_id: str,
    outcome: str,
    fields: list[str],
    reason: str,
    detail: dict[str, Any] | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "id": rule_id,
        "outcome": outcome,
        "fields": fields,
        "reason": reason,
    }
    if detail:
        result["detail"] = detail
    return result
