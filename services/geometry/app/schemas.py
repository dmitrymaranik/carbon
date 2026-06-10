"""Pydantic models for the /convert contract.

Field names are camelCase on purpose: they must match the wire format in
docs/specs/animated-work-instructions-contracts.md exactly.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict


class SourceSpec(BaseModel):
    url: str
    format: Literal["step"] = "step"


class OutputTarget(BaseModel):
    url: str


class OutputSpec(BaseModel):
    glb: OutputTarget
    graph: OutputTarget


class ConvertOptions(BaseModel):
    model_config = ConfigDict(extra="ignore")

    linearDeflection: float = 0.1
    angularDeflection: float = 0.5
    compress: bool = True


class ConvertRequest(BaseModel):
    jobId: str
    source: SourceSpec
    outputs: OutputSpec
    options: ConvertOptions = ConvertOptions()


class ConvertStats(BaseModel):
    convertMs: int
    meshTriangles: int
    warnings: list[str] = []


class ConvertResponse(BaseModel):
    ok: Literal[True] = True
    partCount: int
    unit: str
    stats: ConvertStats


class HealthResponse(BaseModel):
    ok: Literal[True] = True
    version: str
