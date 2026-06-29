from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware
from jose import JWTError, jwt

from . import crud
from .config import ACCESS_TOKEN_EXPIRE_DAYS, ALGORITHM, API_TITLE, API_VERSION, SECRET_KEY
from .database import get_db, init_db, new_id, seed_demo_data, utc_now
from .schemas import (
    AuthSessionResponse,
    AuthUser,
    BulkDeleteRequest,
    DNSRecordCreate,
    DNSRecordOut,
    DNSRecordUpdate,
    HostedZoneCreate,
    HostedZoneOut,
    HostedZoneUpdate,
    LoginRequest,
    MessageResponse,
    PageMeta,
    PageResponse,
    ZoneExport,
)

# ── App setup ─────────────────────────────────────────────────────────────────

app = FastAPI(title=API_TITLE, version=API_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://aws-route53-clone-kappa.vercel.app",
],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

api = APIRouter(prefix="/api")  # All resource endpoints live under /api


# ── JWT helpers ───────────────────────────────────────────────────────────────


def _create_jwt(user_id: str, username: str, display_name: str) -> str:
    expires = datetime.now(timezone.utc) + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    return jwt.encode(
        {"sub": user_id, "username": username, "display_name": display_name, "exp": expires},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


def get_current_user(authorization: Annotated[str | None, Header()] = None) -> AuthUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing authentication token")
    token = authorization.split(" ", 1)[1].strip()
    # 1. Validate JWT signature and expiry
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str | None = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token") from exc
    # 2. Verify session still recorded in DB (supports explicit logout)
    with get_db() as db:
        session = db.execute("SELECT token FROM sessions WHERE token = ?", (token,)).fetchone()
        if session is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session revoked — please log in again")
        user = db.execute("SELECT id, username, email, display_name FROM users WHERE id = ?", (user_id,)).fetchone()
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return AuthUser(id=user["id"], username=user["username"], email=user["email"], display_name=user["display_name"])


# ── Startup ───────────────────────────────────────────────────────────────────


@app.on_event("startup")
def startup() -> None:
    init_db()
    seed_demo_data()


# ── Health (no auth, no /api prefix) ─────────────────────────────────────────


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# ── Auth endpoints ────────────────────────────────────────────────────────────


@api.post("/auth/login", response_model=AuthSessionResponse)
def login(payload: LoginRequest) -> AuthSessionResponse:
    """Accept any email + password (mocked auth). Auto-creates user on first login."""
    email = payload.email.strip().lower()
    local_part = email.split("@")[0] if "@" in email else email
    display_name = local_part.replace(".", " ").replace("_", " ").replace("-", " ").title() or "Route53 User"
    now = utc_now()
    expires_at = (datetime.now(timezone.utc) + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)).isoformat(timespec="seconds")

    with get_db() as db:
        user = db.execute("SELECT * FROM users WHERE username = ?", (email,)).fetchone()
        if user is None:
            user_id = new_id()
            db.execute(
                "INSERT INTO users (id, username, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?,?)",
                (user_id, email, email, display_name, "mocked", now),
            )
            user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        else:
            user_id = user["id"]
            db.execute("UPDATE users SET display_name=?, email=? WHERE id=?", (display_name, email, user_id))

        token = _create_jwt(user_id=user_id, username=email, display_name=display_name)
        # One session per user — revoke old sessions on new login
        db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        db.execute(
            "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)",
            (token, user_id, now, expires_at),
        )

    return AuthSessionResponse(
        token=token,
        user=AuthUser(id=user_id, username=email, email=email, display_name=display_name),
    )


@api.post("/auth/logout", response_model=MessageResponse)
def logout(authorization: Annotated[str | None, Header()] = None) -> MessageResponse:
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        with get_db() as db:
            db.execute("DELETE FROM sessions WHERE token = ?", (token,))
    return MessageResponse(message="Logged out successfully")


@api.get("/auth/me", response_model=AuthUser)
def me(current_user: AuthUser = Depends(get_current_user)) -> AuthUser:
    return current_user


# ── Hosted Zones ──────────────────────────────────────────────────────────────

_ZONE_SORT_COLS = {"name", "zone_type", "updated_at", "created_at", "record_count"}


