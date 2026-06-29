"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api";
import { DNSRecord, HostedZone, PageResponse } from "./types";

// ── useHostedZones ────────────────────────────────────────────────────────────

export function useHostedZones(
  search: string,
  page: number,
  pageSize: number = 8,
  sortBy: string = "updated_at",
  order: string = "desc"
) {
  const [data, setData] = useState<PageResponse<HostedZone> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<PageResponse<HostedZone>>(
        `/hosted-zones?search=${encodeURIComponent(search)}&page=${page}&page_size=${pageSize}&sort_by=${sortBy}&order=${order}`
      );
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [search, page, pageSize, sortBy, order]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, error, reload };
}

// ── useDNSRecords ─────────────────────────────────────────────────────────────

export function useDNSRecords(
  zoneId: string,
  search: string,
  typeFilter: string,
  page: number,
  sortBy: string = "updated_at",
  order: string = "desc"
) {
  const [data, setData] = useState<PageResponse<DNSRecord> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!zoneId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<PageResponse<DNSRecord>>(
        `/hosted-zones/${zoneId}/records?search=${encodeURIComponent(search)}&record_type=${encodeURIComponent(typeFilter)}&page=${page}&page_size=10&sort_by=${sortBy}&order=${order}`
      );
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [zoneId, search, typeFilter, page, sortBy, order]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, error, reload };
}
