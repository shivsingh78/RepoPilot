"use client";

import { useEffect, useState } from "react";

interface Run {
  id: string;
  status: string;
  stage: string;
  repoUrl: string;
  errorCode: string | null;
  errorMessage: string | null;
}
interface RunEvent {
  id: number;
  stage: string | null;
  level: string;
  type: string;
  message: string;
  createdAt: string;
}

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export function RunForm() {
  const [url, setUrl] = useState("https://github.com/");
  const [run, setRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!run || TERMINAL.has(run.status)) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/runs/${run.id}`);
      const body = await res.json();
      if (body.run) setRun(body.run);
      if (body.events) setEvents(body.events);
    }, 2000);
    return () => clearInterval(t);
  }, [run]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setEvents([]);
    try {
      const res = await fetch("/api/runs", { method: "POST", body: JSON.stringify({ repoUrl: url }) });
      const body = await res.json();
      if (!res.ok) {
        setError(`${body.error?.code ?? res.status}: ${body.error?.message ?? "request failed"}`);
        setRun(null);
      } else {
        setRun(body.run);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <form onSubmit={submit} style={{ display: "flex", gap: 8 }}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/owner/repo"
          style={{ flex: 1, padding: "0.6rem 0.8rem", borderRadius: 6, border: "1px solid #2a3140", background: "#121620", color: "inherit" }}
        />
        <button disabled={busy} style={{ padding: "0.6rem 1rem", borderRadius: 6, border: 0, background: "#4f7cff", color: "white", cursor: "pointer" }}>
          {busy ? "Submitting…" : "Analyse"}
        </button>
      </form>
      {error && <p style={{ color: "#ff7b7b" }}>{error}</p>}
      {run && (
        <div style={{ marginTop: 24, padding: 16, border: "1px solid #2a3140", borderRadius: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>
              <b>{run.repoUrl}</b>
            </span>
            <span>
              status <code>{run.status}</code> · stage <code>{run.stage}</code>
            </span>
          </div>
          {run.errorCode && (
            <p style={{ color: "#ffb86b" }}>
              {run.errorCode}: {run.errorMessage}
            </p>
          )}
          <ol style={{ paddingLeft: 18, color: "#c3c9d4" }}>
            {events.map((ev) => (
              <li key={ev.id} style={{ color: ev.level === "error" ? "#ff7b7b" : undefined }}>
                <code>{ev.type}</code> {ev.message}
              </li>
            ))}
          </ol>
          <p style={{ fontSize: 12, color: "#7c8596" }}>run id {run.id}</p>
        </div>
      )}
    </section>
  );
}
