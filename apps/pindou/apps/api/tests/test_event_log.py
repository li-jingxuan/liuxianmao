from __future__ import annotations

import json

import pytest

from pindou.core import event_log
from pindou.core.event_log import write_event_log


def test_write_event_log_is_domain_agnostic_and_creates_directory(tmp_path) -> None:
    """通用模块可写入与键色无关的嵌套 JSON 事件。"""
    directory = tmp_path / "nested" / "log"

    path = write_event_log(
        "example_completed",
        {"request_id": "req_1", "result": {"count": 2, "labels": ["a", "b"]}},
        directory=directory,
    )

    assert path.parent == directory
    assert path.name.endswith("-example_completed.json")
    assert json.loads(path.read_text(encoding="utf-8")) == {
        "event": "example_completed",
        "request_id": "req_1",
        "result": {"count": 2, "labels": ["a", "b"]},
        "timestamp_ms": pytest.approx(path.stat().st_mtime_ns // 1_000_000, abs=1_000),
    }


def test_write_event_log_does_not_overwrite_same_millisecond_events(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(event_log.time, "time_ns", lambda: 1_700_000_000_001_000_000)
    suffixes = iter(("00000001", "00000002"))
    monkeypatch.setattr(event_log, "token_hex", lambda _size: next(suffixes))

    first = write_event_log("same_time", {"value": 1}, directory=tmp_path)
    second = write_event_log("same_time", {"value": 2}, directory=tmp_path)

    assert first != second
    assert json.loads(first.read_text(encoding="utf-8"))["value"] == 1
    assert json.loads(second.read_text(encoding="utf-8"))["value"] == 2


@pytest.mark.parametrize(
    ("event", "payload", "error_type"),
    [
        ("../unsafe", {}, ValueError),
        ("unsafe-name", {}, ValueError),
        ("valid_event", {"value": float("nan")}, ValueError),
        ("valid_event", {"value": object()}, TypeError),
        ("valid_event", {"event": "override"}, ValueError),
    ],
)
def test_write_event_log_rejects_unsafe_input(
    tmp_path,
    event: str,
    payload: dict[str, object],
    error_type: type[Exception],
) -> None:
    with pytest.raises(error_type):
        write_event_log(event, payload, directory=tmp_path)
