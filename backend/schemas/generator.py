import ipaddress
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field, field_validator


class GenerateRequest(BaseModel):
    """Payload sent by the frontend to kick off a pcap generation job."""

    protocol: str = Field(default="http", description="Protocol handler to use")
    raw_request: str = Field(default="", description="Raw protocol request text")
    raw_response: str = Field(default="", description="Raw protocol response text")
    # NOTE: src_ip / dst_ip are forwarded into external tools (tcprewrite)
    # and ultimately end up in argv. We validate them as strict IP literals
    # so that neither shell metacharacters nor CIDR/host syntax can ever
    # reach the subprocess layer.
    src_ip: str = Field(default="10.99.1.1", description="Desired source IP in final pcap")
    dst_ip: str = Field(default="10.99.1.2", description="Desired destination IP in final pcap")

    @field_validator("src_ip", "dst_ip")
    @classmethod
    def _validate_ip(cls, v: str) -> str:
        # ``ip_address`` rejects anything that isn't a bare IPv4/IPv6
        # literal (no CIDR, no whitespace, no shell metacharacters).
        try:
            ipaddress.ip_address(v)
        except ValueError as exc:
            raise ValueError(f"invalid IP address: {v!r}") from exc
        return v
    port: int = Field(default=80, ge=1, le=65535, description="Port number (server / dst port)")
    # Optional explicit source port. Omit / None means "AUTO" — let the OS
    # pick an ephemeral port (traditional client behaviour).
    src_port: Optional[int] = Field(
        default=None, ge=1, le=65535,
        description="Desired source (client) port. None = auto-assign ephemeral port."
    )
    # Optional explicit destination port. Defaults to ``port`` when omitted.
    dst_port: Optional[int] = Field(
        default=None, ge=1, le=65535,
        description="Desired destination (server) port. None = use `port`."
    )
    filename: Optional[str] = Field(default=None, description="Custom output filename")
    category_id: Optional[int] = Field(default=None, description="Category to file under")
    tag_ids: Optional[List[int]] = Field(default=None, description="Tag IDs to attach")


class GenerateTaskResponse(BaseModel):
    """Single task status returned to the frontend."""

    id: int
    uuid: str
    protocol: str
    status: str
    src_ip: str
    dst_ip: str
    port: int
    src_port: Optional[int] = None
    dst_port: Optional[int] = None
    filename: Optional[str] = None
    file_id: Optional[int] = None
    error_message: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class SupportedProtocolResponse(BaseModel):
    """Describes a protocol the generator supports."""

    name: str
    label: str
    description: str
    available: bool = True
