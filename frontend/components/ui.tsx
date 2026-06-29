"use client";

import Link from "next/link";

// ── Modal ─────────────────────────────────────────────────────────────────────

export function Modal({
  title,
  subtitle,
  children,
  onClose,
  width = 920,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  width?: number;
}) {
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="panel dialog"
        style={{ width: `min(${width}px, 100%)` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">
          <div>
            <h3 style={{ margin: 0 }}>{title}</h3>
            {subtitle ? <div className="helper">{subtitle}</div> : null}
          </div>
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Pagination ─────────────────────────────────────────────────────────────────

export function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return (
    <div className="pagination-bar">
      <div className="helper">
        {total === 0 ? "No results" : `Viewing ${start}–${end} of ${total} result${total !== 1 ? "s" : ""}`}
      </div>
      <div className="toolbar">
        <button
          className="btn btn-secondary"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          ← Previous
        </button>
        <span className="page-indicator">
          Page {page} of {Math.max(1, totalPages)}
        </span>
        <button
          className="btn btn-secondary"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────────

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="soft-panel empty-state">
      <div className="empty-icon">🔍</div>
      <strong>{title}</strong>
      <div className="helper" style={{ marginTop: "0.3rem" }}>
        {message}
      </div>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="panel table-wrap">
      <table>
        <thead>
          <tr>
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i}>
                <div className="skeleton" style={{ width: "80px", height: "12px" }} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c}>
                  <div
                    className="skeleton"
                    style={{ width: `${60 + ((r * cols + c) % 4) * 20}px`, height: "14px" }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Breadcrumb ────────────────────────────────────────────────────────────────

export type BreadcrumbItem = { label: string; href?: string };

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      {items.map((item, i) => (
        <span key={i} className="breadcrumb-item">
          {i > 0 && <span className="breadcrumb-sep">›</span>}
          {item.href ? (
            <Link href={item.href} className="breadcrumb-link">
              {item.label}
            </Link>
          ) : (
            <span className="breadcrumb-current">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

// ── SortHeader ─────────────────────────────────────────────────────────────────

export function SortTh({
  label,
  field,
  sortBy,
  order,
  onSort,
}: {
  label: string;
  field: string;
  sortBy: string;
  order: string;
  onSort: (field: string) => void;
}) {
  const active = sortBy === field;
  return (
    <th
      className={`sortable-th ${active ? "sort-active" : ""}`}
      onClick={() => onSort(field)}
      title={`Sort by ${label}`}
    >
      {label}
      <span className="sort-arrow">{active ? (order === "asc" ? " ▲" : " ▼") : " ⇕"}</span>
    </th>
  );
}
