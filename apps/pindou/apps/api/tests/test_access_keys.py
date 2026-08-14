from __future__ import annotations

from conftest import make_png_bytes
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from pindou.db.session import get_engine
from pindou.models import ApiAccessKey, ApiKeyUsage
from pindou.services.access_keys import KeyPrefixService


def _conversion_request(
    client: TestClient,
    *,
    api_key: str,
    grid_size: str = "8",
    request_id: str | None = None,
):
    headers = {"X-API-Key": api_key}
    if request_id is not None:
        headers["X-Request-ID"] = request_id
    return client.post(
        "/api/v1/conversions",
        headers=headers,
        files={"image": ("source.png", make_png_bytes(), "image/png")},
        data={
            "grid_size": grid_size,
            "color_set_size": "24",
            "background_mode": "keep",
        },
    )


def test_access_key_requires_admin_key(client: TestClient) -> None:
    response = client.post(
        "/api/v1/access-keys",
        json={"prefix": "web", "allowed_uses": 2},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "ADMIN_API_KEY_INVALID"
    assert response.headers["www-authenticate"] == "ApiKey"


def test_access_key_is_issued_with_registered_source_prefix(client: TestClient) -> None:
    response = client.post(
        "/api/v1/access-keys",
        headers={"X-Admin-API-Key": "test-admin-key"},
        json={"prefix": "web", "allowed_uses": 2},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["key"].startswith("pdk_web_")
    assert payload["prefix"] == "web"
    assert payload["allowed_uses"] == payload["remaining_uses"] == 2

    with Session(get_engine()) as session:
        stored = session.exec(select(ApiAccessKey)).all()
    assert all(item.key_hash != payload["key"].encode() for item in stored)
    assert all(payload["key"] not in item.key_preview for item in stored)


def test_unknown_or_disabled_prefix_cannot_issue_key(client: TestClient) -> None:
    unknown = client.post(
        "/api/v1/access-keys",
        headers={"X-Admin-API-Key": "test-admin-key"},
        json={"prefix": "unknown", "allowed_uses": 2},
    )
    with Session(get_engine()) as session:
        KeyPrefixService(session).set_active("web", is_active=False)
    disabled = client.post(
        "/api/v1/access-keys",
        headers={"X-Admin-API-Key": "test-admin-key"},
        json={"prefix": "web", "allowed_uses": 2},
    )

    assert unknown.status_code == disabled.status_code == 400
    assert unknown.json()["error"]["code"] == "KEY_PREFIX_INVALID"
    assert disabled.json()["error"]["code"] == "KEY_PREFIX_INVALID"


def test_access_key_request_uses_strict_validation(client: TestClient) -> None:
    invalid_prefix = client.post(
        "/api/v1/access-keys",
        headers={"X-Admin-API-Key": "test-admin-key"},
        json={"prefix": "Web_App", "allowed_uses": 2},
    )
    boolean_uses = client.post(
        "/api/v1/access-keys",
        headers={"X-Admin-API-Key": "test-admin-key"},
        json={"prefix": "web", "allowed_uses": True},
    )

    assert invalid_prefix.status_code == 422
    assert boolean_uses.status_code == 422


def test_conversion_consumes_exact_number_of_uses(client: TestClient) -> None:
    issue_response = client.post(
        "/api/v1/access-keys",
        headers={"X-Admin-API-Key": "test-admin-key"},
        json={"prefix": "web", "allowed_uses": 2},
    )
    api_key = issue_response.json()["key"]

    first = _conversion_request(client, api_key=api_key, request_id="req_usage_first")
    second = _conversion_request(client, api_key=api_key, request_id="req_usage_second")
    exhausted = _conversion_request(client, api_key=api_key)

    assert first.status_code == second.status_code == 200
    assert first.headers["x-ratelimit-limit"] == "2"
    assert first.headers["x-ratelimit-remaining"] == "1"
    assert second.headers["x-ratelimit-remaining"] == "0"
    assert exhausted.status_code == 401
    assert exhausted.json()["error"]["code"] == "API_KEY_INVALID_OR_EXHAUSTED"

    with Session(get_engine()) as session:
        history = session.exec(select(ApiKeyUsage).order_by(ApiKeyUsage.consumed_at)).all()
    matching_history = [item for item in history if item.request_id.startswith("req_usage_")]
    assert [item.request_id for item in matching_history] == [
        "req_usage_first",
        "req_usage_second",
    ]
    assert [item.remaining_uses_after for item in matching_history] == [1, 0]
    assert all(item.operation == "conversion" for item in matching_history)


def test_invalid_conversion_does_not_consume_use(client: TestClient) -> None:
    issue_response = client.post(
        "/api/v1/access-keys",
        headers={"X-Admin-API-Key": "test-admin-key"},
        json={"prefix": "web", "allowed_uses": 1},
    )
    api_key = issue_response.json()["key"]

    invalid = _conversion_request(client, api_key=api_key, grid_size="7")
    valid = _conversion_request(client, api_key=api_key)

    assert invalid.status_code == 400
    assert valid.status_code == 200
    assert valid.headers["x-ratelimit-remaining"] == "0"
    with Session(get_engine()) as session:
        assert len(session.exec(select(ApiKeyUsage)).all()) == 1


def test_readiness_checks_database(client: TestClient) -> None:
    response = client.get("/readyz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
