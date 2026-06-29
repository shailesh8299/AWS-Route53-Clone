import ipaddress
import json
import re
from math import ceil
from typing import Any

from fastapi import HTTPException, status

from .database import new_caller_reference, new_id, utc_now
from .schemas import DNSRecordCreate, DNSRecordOut, DNSRecordUpdate, HostedZoneCreate, HostedZoneOut, HostedZoneUpdate

# ── Validation ────────────────────────────────────────────────────────────────

_HOSTNAME_RE = re.compile(r"^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+$")


def _validate_ipv4(value: str) -> None:
    try:
        ipaddress.IPv4Address(value)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Invalid IPv4 address: {value!r}")


def _validate_ipv6(value: str) -> None:
    try:
        ipaddress.IPv6Address(value)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Invalid IPv6 address: {value!r}")


def validate_record_values(record_type: str, values: list[str], zone_name: str) -> None:
    """Per-type validation of DNS record values."""
    for v in values:
        if record_type == "A":
            _validate_ipv4(v)

        elif record_type == "AAAA":
            _validate_ipv6(v)

        elif record_type == "CNAME":
            # CNAME must not target the zone apex
            fqdn = v if v.endswith(".") else f"{v}."
            if fqdn == zone_name:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="CNAME cannot be the zone apex")
            # Must be a valid hostname
            if not _HOSTNAME_RE.match(fqdn):
                raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Invalid CNAME hostname: {v!r}")

        elif record_type == "MX":
            # Format: "priority hostname"
            parts = v.split(None, 1)
            if len(parts) != 2 or not parts[0].isdigit():
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    detail=f"MX record must be 'priority hostname' (e.g. '10 mail.example.com.'): {v!r}",
                )

        elif record_type == "SRV":
            # Format: "priority weight port target"
            parts = v.split(None, 3)
            if len(parts) != 4 or not all(p.isdigit() for p in parts[:3]):
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    detail=f"SRV record must be 'priority weight port target' (e.g. '10 20 5060 sip.example.com.'): {v!r}",
                )

        elif record_type == "CAA":
            # Format: "flag tag value"
            parts = v.split(None, 2)
            if len(parts) != 3 or not parts[0].isdigit():
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    detail=f"CAA record must be 'flag tag value' (e.g. '0 issue \"letsencrypt.org\"'): {v!r}",
                )


# ── Pagination ────────────────────────────────────────────────────────────────


def paginate(items: list[dict[str, Any]], page: int, page_size: int) -> tuple[list[dict[str, Any]], dict[str, int]]:
    total = len(items)
    total_pages = max(1, ceil(total / page_size)) if total else 0
    page = max(1, page)
    start = (page - 1) * page_size
    end = start + page_size
    return items[start:end], {"page": page, "page_size": page_size, "total": total, "total_pages": total_pages}


# ── Row → Schema converters ───────────────────────────────────────────────────


def row_to_zone(row: Any, record_count: int = 0) -> HostedZoneOut:
    caller_ref = row["caller_reference"]
    return HostedZoneOut(
        id=row["id"],
        name=row["name"],
        comment=row["comment"],
        zone_type=row["zone_type"],
        caller_reference=caller_ref,
        hosted_zone_id=f"/hostedzone/{caller_ref}",
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        record_count=record_count,
    )


