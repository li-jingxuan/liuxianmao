from __future__ import annotations

from pindou import cli
from pindou.core.config import Settings


def test_cli_listens_on_all_interfaces_by_default(monkeypatch) -> None:
    """统一启动入口默认绑定 0.0.0.0，使局域网 IP 可访问。"""
    captured: dict[str, object] = {}
    settings = Settings(
        _env_file=None,
        image_enhancer="passthrough",
        api_host="0.0.0.0",
        api_port=8123,
        api_reload=False,
    )
    monkeypatch.setattr(cli, "get_settings", lambda: settings)
    monkeypatch.setattr(
        cli.uvicorn,
        "run",
        lambda app, **kwargs: captured.update(app=app, **kwargs),
    )

    cli.main()

    assert captured == {
        "app": "pindou.main:app",
        "host": "0.0.0.0",
        "port": 8123,
        "reload": False,
    }
