from __future__ import annotations

from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel


class TagBase(BaseModel):
    name: str
    color: str = "#3B82F6"


class FileBase(BaseModel):
    name: str


class FileCreate(FileBase):
    category_id: Optional[int] = None


class FileUpdate(BaseModel):
    name: Optional[str] = None
    category_id: Optional[int] = None
    is_favorite: Optional[bool] = None
    note: Optional[str] = None


class TagInFile(TagBase):
    id: int

    class Config:
        from_attributes = True


class CategoryInFile(BaseModel):
    id: int
    name: str

    class Config:
        from_attributes = True


class FileResponse(BaseModel):
    id: int
    uuid: str
    name: str
    size: int
    category_id: Optional[int] = None
    category: Optional[CategoryInFile] = None
    upload_time: datetime
    protocol_summary: str
    file_path: str
    is_favorite: bool
    note: str = ""
    tags: List[TagInFile] = []

    class Config:
        from_attributes = True


class FileListResponse(BaseModel):
    files: List[FileResponse]
    total: int
    page: int
    page_size: int


class ProtocolSummaryPreview(BaseModel):
    """Result of a sharkd protocol detection that hasn't been persisted yet."""
    file: FileResponse
    suggested_summary: str


class ProtocolSummaryUpdate(BaseModel):
    """Body for user-confirmed protocol summary write."""
    summary: str


class UploadResponse(BaseModel):
    """Upload endpoint response: the created file plus the detected-but-not-yet-saved protocol summary."""
    file: FileResponse
    suggested_summary: str
