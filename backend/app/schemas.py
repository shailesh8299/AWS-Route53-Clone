from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

# ── Enum literals ─────────────────────────────────────────────────────────────

RecordType = Literal["A", "AAAA", "CNAME", "TXT", "MX", "NS", "PTR", "SRV", "CAA", "SOA"]
ZoneType = Literal["Public Hosted Zone", "Private Hosted Zone"]
RoutingPolicy = Literal["Simple", "Weighted", "Latency", "Failover", "Geolocation", "Multivalue"]

# ── Auth ─────────────────────────────────────────────────────────────────────


class LoginRequest(BaseModel):
    email: str = Field(min_length=1, max_length=200, description="Email or username")
    password: str = Field(min_length=1, max_length=200)


class AuthUser(BaseModel):
    id: str
    username: str
    email: str | None = None
    display_name: str


class AuthSessionResponse(BaseModel):
    token: str
    token_type: str = "bearer"
    user: AuthUser


# ── Hosted Zones ──────────────────────────────────────────────────────────────


class HostedZoneBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    comment: str = Field(default="", max_length=500)
    zone_type: ZoneType = "Public Hosted Zone"

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Hosted zone name is required")
        return cleaned if cleaned.endswith(".") else f"{cleaned}."


class HostedZoneCreate(HostedZoneBase):
    pass


class HostedZoneUpdate(BaseModel):
    comment: str | None = Field(default=None, max_length=500)
    zone_type: ZoneType | None = None
    # NOTE: name is intentionally excluded — zone names are immutable after creation


class HostedZoneOut(BaseModel):
    id: str
    name: str
    comment: str
    zone_type: ZoneType
    caller_reference: str
    hosted_zone_id: str  # /hostedzone/ZXXXXXXXXXXXXXXX  (AWS-style display ID)
    created_at: str
    updated_at: str
    record_count: int = 0


# ── DNS Records ───────────────────────────────────────────────────────────────


class DNSRecordBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    record_type: RecordType
    ttl: int = Field(default=300, ge=0, le=2147483647)
    values: list[str] = Field(default_factory=list)
    routing_policy: RoutingPolicy = "Simple"
    weight: int | None = Field(default=None, ge=0, le=1000)
    priority: int | None = Field(default=None, ge=0, le=65535)
    comment: str = Field(default="", max_length=500)
    alias_target: str = Field(default="", max_length=500)

    @field_validator("name")
    @classmethod
    def normalize_record_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Record name is required")
        return cleaned if cleaned.endswith(".") else f"{cleaned}."


class DNSRecordCreate(DNSRecordBase):
    pass


class DNSRecordUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    record_type: RecordType | None = None
    ttl: int | None = Field(default=None, ge=0, le=2147483647)
    values: list[str] | None = None
    routing_policy: RoutingPolicy | None = None
    weight: int | None = Field(default=None, ge=0, le=1000)
    priority: int | None = Field(default=None, ge=0, le=65535)
    comment: str | None = Field(default=None, max_length=500)
    alias_target: str | None = Field(default=None, max_length=500)

    @field_validator("name")
    @classmethod
    def normalize_record_name(cls, value: str | None) -> str | None:
        if value is None:
            return value
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Record name cannot be blank")
        return cleaned if cleaned.endswith(".") else f"{cleaned}."


class DNSRecordOut(BaseModel):
    id: str
    zone_id: str
    name: str
    record_type: RecordType
    ttl: int
    values: list[str]
    routing_policy: RoutingPolicy
    weight: int | None
    priority: int | None
    comment: str
    alias_target: str
    created_at: str
    updated_at: str


# ── Pagination ────────────────────────────────────────────────────────────────


class PageMeta(BaseModel):
    page: int
    page_size: int
    total: int
    total_pages: int


class PageResponse(BaseModel):
    items: list[Any]
    meta: PageMeta


# ── Misc ──────────────────────────────────────────────────────────────────────


class MessageResponse(BaseModel):
    message: str


class ZoneExport(BaseModel):
    zone: HostedZoneOut
    records: list[DNSRecordOut]


class BulkDeleteRequest(BaseModel):
    ids: list[str] = Field(min_length=1)
