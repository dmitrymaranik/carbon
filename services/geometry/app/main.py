"""FastAPI entrypoint for the Carbon geometry service.

Wire format is defined in docs/specs/animated-work-instructions-contracts.md.
"""

import json
import logging
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app import __version__, config
from app.auth import require_auth
from app.errors import ConvertError
from app.schemas import ConvertRequest, ConvertResponse, ConvertStats, HealthResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("geometry")

HTTP_TIMEOUT_S = 120.0

_conversion_slots = threading.BoundedSemaphore(config.max_concurrency())

app = FastAPI(title="carbon-geometry", version=__version__)


@app.exception_handler(ConvertError)
async def convert_error_handler(_: Request, exc: ConvertError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"ok": False, "error": exc.message, "code": exc.code},
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(
    _: Request, exc: RequestValidationError
) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={"ok": False, "error": str(exc.errors()), "code": "INVALID_INPUT"},
    )


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(version=__version__)


@app.post("/convert", response_model=ConvertResponse, dependencies=[Depends(require_auth)])
def convert(request: ConvertRequest) -> ConvertResponse:
    # OCP import is deferred so the API (auth, validation, /health) works in
    # environments without the OCCT wheel (and fails with a clear error here).
    try:
        from app.convert import convert_step
    except ImportError as exc:
        raise ConvertError(
            "TESSELLATION_FAILED", f"OCCT bindings unavailable: {exc}"
        ) from exc
    from app.optimize import compress_glb

    for url in (
        request.source.url,
        request.outputs.glb.url,
        request.outputs.graph.url,
    ):
        _validate_url(url)

    if not _conversion_slots.acquire(blocking=False):
        raise ConvertError("BUSY", "all conversion slots are in use; retry later", 429)

    started = time.monotonic()
    logger.info("[%s] convert start: %s", request.jobId, request.source.format)

    try:
        with tempfile.TemporaryDirectory(prefix="geometry-") as tmp:
            tmp_dir = Path(tmp)
            step_path = tmp_dir / "source.step"
            glb_path = tmp_dir / "model.glb"
            _download(request.source.url, step_path)

            result = convert_step(
                step_path,
                glb_path,
                linear_deflection=request.options.linearDeflection,
                angular_deflection=request.options.angularDeflection,
                max_parts=config.max_parts(),
            )

            if request.options.compress:
                compressed_path = tmp_dir / "model.meshopt.glb"
                if compress_glb(glb_path, compressed_path):
                    glb_path = compressed_path
                else:
                    result.warnings.append(
                        "meshopt compression unavailable; GLB is uncompressed"
                    )

            _upload(
                request.outputs.glb.url, glb_path.read_bytes(), "model/gltf-binary"
            )
            _upload(
                request.outputs.graph.url,
                json.dumps(result.graph).encode("utf-8"),
                "application/json",
            )
    finally:
        _conversion_slots.release()

    convert_ms = int((time.monotonic() - started) * 1000)
    logger.info(
        "[%s] convert done: %d parts, %d triangles, %dms",
        request.jobId,
        result.part_count,
        result.triangles,
        convert_ms,
    )
    return ConvertResponse(
        partCount=result.part_count,
        unit=result.graph["unit"],
        stats=ConvertStats(
            convertMs=convert_ms,
            meshTriangles=result.triangles,
            warnings=result.warnings,
        ),
    )


def _validate_url(url: str) -> None:
    parsed = urlparse(url)
    if config.require_https() and parsed.scheme != "https":
        raise ConvertError("INVALID_INPUT", "URLs must use https", 400)
    if parsed.scheme not in ("http", "https"):
        raise ConvertError("INVALID_INPUT", f"unsupported URL scheme: {parsed.scheme}", 400)
    allowed = config.allowed_url_hosts()
    if allowed and (parsed.hostname or "").lower() not in allowed:
        raise ConvertError("INVALID_INPUT", "URL host is not allowed", 400)


def _download(url: str, destination: Path) -> None:
    limit = config.max_source_bytes()
    try:
        with httpx.Client(timeout=HTTP_TIMEOUT_S, follow_redirects=True) as client:
            with client.stream("GET", url) as response:
                response.raise_for_status()
                declared = response.headers.get("Content-Length")
                if declared and int(declared) > limit:
                    raise ConvertError(
                        "LIMIT_EXCEEDED", "source file exceeds the size limit", 413
                    )
                received = 0
                with destination.open("wb") as out:
                    for chunk in response.iter_bytes():
                        received += len(chunk)
                        if received > limit:
                            raise ConvertError(
                                "LIMIT_EXCEEDED",
                                "source file exceeds the size limit",
                                413,
                            )
                        out.write(chunk)
    except httpx.HTTPError as exc:
        raise ConvertError("READ_FAILED", f"could not download source: {exc}", 422) from exc


def _upload(url: str, body: bytes, content_type: str) -> None:
    try:
        with httpx.Client(timeout=HTTP_TIMEOUT_S) as client:
            response = client.put(url, content=body, headers={"Content-Type": content_type})
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise ConvertError("UPLOAD_FAILED", f"could not upload artifact: {exc}", 502) from exc
