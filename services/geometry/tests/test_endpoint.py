"""End-to-end /convert against a local HTTP server playing the storage role."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Iterator

import pytest

pytest.importorskip("OCP")

from fastapi.testclient import TestClient

from app.main import app


class _Storage:
    def __init__(self, source_bytes: bytes) -> None:
        self.source_bytes = source_bytes
        self.puts: dict[str, bytes] = {}


class _Handler(BaseHTTPRequestHandler):
    storage: _Storage

    def do_GET(self) -> None:
        self.send_response(200)
        self.send_header("Content-Length", str(len(self.storage.source_bytes)))
        self.end_headers()
        self.wfile.write(self.storage.source_bytes)

    def do_PUT(self) -> None:
        length = int(self.headers["Content-Length"])
        self.storage.puts[self.path] = self.rfile.read(length)
        self.send_response(200)
        self.end_headers()

    def log_message(self, *args: object) -> None:  # silence test output
        pass


@pytest.fixture
def storage_server(step_fixtures: dict[str, Path]) -> Iterator[tuple[str, _Storage]]:
    storage = _Storage(step_fixtures["plates"].read_bytes())
    handler = type("Handler", (_Handler,), {"storage": storage})
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}", storage
    finally:
        server.shutdown()


def test_convert_endpoint_round_trip(
    storage_server: tuple[str, _Storage], monkeypatch: pytest.MonkeyPatch
) -> None:
    base_url, storage = storage_server
    monkeypatch.setenv("GEOMETRY_SERVICE_API_KEY", "secret")

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
