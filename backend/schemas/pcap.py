from __future__ import annotations

from typing import List
from pydantic import BaseModel


class PcapFrameResponse(BaseModel):
    number: int
    time: str
    source: str
    destination: str
    protocol: str
    length: int
    info: str


class ProtocolNodeResponse(BaseModel):
    label: str
    field: str
    value: str
    children: List[ProtocolNodeResponse] = []


class FrameListResponse(BaseModel):
    frames: List[PcapFrameResponse]
    total: int


class FrameDetailResponse(BaseModel):
    number: int
    protocols: List[ProtocolNodeResponse]


class HexDumpResponse(BaseModel):
    offset: List[str]
    hex: List[str]
    ascii: List[str]
