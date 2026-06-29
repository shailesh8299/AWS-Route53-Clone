"use client";

import { useEffect, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { Breadcrumb } from "../../components/ui";
import { apiFetch } from "../../lib/api";
import { PageResponse, HostedZone } from "../../lib/types";

type Stats = {
  hosted_zones: number;
  dns_records: number;
  public_zones: number;
  private_zones: number;
};

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [zones, setZones] = useState<HostedZone[]>([]);

  useEffect(() => {
    apiFetch<Stats>("/stats").then(setStats);
    apiFetch<PageResponse<HostedZone>>("/hosted-zones?page_size=4").then((payload) => setZones(payload.items));
  }, []);

  return (
    <AppShell title="Dashboard" subtitle="Route53-style overview of hosted zones, records, and recent activity.">
      <Breadcrumb items={[{ label: "Route 53" }, { label: "Dashboard" }]} />
      <div className="grid grid-4">
        <div className="panel stat"><span className="muted">Hosted zones</span><span className="value">{stats?.hosted_zones ?? "—"}</span></div>
        <div className="panel stat"><span className="muted">DNS records</span><span className="value">{stats?.dns_records ?? "—"}</span></div>
        <div className="panel stat"><span className="muted">Public zones</span><span className="value">{stats?.public_zones ?? "—"}</span></div>
        <div className="panel stat"><span className="muted">Private zones</span><span className="value">{stats?.private_zones ?? "—"}</span></div>
      </div>
      <div className="split">
        <section className="panel hero">
          <div className="badge badge-accent">Hosted Zone Management</div>
          <h1>Operate Route53 workflows without AWS dependencies.</h1>
          <p>This clone keeps the navigational structure, tables, filters, modals, and search-driven workflows that users expect in Route53. Hosted zones and DNS records persist in SQLite, while login state is saved in the browser and validated by the backend.</p>
        </section>
        <section className="panel" style={{ padding: "1rem" }}>
          <h3 style={{ marginTop: 0 }}>Recently viewed zones</h3>
          <div className="grid" style={{ gap: "0.7rem" }}>
            {zones.map((zone) => (
              <div key={zone.id} className="soft-panel" style={{ padding: "0.85rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
                  <strong>{zone.name}</strong>
                  <span className="badge">{zone.zone_type}</span>
                </div>
                <div className="helper" style={{ marginTop: "0.3rem" }}>{zone.record_count} records</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
