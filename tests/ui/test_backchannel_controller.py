from __future__ import annotations

import os
import random

import pytest

pytest.importorskip("PySide6.QtWidgets")

from app.backchannel.classifier import RuleClassifier  # noqa: E402
from app.backchannel.controller import BackchannelController  # noqa: E402
from app.backchannel.models import (  # noqa: E402
    BackchannelManifest,
    BackchannelTemplate,
    BackchannelVariant,
)
from app.backchannel.resolver import BackchannelChoice  # noqa: E402
from app.config.settings_service import BackchannelSettings  # noqa: E402


def _qt_app_or_skip():  # type: ignore[no-untyped-def]
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    qtwidgets = pytest.importorskip("PySide6.QtWidgets")
    return qtwidgets.QApplication.instance() or qtwidgets.QApplication([])


def _manifest() -> BackchannelManifest:
    return BackchannelManifest(
        templates=(
            BackchannelTemplate(
                id="fb",
                tone="中性",
                portrait="站立待机",
                variants=(BackchannelVariant(ja="うん。", zh="嗯。"),),
                intent="fallback",
            ),
            BackchannelTemplate(
                id="err",
                tone="不满",
                portrait="不满无语",
                variants=(BackchannelVariant(ja="見てみる。", zh="我看看。"),),
                intent="error",
                emotion="frustrated",
            ),
        )
    )


def _make(
    displayed: list[BackchannelChoice],
    *,
    enabled: bool = True,
    probability: float = 1.0,
    manifest: BackchannelManifest | None = None,
) -> BackchannelController:
    controller = BackchannelController(
        RuleClassifier(),
        displayed.append,
        settings=BackchannelSettings(enabled=enabled, probability=probability),
        rng=random.Random(7),
    )
    if manifest is not None:
        controller.set_manifest(manifest)
    return controller


def test_schedule_arms_timer_and_timeout_displays() -> None:
    _qt_app_or_skip()
    displayed: list[BackchannelChoice] = []
    controller = _make(displayed, manifest=_manifest())
    controller.schedule("报错了,又失败")
    assert controller.is_pending
    assert controller._timer.isActive()
    # 直接触发超时回调(不等真实计时),与现有 bubble_auto_hide 测试风格一致。
    controller._on_timeout()
    assert len(displayed) == 1
    assert displayed[0].template.id == "err"
    assert not controller.is_pending


def test_chat_text_falls_to_fallback_template() -> None:
    _qt_app_or_skip()
    displayed: list[BackchannelChoice] = []
    controller = _make(displayed, manifest=_manifest())
    controller.schedule("今天天气不错")  # 无分类信号 → 兜底池
    controller._on_timeout()
    assert len(displayed) == 1
    assert displayed[0].template.id == "fb"


def test_cancel_prevents_display() -> None:
    _qt_app_or_skip()
    displayed: list[BackchannelChoice] = []
    controller = _make(displayed, manifest=_manifest())
    controller.schedule("报错了")
    controller.cancel()
    assert not controller._timer.isActive()
    # 模拟 timeout 事件已入队但 cancel 先处理的窄竞态:直接调回调不应显示。
    controller._on_timeout()
    assert displayed == []


def test_disabled_settings_never_arm() -> None:
    _qt_app_or_skip()
    displayed: list[BackchannelChoice] = []
    controller = _make(displayed, enabled=False, manifest=_manifest())
    controller.schedule("报错了")
    assert not controller.is_pending
    assert not controller._timer.isActive()


def test_no_manifest_never_arms() -> None:
    # 角色未提供清单(opt-out)→ 功能空转。
    _qt_app_or_skip()
    displayed: list[BackchannelChoice] = []
    controller = _make(displayed)
    controller.schedule("报错了")
    assert not controller.is_pending


def test_zero_probability_never_arms() -> None:
    _qt_app_or_skip()
    displayed: list[BackchannelChoice] = []
    controller = _make(displayed, probability=0.0, manifest=_manifest())
    for _ in range(5):
        controller.schedule("报错了")
        assert not controller.is_pending


def test_blank_text_never_arms() -> None:
    _qt_app_or_skip()
    displayed: list[BackchannelChoice] = []
    controller = _make(displayed, manifest=_manifest())
    controller.schedule("   ")
    assert not controller.is_pending


def test_set_manifest_none_cancels_and_disarms() -> None:
    # 切换到 opt-out 角色:取消在途接话并停用。
    _qt_app_or_skip()
    displayed: list[BackchannelChoice] = []
    controller = _make(displayed, manifest=_manifest())
    controller.schedule("报错了")
    controller.set_manifest(None)
    assert not controller.is_pending
    controller.schedule("报错了")
    assert not controller.is_pending


def test_set_settings_disable_cancels_pending() -> None:
    _qt_app_or_skip()
    displayed: list[BackchannelChoice] = []
    controller = _make(displayed, manifest=_manifest())
    controller.schedule("报错了")
    controller.set_settings(BackchannelSettings(enabled=False))
    assert not controller.is_pending
    controller._on_timeout()
    assert displayed == []
