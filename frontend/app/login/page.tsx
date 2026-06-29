"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { setStoredToken } from "../../lib/auth";
import { useToast } from "../../components/toast-context";

export default function LoginPage() {
  const router = useRouter();
  const { pushToast } = useToast();
  const [email, setEmail] = useState("demo@example.com");
  const [password, setPassword] = useState("demo123");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    try {
      const result = await apiFetch<{
        token: string;
        user: { id: string; username: string; email: string | null; display_name: string };
      }>("/auth/login", {
        method: "POST",
        auth: false,
        body: JSON.stringify({ email, password }),
      });
      setStoredToken(result.token);
      pushToast({
        title: "Welcome back",
        message: `Signed in as ${result.user.display_name}.`,
        kind: "success",
      });
      router.replace("/dashboard");
    } catch (error) {
      pushToast({
        title: "Login failed",
        message: error instanceof Error ? error.message : "Unable to sign in.",
        kind: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-stage">
      <form className="panel auth-card" onSubmit={onSubmit}>
        <div className="badge badge-warn" style={{ marginBottom: "0.75rem" }}>
          Route 53 Clone
        </div>
        <h1 style={{ margin: "0 0 0.3rem" }}>Sign in to Route 53</h1>
        <p className="helper">
          Mocked authentication — any email and password are accepted.
        </p>
        <div className="dialog-body" style={{ marginTop: "1.25rem" }}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="demo@example.com"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Any password"
              required
            />
          </div>
          <button className="btn btn-primary" disabled={loading} style={{ width: "100%", marginTop: "0.5rem" }}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </div>
        <div className="helper" style={{ marginTop: "1rem", padding: "0.75rem", background: "rgba(247,165,49,0.06)", borderRadius: "10px", border: "1px solid rgba(247,165,49,0.15)" }}>
          <strong>Demo credentials:</strong> demo@example.com / demo123<br />
          Or use any email and any password — auth is mocked.
        </div>
      </form>
    </div>
  );
}