@api.get("/hosted-zones", response_model=PageResponse)
def list_hosted_zones(
    search:    str = Query(default=""),
    page:      int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    sort_by:   str = Query(default="updated_at"),
    order:     str = Query(default="desc"),
    current_user: AuthUser = Depends(get_current_user),
) -> PageResponse:
    if sort_by not in _ZONE_SORT_COLS:
        sort_by = "updated_at"
    sql_order = "ASC" if order.lower() == "asc" else "DESC"
    with get_db() as db:
        zones = db.execute(f"SELECT * FROM hosted_zones ORDER BY {sort_by} {sql_order}").fetchall()
        items = []
        for zone in zones:
            if search:
                term = search.lower()
                if term not in zone["name"].lower() and term not in zone["comment"].lower():
                    continue
            count = db.execute("SELECT COUNT(*) AS n FROM dns_records WHERE zone_id = ?", (zone["id"],)).fetchone()["n"]
            items.append(crud.row_to_zone(zone, count).model_dump())
    paged, meta = crud.paginate(items, page, page_size)
    return PageResponse(items=paged, meta=PageMeta(**meta))


@api.post("/hosted-zones", response_model=HostedZoneOut, status_code=status.HTTP_201_CREATED)
def create_hosted_zone(
    payload: HostedZoneCreate,
    current_user: AuthUser = Depends(get_current_user),
) -> HostedZoneOut:
    with get_db() as db:
        return crud.create_hosted_zone(db, payload, user_id=current_user.id)


@api.get("/hosted-zones/{zone_id}", response_model=HostedZoneOut)
def get_hosted_zone(zone_id: str, current_user: AuthUser = Depends(get_current_user)) -> HostedZoneOut:
    with get_db() as db:
        zone = crud.get_zone_or_404(db, zone_id)
        count = db.execute("SELECT COUNT(*) AS n FROM dns_records WHERE zone_id = ?", (zone_id,)).fetchone()["n"]
        return crud.row_to_zone(zone, count)


@api.put("/hosted-zones/{zone_id}", response_model=HostedZoneOut)
def update_hosted_zone(
    zone_id: str,
    payload: HostedZoneUpdate,
    current_user: AuthUser = Depends(get_current_user),
) -> HostedZoneOut:
    with get_db() as db:
        return crud.update_hosted_zone(db, zone_id, payload)


@api.delete("/hosted-zones/{zone_id}", response_model=MessageResponse)
def delete_hosted_zone(zone_id: str, current_user: AuthUser = Depends(get_current_user)) -> MessageResponse:
    with get_db() as db:
        crud.delete_hosted_zone(db, zone_id)
    return MessageResponse(message="Hosted zone deleted")


# ── DNS Records ───────────────────────────────────────────────────────────────

_RECORD_SORT_COLS = {"name", "record_type", "ttl", "routing_policy", "updated_at"}


@api.get("/hosted-zones/{zone_id}/records", response_model=PageResponse)
def list_records(
    zone_id:     str,
    search:      str = Query(default=""),
    record_type: str = Query(default=""),
    page:        int = Query(default=1, ge=1),
    page_size:   int = Query(default=10, ge=1, le=100),
    sort_by:     str = Query(default="updated_at"),
    order:       str = Query(default="desc"),
    current_user: AuthUser = Depends(get_current_user),
) -> PageResponse:
    if sort_by not in _RECORD_SORT_COLS:
        sort_by = "updated_at"
    sql_order = "ASC" if order.lower() == "asc" else "DESC"
    with get_db() as db:
        crud.get_zone_or_404(db, zone_id)
        rows = db.execute(
            f"SELECT * FROM dns_records WHERE zone_id = ? ORDER BY {sort_by} {sql_order}",
            (zone_id,),
        ).fetchall()
        items = []
        for row in rows:
            if search:
                term = search.lower()
                import json as _json
                vals_str = " ".join(_json.loads(row["values_json"]))
                if term not in row["name"].lower() and term not in row["record_type"].lower() and term not in vals_str.lower():
                    continue
            if record_type and row["record_type"] != record_type:
                continue
            items.append(crud.row_to_record(row).model_dump())
    paged, meta = crud.paginate(items, page, page_size)
    return PageResponse(items=paged, meta=PageMeta(**meta))


