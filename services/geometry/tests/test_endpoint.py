"""End-to-end /convert against a local HTTP server playing the storage role."""

import json

import pytest

pytest.importorskip("OCP")

from fastapi.testclient import TestClient

from app.main import app



def test_convert_endpoint_round_trip(
    storage_server: tuple[str, "object"], monkeypatch: pytest.MonkeyPatch
) -> None:
    base_url, storage = storage_server
    monkeypatch.setenv("GEOMETRY_SERVICE_API_KEY", "secret")
    monkeypatch.setenv("GEOMETRY_DEV_MODE", "true")

    client = TestClient(app)
    response = client.post(
        "/convert",
        json={
            "jobId": "test-job",
            "source": {"url": f"{base_url}/source.step", "format": "step"},
            "outputs": {
                "glb": {"url": f"{base_url}/out/model.glb"},
                "graph": {"url": f"{base_url}/out/graph.json"},
            },
            "options": {"linearDeflection": 0.1, "angularDeflection": 0.5},
        },
        headers={"Authorization": "Bearer secret"},
    )
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["ok"] is True
    assert body["partCount"] == 5
    assert body["unit"] == "mm"
    assert body["stats"]["convertMs"] >= 0
    assert body["stats"]["meshTriangles"] > 0

    glb = storage.puts["/out/model.glb"]
    assert glb[:4] == b"glTF"
    graph = json.loads(storage.puts["/out/graph.json"])
    assert graph["partCount"] == 5
    assert graph["root"]["isAssembly"] is True


def test_convert_endpoint_read_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEOMETRY_SERVICE_API_KEY", "secret")
    monkeypatch.setenv("GEOMETRY_DEV_MODE", "true")
    client = TestClient(app)
    response = client.post(
        "/convert",
        json={
            "jobId": "bad-job",
            "source": {"url": "http://127.0.0.1:1/missing.step", "format": "step"},
            "outputs": {
                "glb": {"url": "http://127.0.0.1:1/a"},
                "graph": {"url": "http://127.0.0.1:1/b"},
            },
        },
        headers={"Authorization": "Bearer secret"},
    )
    assert response.status_code == 422
    body = response.json()
    assert body["ok"] is False
    assert body["code"] == "READ_FAILED"
