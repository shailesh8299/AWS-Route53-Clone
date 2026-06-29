import json
import random
import sqlite3
import string
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator

from .config import DATA_DIR, DB_PATH


# ── Utilities ────────────────────────────────────────────────────────────────


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id() -> str:
    """Generate a UUID4 string primary key."""
    return str(uuid.uuid4())


def new_caller_reference() -> str:
    """Generate an AWS-style zone ID: Z + 14 uppercase alphanumeric chars."""
    chars = string.ascii_uppercase + string.digits
    return "Z" + "".join(random.choices(chars, k=14))


def ensure_database_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


# ── Connection ───────────────────────────────────────────────────────────────


def connect() -> sqlite3.Connection:
    ensure_database_dir()
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


@contextmanager
def get_db() -> Iterator[sqlite3.Connection]:
    connection = connect()
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


# ── Schema ───────────────────────────────────────────────────────────────────


def init_db() -> None:
    with get_db() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id            TEXT PRIMARY KEY,
                username      TEXT NOT NULL UNIQUE,
                email         TEXT UNIQUE,
                display_name  TEXT NOT NULL,
                password_hash TEXT NOT NULL DEFAULT 'mocked',
                created_at    TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token      TEXT PRIMARY KEY,
                user_id    TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS hosted_zones (
                id               TEXT PRIMARY KEY,
                name             TEXT NOT NULL UNIQUE,
                comment          TEXT NOT NULL DEFAULT '',
                zone_type        TEXT NOT NULL DEFAULT 'Public Hosted Zone'
                                 CHECK(zone_type IN ('Public Hosted Zone','Private Hosted Zone')),
                caller_reference TEXT NOT NULL UNIQUE,
                user_id          TEXT,
                created_at       TEXT NOT NULL,
                updated_at       TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS dns_records (
                id             TEXT PRIMARY KEY,
                zone_id        TEXT NOT NULL,
                name           TEXT NOT NULL,
                record_type    TEXT NOT NULL
                               CHECK(record_type IN ('A','AAAA','CNAME','TXT','MX','NS','PTR','SRV','CAA','SOA')),
                ttl            INTEGER NOT NULL,
                values_json    TEXT NOT NULL,
                routing_policy TEXT NOT NULL DEFAULT 'Simple'
                               CHECK(routing_policy IN ('Simple','Weighted','Latency','Failover','Geolocation','Multivalue')),
                weight         INTEGER,
                priority       INTEGER,
                comment        TEXT NOT NULL DEFAULT '',
                alias_target   TEXT NOT NULL DEFAULT '',
                created_at     TEXT NOT NULL,
                updated_at     TEXT NOT NULL,
                FOREIGN KEY(zone_id) REFERENCES hosted_zones(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_hosted_zones_name         ON hosted_zones(name);
            CREATE INDEX IF NOT EXISTS idx_dns_records_zone_name     ON dns_records(zone_id, name);
            CREATE INDEX IF NOT EXISTS idx_dns_records_zone_type     ON dns_records(zone_id, record_type);
            CREATE INDEX IF NOT EXISTS idx_sessions_user             ON sessions(user_id);
            """
        )


# ── Seed data ─────────────────────────────────────────────────────────────────


def seed_demo_data() -> None:
    with get_db() as db:
        if db.execute("SELECT COUNT(*) AS n FROM hosted_zones").fetchone()["n"]:
            return  # already seeded

        now = utc_now()
        user_id = new_id()
        db.execute(
            "INSERT INTO users (id, username, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, "demo@example.com", "demo@example.com", "Demo User",
             "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj2NjzpZmU6",  # bcrypt of "demo123"
             now),
        )

        z1_id = new_id()
        z2_id = new_id()
        z1_ref = "Z1DEMO1EXAMPLE1"
        z2_ref = "Z2DEMOINTERIOR2"

        zones = [
            (z1_id, "example.com.",          "Primary public zone",          "Public Hosted Zone",  z1_ref, user_id, now, now),
            (z2_id, "internal.example.com.", "Private internal records",     "Private Hosted Zone", z2_ref, user_id, now, now),
        ]
        db.executemany(
            "INSERT INTO hosted_zones (id,name,comment,zone_type,caller_reference,user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
            zones,
        )

        def rec(zone_id, name, rtype, ttl, values, comment=""):
            return (new_id(), zone_id, name, rtype, ttl, json.dumps(values), "Simple", None, None, comment, "", now, now)

        records = [
            rec(z1_id, "example.com.", "NS",   172800, ["ns-1.awsdns-01.com.", "ns-2.awsdns-02.net.", "ns-3.awsdns-03.org.", "ns-4.awsdns-04.co.uk."], "Delegation nameservers"),
            rec(z1_id, "example.com.", "SOA",  900,    ["ns-1.awsdns-01.com. hostmaster.example.com. 1 7200 900 1209600 86400"], "Start of authority"),
            rec(z1_id, "www.example.com.",     "A",    300,    ["203.0.113.10"], "Primary web server"),
            rec(z1_id, "api.example.com.",     "CNAME",300,    ["www.example.com."], "API alias"),
            rec(z1_id, "_dmarc.example.com.",  "TXT",  3600,   ["v=DMARC1; p=none; rua=mailto:dmarc@example.com"], "DMARC policy"),
            rec(z1_id, "mail.example.com.",    "MX",   300,    ["10 mail.example.com.", "20 mail2.example.com."], "Mail routing"),
            rec(z2_id, "internal.example.com.","NS",   172800, ["ns-1.awsdns-01.com.", "ns-2.awsdns-02.net."], "Delegation nameservers"),
            rec(z2_id, "internal.example.com.","SOA",  900,    ["ns-1.awsdns-01.com. hostmaster.internal.example.com. 1 7200 900 1209600 86400"], "Start of authority"),
            rec(z2_id, "app.internal.example.com.", "A", 60,   ["10.0.1.10"], "Internal app server"),
        ]
        db.executemany(
            "INSERT INTO dns_records (id,zone_id,name,record_type,ttl,values_json,routing_policy,weight,priority,comment,alias_target,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            records,
        )
