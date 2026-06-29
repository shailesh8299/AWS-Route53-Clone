"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearStoredToken, getStoredToken } from "../lib/auth";
import { apiFetch } from "../lib/api";
import { AuthUser } from "../lib/types";
import { useToast } from "./toast-context";

const NAV_ITEMS = [
  { href: "/dashboard",        label: "Dashboard",         icon: "◈" },
  { href: "/hosted-zones",     label: "Hosted zones",      icon: "⬡" },
  { href: "/traffic-policies", label: "Traffic policies",  icon: "⇄" },
  { href: "/health-checks",    label: "Health checks",     icon: "♡" },
  { href: "/resolver",         label: "Resolver",          icon: "⌖" },
  { href: "/profiles",         label: "Profiles",          icon: "⊙" },
];

export function AppShell({
  children,
  title,
  subtitle,
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { pushToast } = useToast();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    apiFetch<AuthUser>("/auth/me")
      .then(setUser)
      .catch(() => router.replace("/login"))
      .finally(() => setReady(true));
  }, [router]);

  const handleLogout = async () => {
    try {
      await apiFetch<{ message: string }>("/auth/logout", { method: "POST" });
    } finally {
      clearStoredToken();
      pushToast({ title: "Signed out", message: "Your session has been cleared.", kind: "success" });
      router.replace("/login");
    }
  };

  if (!ready) {
    return (
      <div className="auth-stage">
        <div className="panel auth-card" style={{ textAlign: "center" }}>
          <div className="spinner" style={{ margin: "0 auto 1rem" }} />
          Loading Route53 workspace…
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      {/* ── Top navigation bar ── */}
      <header className="topnav">
        <div className="topnav-brand">
          <span className="topnav-logo">AWS</span>
          <span className="topnav-service">Route 53</span>
        </div>
        <div className="topnav-center">
          <span className="topnav-region">🌐 us-east-1 (mocked)</span>
        </div>
        <div className="topnav-right">
          <span className="topnav-user" title={user?.email ?? user?.username ?? ""}>
            {user?.display_name ?? "Route53 User"}
          </span>
          <button className="btn btn-ghost-sm" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </header>

      {/* ── Layout ── */}
      <div className="layout" style={{ flex: 1 }}>
        <aside className="sidebar">
          <div className="sidebar-card">
            <div className="badge badge-warn" style={{ marginBottom: "0.5rem" }}>Route 53</div>
            <div style={{ fontWeight: 600 }}>{user?.display_name ?? "Route53 User"}</div>
            <div className="helper">{user?.email ?? user?.username ?? "Signed in"}</div>
          </div>
          <nav style={{ marginTop: "1rem", display: "grid", gap: "0.2rem" }}>
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-link ${active ? "active" : ""}`}
                >
                  <span className="nav-icon">{item.icon}</span>
                  <span className="nav-label">{item.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="sidebar-card" style={{ marginTop: "1rem" }}>
            <div className="helper">Storage</div>
            <strong>SQLite-backed</strong>
            <div className="helper" style={{ marginTop: "0.3rem" }}>
              Persistent zones, records, and JWT sessions.
            </div>
          </div>
        </aside>

        <main className="content">
          <div className="panel topbar">
            <div>
              <h1 className="page-title">{title}</h1>
              {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
            </div>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
