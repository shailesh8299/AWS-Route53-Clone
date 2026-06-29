"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "../../../components/app-shell";
import { Breadcrumb, EmptyState, Modal, Pagination, SortTh, TableSkeleton } from "../../../components/ui";
import { apiFetch } from "../../../lib/api";
import { useDNSRecords } from "../../../lib/hooks";
import { DNSRecord, HostedZone, MessageResponse, RoutingPolicy } from "../../../lib/types";
import { useToast } from "../../../components/toast-context";

// ── Constants ─────────────────────────────────────────────────────────────────

const RECORD_TYPES = ["A", "AAAA", "CNAME", "TXT", "MX", "NS", "PTR", "SRV", "CAA", "SOA"] as const;
const ROUTING_POLICIES: RoutingPolicy[] = ["Simple", "Weighted", "Latency", "Failover", "Geolocation", "Multivalue"];

const RECORD_HINTS: Record<string, { placeholder: string; hint: string }> = {
  A:     { placeholder: "203.0.113.10",                       hint: "IPv4 address (one per line)" },
  AAAA:  { placeholder: "2001:db8::1",                        hint: "IPv6 address (one per line)" },
  CNAME: { placeholder: "www.example.com.",                   hint: "Canonical hostname (FQDN with trailing dot)" },
  TXT:   { placeholder: '"v=spf1 include:_spf.example.com ~all"', hint: 'Quoted string(s)' },
  MX:    { placeholder: "10 mail.example.com.",               hint: "Priority then hostname (e.g. 10 mail.example.com.)" },
  NS:    { placeholder: "ns-1.awsdns-01.com.",                hint: "Nameserver hostname (FQDN)" },
  SRV:   { placeholder: "10 20 5060 sip.example.com.",        hint: "Priority Weight Port Target" },
  CAA:   { placeholder: '0 issue "letsencrypt.org"',          hint: "Flag Tag Value" },
  PTR:   { placeholder: "host.example.com.",                  hint: "Pointer hostname (FQDN)" },
  SOA:   { placeholder: "ns1.example.com. admin.example.com. 1 7200 900 1209600 86400", hint: "Single SOA record value" },
};

const TYPE_BADGE: Record<string, string> = {
  A:     "badge badge-type-a",
  AAAA:  "badge badge-type-aaaa",
  CNAME: "badge badge-type-cname",
  TXT:   "badge badge-type-txt",
  MX:    "badge badge-type-mx",
  NS:    "badge badge-type-ns",
  PTR:   "badge badge-type-ptr",
  SRV:   "badge badge-type-srv",
  CAA:   "badge badge-type-caa",
  SOA:   "badge badge-type-soa",
};

const TTL_PRESETS = [
  { label: "1m",  value: 60 },
  { label: "5m",  value: 300 },
  { label: "1h",  value: 3600 },
  { label: "12h", value: 43200 },
  { label: "1d",  value: 86400 },
];

// ── Record form component ─────────────────────────────────────────────────────

type RecordFormState = {
  id?: string;
  name: string;
  record_type: (typeof RECORD_TYPES)[number];
  ttl: number;
  valuesText: string;
  routing_policy: RoutingPolicy;
  weight: string;
  priority: string;
  comment: string;
  alias_target: string;
};

function RecordForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: RecordFormState;
  onSave: (state: RecordFormState) => Promise<void>;
  onCancel: () => void;
}) {
  const [state, setState] = useState(initial);
  const [saving, setSaving] = useState(false);
  const hint = RECORD_HINTS[state.record_type] ?? { placeholder: "Enter value", hint: "" };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(state);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="dialog-body" onSubmit={handleSubmit}>
      <div className="field-grid">
        <div className="field">
          <label htmlFor="rec-name">Record name</label>
          <input
            id="rec-name"
            value={state.name}
            onChange={(e) => setState({ ...state, name: e.target.value })}
            placeholder="www.example.com."
            required
          />
        </div>
        <div className="field">
          <label htmlFor="rec-type">Type</label>
          <select
            id="rec-type"
            value={state.record_type}
            onChange={(e) =>
              setState({ ...state, record_type: e.target.value as RecordFormState["record_type"] })
            }
          >
            {RECORD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rec-ttl">TTL (seconds)</label>
          <input
            id="rec-ttl"
            type="number"
            min={0}
            value={state.ttl}
            onChange={(e) => setState({ ...state, ttl: Number(e.target.value) })}
          />
          <div className="ttl-presets">
            {TTL_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                className={`ttl-btn ${state.ttl === p.value ? "active" : ""}`}
                onClick={() => setState({ ...state, ttl: p.value })}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="rec-routing">Routing policy</label>
          <select
            id="rec-routing"
            value={state.routing_policy}
            onChange={(e) => setState({ ...state, routing_policy: e.target.value as RoutingPolicy })}
          >
            {ROUTING_POLICIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        {state.routing_policy === "Weighted" && (
          <div className="field">
            <label htmlFor="rec-weight">Weight (0–1000)</label>
            <input
              id="rec-weight"
              type="number"
              min={0}
              max={1000}
              value={state.weight}
              onChange={(e) => setState({ ...state, weight: e.target.value })}
              placeholder="0–1000"
            />
          </div>
        )}
        {state.routing_policy === "Failover" && (
          <div className="field">
            <label htmlFor="rec-priority">Priority (0–65535)</label>
            <input
              id="rec-priority"
              type="number"
              min={0}
              max={65535}
              value={state.priority}
              onChange={(e) => setState({ ...state, priority: e.target.value })}
              placeholder="0–65535"
            />
          </div>
        )}
      </div>

      <div className="field">
        <label htmlFor="rec-values">Values — one per line</label>
        <textarea
          id="rec-values"
          rows={4}
          value={state.valuesText}
          onChange={(e) => setState({ ...state, valuesText: e.target.value })}
          placeholder={hint.placeholder}
        />
        {hint.hint && <div className="hint">💡 {hint.hint}</div>}
      </div>

      <div className="field-grid">
        <div className="field">
          <label htmlFor="rec-alias">Alias target (optional)</label>
          <input
            id="rec-alias"
            value={state.alias_target}
            onChange={(e) => setState({ ...state, alias_target: e.target.value })}
            placeholder="elb.amazonaws.com."
          />
        </div>
        <div className="field">
          <label htmlFor="rec-comment">Comment (optional)</label>
          <input
            id="rec-comment"
            value={state.comment}
            onChange={(e) => setState({ ...state, comment: e.target.value })}
            placeholder="Short description"
          />
        </div>
      </div>

      <div className="toolbar" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save record"}
        </button>
      </div>
    </form>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function HostedZoneDetailPage() {
  const params = useParams<{ zoneId: string }>();
  const zoneId = params.zoneId;
  const { pushToast } = useToast();
  const searchRef = useRef<HTMLInputElement>(null);

  const [zone, setZone]         = useState<HostedZone | null>(null);
  const [search, setSearch]     = useState("");
  const [committed, setCommitted] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage]         = useState(1);
  const [sortBy, setSortBy]     = useState("updated_at");
  const [order, setOrder]       = useState("desc");
  const [selected, setSelected] = useState<RecordFormState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DNSRecord | null>(null);
  const [checked, setChecked]   = useState<Set<string>>(new Set());

  const { data: records, loading, reload } = useDNSRecords(zoneId, committed, typeFilter, page, sortBy, order);

  // Load zone info
  useEffect(() => {
    if (!zoneId) return;
    apiFetch<HostedZone>(`/hosted-zones/${zoneId}`).then(setZone).catch(() => {});
  }, [zoneId, records]); // refresh when records change (record_count)

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setSelected(null); setDeleteTarget(null); }
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleSearch = useCallback(() => {
    setPage(1);
    setCommitted(search);
  }, [search]);

  const handleSort = useCallback((field: string) => {
    if (sortBy === field) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSortBy(field); setOrder("asc"); }
    setPage(1);
  }, [sortBy]);

  const openCreate = () =>
    setSelected({ name: "", record_type: "A", ttl: 300, valuesText: "", routing_policy: "Simple", weight: "", priority: "", comment: "", alias_target: "" });

  const openEdit = (rec: DNSRecord) =>
    setSelected({
      id: rec.id, name: rec.name, record_type: rec.record_type, ttl: rec.ttl,
      valuesText: rec.values.join("\n"), routing_policy: rec.routing_policy,
      weight: rec.weight?.toString() ?? "", priority: rec.priority?.toString() ?? "",
      comment: rec.comment, alias_target: rec.alias_target,
    });

  const saveRecord = async (state: RecordFormState) => {
    const body = {
      name: state.name, record_type: state.record_type, ttl: state.ttl,
      values: state.valuesText.split(/\r?\n/).map((v) => v.trim()).filter(Boolean),
      routing_policy: state.routing_policy,
      weight:   state.weight   ? Number(state.weight)   : null,
      priority: state.priority ? Number(state.priority) : null,
      comment: state.comment, alias_target: state.alias_target,
    };
    const method = state.id ? "PUT" : "POST";
    const path   = state.id ? `/hosted-zones/${zoneId}/records/${state.id}` : `/hosted-zones/${zoneId}/records`;
    try {
      await apiFetch(path, { method, body: JSON.stringify(body) });
      pushToast({ title: state.id ? "Record updated" : "Record created", message: state.name, kind: "success" });
      setSelected(null);
      reload();
    } catch (err) {
      pushToast({ title: "Save failed", message: err instanceof Error ? err.message : "Unknown error", kind: "error" });
      throw err; // keep modal open
    }
  };

  const removeRecord = async () => {
    if (!deleteTarget) return;
    try {
      await apiFetch<MessageResponse>(`/hosted-zones/${zoneId}/records/${deleteTarget.id}`, { method: "DELETE" });
      pushToast({ title: "Record deleted", message: deleteTarget.name, kind: "success" });
      setDeleteTarget(null);
      setChecked((prev) => { const n = new Set(prev); n.delete(deleteTarget.id); return n; });
      reload();
    } catch (err) {
      pushToast({ title: "Delete failed", message: err instanceof Error ? err.message : "Unknown error", kind: "error" });
    }
  };

  const bulkDelete = async () => {
    if (checked.size === 0) return;
    try {
      const result = await apiFetch<MessageResponse>(`/hosted-zones/${zoneId}/records`, {
        method: "DELETE",
        body: JSON.stringify({ ids: Array.from(checked) }),
      });
      pushToast({ title: "Bulk delete", message: result.message, kind: "success" });
      setChecked(new Set());
      reload();
    } catch (err) {
      pushToast({ title: "Bulk delete failed", message: err instanceof Error ? err.message : "Unknown error", kind: "error" });
    }
  };

  const exportZone = async (format: "json" | "bind" = "json") => {
    if (!zone) return;
    try {
      if (format === "bind") {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"}/api/hosted-zones/${zone.id}/export/bind`,
          { headers: { Authorization: `Bearer ${localStorage.getItem("route53_clone_token")}` } }
        );
        const text = await res.text();
        const blob = new Blob([text], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = `${zone.name.replace(/\.$/, "")}.zone`; a.click();
        URL.revokeObjectURL(url);
      } else {
        const data = await apiFetch<{ zone: HostedZone; records: DNSRecord[] }>(`/hosted-zones/${zone.id}/export`);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = `${zone.name.replace(/\.$/, "")}.json`; a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      pushToast({ title: "Export failed", message: err instanceof Error ? err.message : "Unknown error", kind: "error" });
    }
  };

  const rows       = records?.items ?? [];
  const allChecked = rows.length > 0 && rows.every((r) => checked.has(r.id));
  const someChecked = rows.some((r) => checked.has(r.id));

  const toggleAll = () => allChecked ? setChecked(new Set()) : setChecked(new Set(rows.map((r) => r.id)));
  const toggleRow = (id: string) => setChecked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const sortProps = { sortBy, order, onSort: handleSort };

  return (
    <AppShell
      title={zone?.name ?? "Hosted zone"}
      subtitle={zone ? `${zone.zone_type} · ${zone.hosted_zone_id} · ${zone.record_count} records` : "DNS record management"}
    >
      <Breadcrumb
        items={[
          { label: "Route 53" },
          { label: "Hosted zones", href: "/hosted-zones" },
          { label: zone?.name ?? "…" },
        ]}
      />

      {/* Search & filter toolbar */}
      <div className="panel" style={{ padding: "1rem", marginBottom: "1rem" }}>
        <div className="toolbar" style={{ justifyContent: "space-between" }}>
          <div className="toolbar" style={{ flex: 1 }}>
            <input
              ref={searchRef}
              placeholder="Search records (press / to focus)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              style={{ minWidth: 220 }}
            />
            <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
              <option value="">All record types</option>
              {RECORD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button className="btn btn-secondary" onClick={handleSearch}>
              {loading ? "Searching…" : "Search"}
            </button>
          </div>
          <div className="toolbar">
            <button className="btn btn-secondary" onClick={() => exportZone("json")}>Export JSON</button>
            <button className="btn btn-secondary" onClick={() => exportZone("bind")}>Export BIND</button>
            <button className="btn btn-primary" onClick={openCreate}>Create record</button>
          </div>
        </div>
      </div>

      {/* Bulk action bar */}
      {someChecked && (
        <div className="bulk-bar">
          <span className="count">{checked.size} record{checked.size !== 1 ? "s" : ""} selected</span>
          <button className="btn btn-danger" onClick={bulkDelete}>
            Delete selected
          </button>
          <span className="helper">Apex NS and SOA records are protected and will be skipped.</span>
        </div>
      )}

      {/* Table */}
      {loading && !records ? (
        <TableSkeleton rows={6} cols={6} />
      ) : rows.length === 0 ? (
        <EmptyState title="No records found" message="Create a record or broaden your search and filters." />
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th className="col-check">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked; }}
                    onChange={toggleAll}
                  />
                </th>
                <SortTh label="Name"           field="name"           {...sortProps} />
                <SortTh label="Type"           field="record_type"    {...sortProps} />
                <SortTh label="TTL"            field="ttl"            {...sortProps} />
                <SortTh label="Routing policy" field="routing_policy" {...sortProps} />
                <th>Values</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((rec) => (
                <tr key={rec.id} style={checked.has(rec.id) ? { background: "rgba(247,165,49,0.05)" } : undefined}>
                  <td className="col-check">
                    <input type="checkbox" checked={checked.has(rec.id)} onChange={() => toggleRow(rec.id)} />
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>{rec.name}</td>
                  <td>
                    <span className={TYPE_BADGE[rec.record_type] ?? "badge"}>
                      {rec.record_type}
                    </span>
                  </td>
                  <td>{rec.ttl}s</td>
                  <td>
                    <span className="badge">{rec.routing_policy}</span>
                  </td>
                  <td style={{ maxWidth: "260px" }}>
                    {rec.values.map((v, i) => (
                      <div key={i} style={{ fontFamily: "monospace", fontSize: "0.8rem", wordBreak: "break-all" }}>
                        {v}
                      </div>
                    ))}
                    {rec.alias_target && (
                      <div className="helper">→ {rec.alias_target}</div>
                    )}
                  </td>
                  <td>
                    <div className="toolbar">
                      <button className="btn btn-secondary" onClick={() => openEdit(rec)}>
                        Edit
                      </button>
                      <button className="btn btn-danger" onClick={() => setDeleteTarget(rec)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={records?.meta.page ?? 1}
        pageSize={records?.meta.page_size ?? 10}
        total={records?.meta.total ?? 0}
        totalPages={records?.meta.total_pages ?? 0}
        onPageChange={(p) => { setPage(p); setChecked(new Set()); }}
      />

      {/* Create / Edit modal */}
      {selected && (
        <Modal
          title={selected.id ? `Edit ${selected.record_type} record` : "Create DNS record"}
          subtitle="All record types are validated and persisted in SQLite."
          onClose={() => setSelected(null)}
        >
          <RecordForm initial={selected} onSave={saveRecord} onCancel={() => setSelected(null)} />
        </Modal>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <Modal
          title="Delete record"
          subtitle={`${deleteTarget.name} (${deleteTarget.record_type}) will be permanently removed.`}
          onClose={() => setDeleteTarget(null)}
          width={540}
        >
          <div className="dialog-body">
            {(deleteTarget.record_type === "NS" || deleteTarget.record_type === "SOA") && (
              <div className="soft-panel" style={{ padding: "0.85rem", color: "#ffd28b" }}>
                ⚠️ Apex NS and SOA records are protected — this delete may be rejected by the server.
              </div>
            )}
            <div className="soft-panel" style={{ padding: "0.85rem", color: "#ffb8b8" }}>
              This action is permanent and cannot be undone.
            </div>
            <div className="toolbar" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={removeRecord}>
                Delete record
              </button>
            </div>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}
