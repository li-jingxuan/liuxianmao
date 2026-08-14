from __future__ import annotations

from sqlmodel import Session, select

from pindou import cli
from pindou.core.config import Settings
from pindou.db.session import get_engine
from pindou.models import ApiKeyPrefix


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


def test_cli_dynamically_adds_and_disables_source_prefix(monkeypatch, capsys) -> None:
    monkeypatch.setattr(
        cli.sys,
        "argv",
        ["pindou-api", "key-prefix", "add", "wechat", "--name", "微信小程序"],
    )
    cli.main()
    assert "wechat\t微信小程序\tactive=true" in capsys.readouterr().out

    monkeypatch.setattr(
        cli.sys,
        "argv",
        ["pindou-api", "key-prefix", "disable", "wechat"],
    )
    cli.main()
    assert "wechat\t微信小程序\tactive=false" in capsys.readouterr().out

    with Session(get_engine()) as session:
        prefix = session.exec(
            select(ApiKeyPrefix).where(ApiKeyPrefix.code == "wechat")
        ).one()
        assert prefix.is_active is False
