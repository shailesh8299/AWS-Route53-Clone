"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getStoredToken } from "../lib/auth";

export default function HomePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(getStoredToken() ? "/dashboard" : "/login");
  }, [router]);
  return <div className="auth-stage"><div className="panel auth-card">Loading Route53 Clone…</div></div>;
}