@api.post("/hosted-zones/{zone_id}/records", response_model=DNSRecordOut, status_code=status.HTTP_201_CREATED)
def create_record(
    zone_id: str,
    payload: DNSRecordCreate,
    current_user: AuthUser = Depends(get_current_user),
) -> DNSRecordOut:
    with get_db() as db:
        return crud.create_record(db, zone_id, payload)


@api.put("/hosted-zones/{zone_id}/records/{record_id}", response_model=DNSRecordOut)
def update_record(
    zone_id:   str,
    record_id: str,
    payload:   DNSRecordUpdate,
    current_user: AuthUser = Depends(get_current_user),
) -> DNSRecordOut:
    with get_db() as db:
        return crud.update_record(db, zone_id, record_id, payload)


@api.delete("/hosted-zones/{zone_id}/records/{record_id}", response_model=MessageResponse)
def delete_record(
    zone_id:   str,
    record_id: str,
    current_user: AuthUser = Depends(get_current_user),
) -> MessageResponse:
    with get_db() as db:
        crud.delete_record(db, zone_id, record_id)
    return MessageResponse(message="Record deleted")


@api.delete("/hosted-zones/{zone_id}/records", response_model=MessageResponse)
def bulk_delete_records(
    zone_id:  str,
    payload:  BulkDeleteRequest,
    current_user: AuthUser = Depends(get_current_user),
) -> MessageResponse:
    """Bulk delete DNS records by ID list. Protected apex NS/SOA records are skipped."""
    deleted = 0
    skipped = 0
    with get_db() as db:
        crud.get_zone_or_404(db, zone_id)
        for record_id in payload.ids:
            try:
                crud.delete_record(db, zone_id, record_id)
                deleted += 1
            except HTTPException:
                skipped += 1
    msg = f"{deleted} record(s) deleted"
    if skipped:
        msg += f", {skipped} skipped (apex NS/SOA are protected)"
    return MessageResponse(message=msg)


# ── Export ────────────────────────────────────────────────────────────────────


@api.get("/hosted-zones/{zone_id}/export", response_model=ZoneExport)
def export_zone_json(zone_id: str, current_user: AuthUser = Depends(get_current_user)) -> ZoneExport:
    with get_db() as db:
        zone = crud.get_zone_or_404(db, zone_id)
        rows = db.execute("SELECT * FROM dns_records WHERE zone_id = ? ORDER BY id ASC", (zone_id,)).fetchall()
        count = len(rows)
        return ZoneExport(zone=crud.row_to_zone(zone, count), records=[crud.row_to_record(r) for r in rows])


@api.get("/hosted-zones/{zone_id}/export/bind")
def export_zone_bind(zone_id: str, current_user: AuthUser = Depends(get_current_user)) -> Response:
    """Export zone as a BIND-format zone file (plain text)."""
    with get_db() as db:
        zone = crud.get_zone_or_404(db, zone_id)
        rows = db.execute("SELECT * FROM dns_records WHERE zone_id = ? ORDER BY record_type, name", (zone_id,)).fetchall()
        content = crud.generate_bind_zone(zone, rows)
    filename = zone["name"].rstrip(".") + ".zone"
    return Response(
        content=content,
        media_type="text/plain",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Stats ─────────────────────────────────────────────────────────────────────


@api.get("/stats")
def stats(current_user: AuthUser = Depends(get_current_user)) -> dict:
    with get_db() as db:
        return {
            "hosted_zones":  db.execute("SELECT COUNT(*) AS n FROM hosted_zones").fetchone()["n"],
            "dns_records":   db.execute("SELECT COUNT(*) AS n FROM dns_records").fetchone()["n"],
            "public_zones":  db.execute("SELECT COUNT(*) AS n FROM hosted_zones WHERE zone_type='Public Hosted Zone'").fetchone()["n"],
            "private_zones": db.execute("SELECT COUNT(*) AS n FROM hosted_zones WHERE zone_type='Private Hosted Zone'").fetchone()["n"],
        }


# ── Mount router ──────────────────────────────────────────────────────────────

app.include_router(api)
