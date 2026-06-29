"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { Breadcrumb, EmptyState, Modal, Pagination, SortTh, TableSkeleton } from "../../components/ui";
import { apiFetch } from "../../lib/api";
import { useHostedZones } from "../../lib/hooks";
import { HostedZone, MessageResponse } from "../../lib/types";
import { useToast } from "../../components/toast-context";

// ── Zone form ─────────────────────────────────────────────────────────────────

type ZoneFormState = {
  id?: string;
  name: string;
  comment: string;
  zone_type: "Public Hosted Zone" | "Private Hosted Zone";
};

function ZoneForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: ZoneFormState;
  onSave: (data: ZoneFormState) => Promise<void>;
  onCancel: () => void;
}) {
  const [state, setState] = useState(initial);
  const [saving, setSaving] = useState(false);
  const isEdit = !!state.id;

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
          <label htmlFor="zone-name">Hosted zone name</label>
          <input
            id="zone-name"
            value={state.name}
            onChange={(e) => setState({ ...state, name: e.target.value })}
            placeholder="example.com."
            readOnly={isEdit}
            title={isEdit ? "Zone names are immutable after creation" : undefined}
            required
          />
          {isEdit && (
            <div className="hint">Zone names cannot be changed after creation</div>
          )}
        </div>
        <div className="field">
          <label htmlFor="zone-type">Type</label>
          <select
            id="zone-type"
            value={state.zone_type}
            onChange={(e) =>
              setState({ ...state, zone_type: e.target.value as ZoneFormState["zone_type"] })
            }
          >
            <option value="Public Hosted Zone">Public Hosted Zone</option>
            <option value="Private Hosted Zone">Private Hosted Zone</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="zone-comment">Comment</label>
        <textarea
          id="zone-comment"
          rows={3}
          value={state.comment}
          onChange={(e) => setState({ ...state, comment: e.target.value })}
          placeholder="Short descriptive comment"
        />
      </div>
      <div className="toolbar" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function HostedZonesPage() {
  const { pushToast } = useToast();
  const searchRef = useRef<HTMLInputElement>(null);

  const [query, setQuery]             = useState("");
  const [committedQuery, setCommitted] = useState("");
  const [page, setPage]               = useState(1);
  const [sortBy, setSortBy]           = useState("updated_at");
  const [order, setOrder]             = useState("desc");
  const [selected, setSelected]       = useState<ZoneFormState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HostedZone | null>(null);
  const [checked, setChecked]         = useState<Set<string>>(new Set());

  const { data: payload, loading, reload } = useHostedZones(committedQuery, page, 8, sortBy, order);

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
    setCommitted(query);
  }, [query]);

  const handleSort = useCallback((field: string) => {
    if (sortBy === field) {
      setOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setOrder("asc");
    }
    setPage(1);
  }, [sortBy]);

  const openCreate = () => setSelected({ name: "", comment: "", zone_type: "Public Hosted Zone" });
  const openEdit   = (zone: HostedZone) =>
    setSelected({ id: zone.id, name: zone.name, comment: zone.comment, zone_type: zone.zone_type });

  const saveZone = async (state: ZoneFormState) => {
    const method = state.id ? "PUT" : "POST";
    const path   = state.id ? `/hosted-zones/${state.id}` : "/hosted-zones";
    // For PUT, only send comment and zone_type (name is immutable)
    const body   = state.id
      ? { comment: state.comment, zone_type: state.zone_type }
      : { name: state.name, comment: state.comment, zone_type: state.zone_type };
    try {
      await apiFetch(path, { method, body: JSON.stringify(body) });
      pushToast({ title: state.id ? "Zone updated" : "Zone created", message: state.name, kind: "success" });
      setSelected(null);
      setPage(1);
      reload();
    } catch (err) {
      pushToast({ title: "Save failed", message: err instanceof Error ? err.message : "Unknown error", kind: "error" });
    }
  };

  const removeZone = async () => {
    if (!deleteTarget) return;
    try {
      await apiFetch<MessageResponse>(`/hosted-zones/${deleteTarget.id}`, { method: "DELETE" });
      pushToast({ title: "Zone deleted", message: deleteTarget.name, kind: "success" });
      setDeleteTarget(null);
      reload();
    } catch (err) {
      pushToast({ title: "Delete failed", message: err instanceof Error ? err.message : "Unknown error", kind: "error" });
    }
  };

  const exportZone = async (zone: HostedZone, format: "json" | "bind" = "json") => {
    try {
      if (format === "bind") {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"}/api/hosted-zones/${zone.id}/export/bind`,
          { headers: { Authorization: `Bearer ${localStorage.getItem("route53_clone_token")}` } }
        );
        const text = await res.text();
        const blob = new Blob([text], { type: "text/plain" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a"); a.href = url; a.download = `${zone.name.replace(/\.$/, "")}.zone`; a.click();
        URL.revokeObjectURL(url);
      } else {
        const data = await apiFetch<{ zone: HostedZone; records: unknown[] }>(`/hosted-zones/${zone.id}/export`);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a"); a.href = url; a.download = `${zone.name.replace(/\.$/, "")}.json`; a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      pushToast({ title: "Export failed", message: err instanceof Error ? err.message : "Unknown error", kind: "error" });
    }
  };

  const rows        = payload?.items ?? [];
  const allChecked  = rows.length > 0 && rows.every((z) => checked.has(z.id));
  const someChecked = rows.some((z) => checked.has(z.id));

  const toggleAll = () => {
    if (allChecked) {
      setChecked(new Set());
    } else {
      setChecked(new Set(rows.map((z) => z.id)));
    }
  };
  const toggleRow = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const sortProps = { sortBy, order, onSort: handleSort };

  return (
    <AppShell
      title="Hosted zones"
      subtitle="Search, manage, and inspect hosted zones with persistent SQLite storage."
    >
      <Breadcrumb items={[{ label: "Route 53" }, { label: "Hosted zones" }]} />

      {/* Toolbar */}
      <div className="panel" style={{ padding: "1rem", marginBottom: "1rem" }}>
        <div className="toolbar" style={{ justifyContent: "space-between" }}>
          <div className="toolbar" style={{ flex: 1 }}>
            <input
              ref={searchRef}
              placeholder="Search hosted zones (press / to focus)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              style={{ minWidth: 280 }}
            />
            <button className="btn btn-secondary" onClick={handleSearch}>
              {loading ? "Searching…" : "Search"}
            </button>
          </div>
          <button className="btn btn-primary" onClick={openCreate}>
            Create hosted zone
          </button>
        </div>
      </div>

      {/* Bulk action bar */}
      {someChecked && (
        <div className="bulk-bar">
          <span className="count">{checked.size} selected</span>
          <button
            className="btn btn-danger"
            onClick={() => {
              const zone = rows.find((z) => checked.has(z.id));
              if (zone) setDeleteTarget(zone);
            }}
          >
            Delete selected
          </button>
        </div>
      )}

      {/* Table */}
      {loading && !payload ? (
        <TableSkeleton rows={5} cols={6} />
      ) : rows.length === 0 ? (
        <EmptyState title="No hosted zones found" message="Create a hosted zone or broaden your search." />
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
                <SortTh label="Name"       field="name"       {...sortProps} />
                <SortTh label="Zone ID"    field="caller_reference" {...sortProps} />
                <SortTh label="Type"       field="zone_type"  {...sortProps} />
                <th>Comment</th>
                <SortTh label="Records"    field="record_count" {...sortProps} />
                <SortTh label="Updated"    field="updated_at" {...sortProps} />
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((zone) => (
                <tr key={zone.id} style={checked.has(zone.id) ? { background: "rgba(247,165,49,0.05)" } : undefined}>
                  <td className="col-check">
                    <input type="checkbox" checked={checked.has(zone.id)} onChange={() => toggleRow(zone.id)} />
                  </td>
                  <td>
                    <Link href={`/hosted-zones/${zone.id}`} style={{ fontWeight: 600 }}>
                      {zone.name}
                    </Link>
                  </td>
                  <td>
                    <span className="zone-id">{zone.hosted_zone_id}</span>
                  </td>
                  <td>
                    <span className="badge">{zone.zone_type}</span>
                  </td>
                  <td className="muted" style={{ maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {zone.comment}
                  </td>
                  <td>{zone.record_count}</td>
                  <td className="muted">{new Date(zone.updated_at).toLocaleString()}</td>
                  <td>
                    <div className="toolbar">
                      <button className="btn btn-secondary" onClick={() => openEdit(zone)}>
                        Edit
                      </button>
                      <button className="btn btn-secondary" onClick={() => exportZone(zone, "json")}>
                        JSON
                      </button>
                      <button className="btn btn-secondary" onClick={() => exportZone(zone, "bind")}>
                        BIND
                      </button>
                      <button className="btn btn-danger" onClick={() => setDeleteTarget(zone)}>
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
        page={payload?.meta.page ?? 1}
        pageSize={payload?.meta.page_size ?? 8}
        total={payload?.meta.total ?? 0}
        totalPages={payload?.meta.total_pages ?? 0}
        onPageChange={(p) => { setPage(p); setChecked(new Set()); }}
      />

      {/* Create / Edit modal */}
      {selected && (
        <Modal
          title={selected.id ? "Edit hosted zone" : "Create hosted zone"}
          subtitle={selected.id ? "Zone name is immutable after creation." : "Hosted zones and metadata persist in SQLite."}
          onClose={() => setSelected(null)}
        >
          <ZoneForm initial={selected} onSave={saveZone} onCancel={() => setSelected(null)} />
        </Modal>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <Modal
          title="Delete hosted zone"
          subtitle={`${deleteTarget.name} and all DNS records will be permanently removed.`}
          onClose={() => setDeleteTarget(null)}
          width={560}
        >
          <div className="dialog-body">
            <div className="soft-panel" style={{ padding: "1rem", color: "#ffb8b8" }}>
              ⚠️ This action is permanent and cannot be undone. All DNS records in this zone will also be deleted.
            </div>
            <div className="toolbar" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={removeZone}>
                Delete zone
              </button>
            </div>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}