def row_to_record(row: Any) -> DNSRecordOut:
    return DNSRecordOut(
        id=row["id"],
        zone_id=row["zone_id"],
        name=row["name"],
        record_type=row["record_type"],
        ttl=row["ttl"],
        values=json.loads(row["values_json"]),
        routing_policy=row["routing_policy"],
        weight=row["weight"],
        priority=row["priority"],
        comment=row["comment"],
        alias_target=row["alias_target"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


# ── Zone lookups ──────────────────────────────────────────────────────────────


def get_zone_or_404(db: Any, zone_id: str) -> Any:
    row = db.execute("SELECT * FROM hosted_zones WHERE id = ?", (zone_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Hosted zone not found")
    return row


def get_record_or_404(db: Any, zone_id: str, record_id: str) -> Any:
    row = db.execute("SELECT * FROM dns_records WHERE id = ? AND zone_id = ?", (record_id, zone_id)).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found")
    return row


# ── Zone CRUD ─────────────────────────────────────────────────────────────────


def create_hosted_zone(db: Any, payload: HostedZoneCreate, user_id: str | None = None) -> HostedZoneOut:
    zone_id = new_id()
    caller_ref = new_caller_reference()
    now = utc_now()
    try:
        db.execute(
            "INSERT INTO hosted_zones (id,name,comment,zone_type,caller_reference,user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (zone_id, payload.name, payload.comment, payload.zone_type, caller_ref, user_id, now, now),
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Hosted zone name must be unique") from exc

    # Auto-create default NS and SOA records (mimics real Route53 behavior)
    ns_values = ["ns-1.awsdns-01.com.", "ns-2.awsdns-02.net.", "ns-3.awsdns-03.org.", "ns-4.awsdns-04.co.uk."]
    soa_value = f"ns-1.awsdns-01.com. hostmaster.{payload.name} 1 7200 900 1209600 86400"
    for rtype, ttl, vals, comment in [
        ("NS",  172800, ns_values, "Default nameservers"),
        ("SOA", 900,    [soa_value], "Start of authority"),
    ]:
        db.execute(
            """INSERT INTO dns_records (id,zone_id,name,record_type,ttl,values_json,
               routing_policy,weight,priority,comment,alias_target,created_at,updated_at)
               VALUES (?,?,?,?,?,?,'Simple',NULL,NULL,?,?,?,?)""",
            (new_id(), zone_id, payload.name, rtype, ttl, json.dumps(vals), comment, "", now, now),
        )

    zone_row = db.execute("SELECT * FROM hosted_zones WHERE id = ?", (zone_id,)).fetchone()
    return row_to_zone(zone_row, record_count=2)


def update_hosted_zone(db: Any, zone_id: str, payload: HostedZoneUpdate) -> HostedZoneOut:
    zone = get_zone_or_404(db, zone_id)
    # name is intentionally excluded from update (immutable after creation)
    updated = {
        "comment":      payload.comment   if payload.comment   is not None else zone["comment"],
        "zone_type":    payload.zone_type if payload.zone_type is not None else zone["zone_type"],
        "updated_at":   utc_now(),
    }
    db.execute(
        "UPDATE hosted_zones SET comment = ?, zone_type = ?, updated_at = ? WHERE id = ?",
        (updated["comment"], updated["zone_type"], updated["updated_at"], zone_id),
    )
    refreshed = get_zone_or_404(db, zone_id)
    count = db.execute("SELECT COUNT(*) AS n FROM dns_records WHERE zone_id = ?", (zone_id,)).fetchone()["n"]
    return row_to_zone(refreshed, count)


def delete_hosted_zone(db: Any, zone_id: str) -> None:
    get_zone_or_404(db, zone_id)
    db.execute("DELETE FROM hosted_zones WHERE id = ?", (zone_id,))


# ── Record CRUD ───────────────────────────────────────────────────────────────


def normalize_list(values: list[str] | None) -> list[str]:
    cleaned = [v.strip() for v in (values or []) if v and v.strip()]
    if not cleaned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one record value is required")
    return cleaned


def create_record(db: Any, zone_id: str, payload: DNSRecordCreate) -> DNSRecordOut:
    zone = get_zone_or_404(db, zone_id)
    values = normalize_list(payload.values)
    validate_record_values(payload.record_type, values, zone["name"])
    if payload.record_type == "SOA" and len(values) != 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="SOA records must have exactly one value")
    now = utc_now()
    record_id = new_id()
    db.execute(
        """INSERT INTO dns_records (id,zone_id,name,record_type,ttl,values_json,
           routing_policy,weight,priority,comment,alias_target,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (record_id, zone_id, payload.name, payload.record_type, payload.ttl,
         json.dumps(values), payload.routing_policy, payload.weight, payload.priority,
         payload.comment, payload.alias_target, now, now),
    )
    return row_to_record(db.execute("SELECT * FROM dns_records WHERE id = ?", (record_id,)).fetchone())


def update_record(db: Any, zone_id: str, record_id: str, payload: DNSRecordUpdate) -> DNSRecordOut:
    zone = get_zone_or_404(db, zone_id)
    existing = get_record_or_404(db, zone_id, record_id)
    values = json.loads(existing["values_json"])
    if payload.values is not None:
        values = normalize_list(payload.values)
    record_type = payload.record_type if payload.record_type is not None else existing["record_type"]
    validate_record_values(record_type, values, zone["name"])
    if record_type == "SOA" and len(values) != 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="SOA records must have exactly one value")
    now = utc_now()
    db.execute(
        """UPDATE dns_records SET name=?,record_type=?,ttl=?,values_json=?,routing_policy=?,
           weight=?,priority=?,comment=?,alias_target=?,updated_at=? WHERE id=? AND zone_id=?""",
        (
            payload.name           if payload.name           is not None else existing["name"],
            record_type,
            payload.ttl            if payload.ttl            is not None else existing["ttl"],
            json.dumps(values),
            payload.routing_policy if payload.routing_policy is not None else existing["routing_policy"],
            payload.weight         if payload.weight         is not None else existing["weight"],
            payload.priority       if payload.priority       is not None else existing["priority"],
            payload.comment        if payload.comment        is not None else existing["comment"],
            payload.alias_target   if payload.alias_target   is not None else existing["alias_target"],
            now, record_id, zone_id,
        ),
    )
    return row_to_record(db.execute("SELECT * FROM dns_records WHERE id = ?", (record_id,)).fetchone())


def delete_record(db: Any, zone_id: str, record_id: str) -> None:
    zone = get_zone_or_404(db, zone_id)
    record = get_record_or_404(db, zone_id, record_id)
    # Block deletion of apex NS and SOA records (mimics Route53 restriction)
    if record["record_type"] in ("NS", "SOA") and record["name"] == zone["name"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete the apex {record['record_type']} record — it is required for zone operation",
        )
    db.execute("DELETE FROM dns_records WHERE id = ? AND zone_id = ?", (record_id, zone_id))


# ── BIND zone file export ─────────────────────────────────────────────────────


def generate_bind_zone(zone: Any, records: list[Any]) -> str:
    """Generate a BIND-format zone file string."""
    zone_name = zone["name"]
    lines: list[str] = [
        f"; Zone file for {zone_name}",
        f"; Generated by Route53 Clone",
        f"",
        f"$ORIGIN {zone_name}",
        f"$TTL 3600",
        f"",
    ]
    for row in records:
        rtype = row["record_type"]
        ttl = row["ttl"]
        name = row["name"]
        values = json.loads(row["values_json"])
        for v in values:
            lines.append(f"{name:<40} {ttl:<8} IN  {rtype:<8} {v}")
    return "\n".join(lines) + "\n"
