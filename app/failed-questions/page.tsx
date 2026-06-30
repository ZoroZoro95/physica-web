"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

const API = (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");

type AuthState = {
  token: string;
  user: {
    email?: string;
    name?: string;
    picture?: string;
  };
};

type FeedbackTicket = {
  ticket_id: string;
  created_at: string;
  updated_at: string;
  status: "open" | "resolved" | string;
  question_text: string;
  debug_report_id?: string | null;
  latest_response?: {
    status?: string;
    reason?: string;
    engine_case?: string;
    answer?: string | null;
    matched_option?: string | null;
  };
  resolved_at?: string | null;
  resolved_response?: {
    status?: string;
    reason?: string;
    engine_case?: string;
    answer?: string | null;
    matched_option?: string | null;
  } | null;
  attempts?: number;
};

type RetrySummary = {
  checked: number;
  resolved: number;
  still_open: number;
  resolved_ticket_ids: string[];
};

function loadStoredAuth(): AuthState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("physica.auth");
    return raw ? JSON.parse(raw) as AuthState : null;
  } catch {
    return null;
  }
}

function authHeaders(auth: AuthState | null): HeadersInit {
  return auth?.token ? { Authorization: `Bearer ${auth.token}` } : {};
}

export default function FailedQuestionsPage() {
  const [auth] = useState<AuthState | null>(() => loadStoredAuth());
  const [tickets, setTickets] = useState<FeedbackTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [retrySummary, setRetrySummary] = useState<RetrySummary | null>(null);

  const loadTickets = useCallback(async (currentAuth: AuthState | null = auth) => {
    if (!currentAuth) {
      setLoading(false);
      setTickets([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API}/feedback/questions`, { headers: authHeaders(currentAuth) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail ?? "Could not load failed questions");
      setTickets(data.tickets ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load failed questions");
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    // Account-specific data has to be loaded after localStorage auth is available.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTickets(auth);
  }, [auth, loadTickets]);

  const summary = useMemo(() => {
    const open = tickets.filter(ticket => ticket.status !== "resolved").length;
    const resolved = tickets.length - open;
    return { open, resolved, total: tickets.length };
  }, [tickets]);

  const checkAgain = async () => {
    if (!auth) return;
    setChecking(true);
    setError("");
    setRetrySummary(null);
    try {
      const response = await fetch(`${API}/feedback/retry`, {
        method: "POST",
        headers: authHeaders(auth),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail ?? "Retry check failed");
      setRetrySummary(data);
      await loadTickets(auth);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry check failed");
    } finally {
      setChecking(false);
    }
  };

  return (
    <main style={styles.page}>
      <section style={styles.shell}>
        <div style={styles.header}>
          <div>
            <div style={styles.eyebrow}>Internal beta</div>
            <h1 style={styles.title}>Failed questions</h1>
            <p style={styles.subtitle}>
              Check whether questions that previously failed have started passing after solver updates.
            </p>
          </div>
          <Link href="/" style={styles.homeLink}>Back to solver</Link>
        </div>

        {!auth ? (
          <div style={styles.panel}>
            <h2 style={styles.panelTitle}>Sign in required</h2>
            <p style={styles.muted}>
              Failed-question status is tied to your signed-in account. Sign in on the solver page, then return here.
            </p>
            <Link href="/" style={styles.primaryLink}>Open solver</Link>
          </div>
        ) : (
          <>
            <div style={styles.summaryGrid}>
              <SummaryCard label="Open" value={summary.open} tone="warn" />
              <SummaryCard label="Solved" value={summary.resolved} tone="good" />
              <SummaryCard label="Total" value={summary.total} tone="neutral" />
            </div>

            <div style={styles.toolbar}>
              <div style={styles.accountText}>
                {auth.user.name || auth.user.email || "Signed in"}
              </div>
              <div style={styles.toolbarActions}>
                <button type="button" onClick={() => loadTickets(auth)} style={styles.secondaryButton} disabled={loading || checking}>
                  Refresh
                </button>
                <button type="button" onClick={checkAgain} style={styles.primaryButton} disabled={loading || checking || summary.open === 0}>
                  {checking ? "Checking..." : "Check open questions"}
                </button>
              </div>
            </div>

            {retrySummary && (
              <div style={styles.notice}>
                Checked {retrySummary.checked}. Resolved {retrySummary.resolved}. Still open {retrySummary.still_open}.
              </div>
            )}

            {error && <div style={styles.error}>{error}</div>}

            <div style={styles.list}>
              {loading ? (
                <div style={styles.empty}>Loading failed questions...</div>
              ) : tickets.length === 0 ? (
                <div style={styles.empty}>No failed questions saved for this account yet.</div>
              ) : (
                tickets.map(ticket => <TicketCard key={ticket.ticket_id} ticket={ticket} />)
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: "warn" | "good" | "neutral" }) {
  const color = tone === "good" ? "#1f7a5a" : tone === "warn" ? "#b8872f" : "#17333d";
  return (
    <div style={styles.summaryCard}>
      <div style={{ ...styles.summaryValue, color }}>{value}</div>
      <div style={styles.summaryLabel}>{label}</div>
    </div>
  );
}

function TicketCard({ ticket }: { ticket: FeedbackTicket }) {
  const resolved = ticket.status === "resolved";
  const response = resolved ? ticket.resolved_response : ticket.latest_response;
  return (
    <article style={styles.ticketCard}>
      <div style={styles.ticketTopline}>
        <span style={{
          ...styles.statusPill,
          background: resolved ? "rgba(31,122,90,0.10)" : "rgba(184,135,47,0.12)",
          color: resolved ? "#1f7a5a" : "#8a621b",
          borderColor: resolved ? "rgba(31,122,90,0.22)" : "rgba(184,135,47,0.28)",
        }}>
          {resolved ? "Solved" : "Open"}
        </span>
        <span style={styles.ticketMeta}>
          {ticket.ticket_id} · attempts {ticket.attempts ?? 0} · updated {formatDate(ticket.updated_at)}
        </span>
      </div>
      <div style={styles.questionText}>{ticket.question_text}</div>
      {response?.answer ? (
        <div style={styles.answerBox}>
          Answer: {response.answer}
          {response.matched_option ? ` · option ${response.matched_option}` : ""}
        </div>
      ) : response?.reason ? (
        <div style={styles.reasonBox}>{response.reason}</div>
      ) : null}
      {response?.engine_case && (
        <div style={styles.engineCase}>{response.engine_case}</div>
      )}
    </article>
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#eef4f3",
    color: "#102027",
    fontFamily: "var(--font-ui), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    overflow: "auto",
    padding: "32px 18px",
  },
  shell: {
    maxWidth: 1040,
    margin: "0 auto",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 18,
    marginBottom: 24,
  },
  eyebrow: {
    color: "#2c7a78",
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    marginBottom: 8,
  },
  title: {
    fontSize: 38,
    lineHeight: 1.05,
    margin: 0,
    fontWeight: 850,
  },
  subtitle: {
    margin: "10px 0 0",
    color: "#4b626b",
    fontSize: 15,
    lineHeight: 1.55,
    maxWidth: 620,
  },
  homeLink: {
    border: "1px solid rgba(16,32,39,0.16)",
    background: "#fbfcfa",
    color: "#17333d",
    textDecoration: "none",
    borderRadius: 8,
    padding: "9px 12px",
    fontSize: 13,
    fontWeight: 800,
    whiteSpace: "nowrap",
  },
  panel: {
    background: "#fbfcfa",
    border: "1px solid rgba(16,32,39,0.12)",
    borderRadius: 10,
    padding: 20,
  },
  panelTitle: {
    margin: 0,
    fontSize: 20,
  },
  muted: {
    color: "#607078",
    lineHeight: 1.55,
    margin: "8px 0 16px",
  },
  primaryLink: {
    display: "inline-flex",
    background: "#2c7a78",
    color: "#fbfcfa",
    textDecoration: "none",
    borderRadius: 8,
    padding: "10px 14px",
    fontWeight: 800,
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 12,
    marginBottom: 14,
  },
  summaryCard: {
    background: "#fbfcfa",
    border: "1px solid rgba(16,32,39,0.12)",
    borderRadius: 10,
    padding: 16,
  },
  summaryValue: {
    fontSize: 32,
    lineHeight: 1,
    fontWeight: 900,
  },
  summaryLabel: {
    marginTop: 6,
    color: "#607078",
    fontSize: 12,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  toolbar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    background: "#fbfcfa",
    border: "1px solid rgba(16,32,39,0.12)",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  accountText: {
    color: "#4b626b",
    fontSize: 13,
    fontWeight: 750,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  toolbarActions: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  primaryButton: {
    border: "none",
    background: "#2c7a78",
    color: "#fbfcfa",
    borderRadius: 8,
    padding: "9px 12px",
    fontSize: 13,
    fontWeight: 850,
    cursor: "pointer",
  },
  secondaryButton: {
    border: "1px solid rgba(16,32,39,0.16)",
    background: "#fbfcfa",
    color: "#17333d",
    borderRadius: 8,
    padding: "9px 12px",
    fontSize: 13,
    fontWeight: 850,
    cursor: "pointer",
  },
  notice: {
    background: "rgba(31,122,90,0.10)",
    border: "1px solid rgba(31,122,90,0.22)",
    color: "#1f7a5a",
    borderRadius: 8,
    padding: "10px 12px",
    marginBottom: 12,
    fontSize: 13,
    fontWeight: 750,
  },
  error: {
    background: "rgba(184,79,68,0.10)",
    border: "1px solid rgba(184,79,68,0.22)",
    color: "#9b342b",
    borderRadius: 8,
    padding: "10px 12px",
    marginBottom: 12,
    fontSize: 13,
    fontWeight: 750,
  },
  list: {
    display: "grid",
    gap: 12,
  },
  empty: {
    background: "#fbfcfa",
    border: "1px solid rgba(16,32,39,0.12)",
    borderRadius: 10,
    padding: 18,
    color: "#607078",
  },
  ticketCard: {
    background: "#fbfcfa",
    border: "1px solid rgba(16,32,39,0.12)",
    borderRadius: 10,
    padding: 16,
    boxShadow: "0 14px 36px rgba(23,36,43,0.06)",
  },
  ticketTopline: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 10,
  },
  statusPill: {
    border: "1px solid",
    borderRadius: 999,
    padding: "4px 8px",
    fontSize: 11,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  ticketMeta: {
    color: "#72828a",
    fontSize: 12,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  questionText: {
    fontSize: 15,
    lineHeight: 1.55,
    color: "#102027",
    marginBottom: 12,
  },
  answerBox: {
    background: "rgba(31,122,90,0.08)",
    border: "1px solid rgba(31,122,90,0.18)",
    color: "#1f7a5a",
    borderRadius: 8,
    padding: "9px 10px",
    fontSize: 13,
    fontWeight: 800,
    marginBottom: 8,
  },
  reasonBox: {
    background: "rgba(184,135,47,0.08)",
    border: "1px solid rgba(184,135,47,0.18)",
    color: "#8a621b",
    borderRadius: 8,
    padding: "9px 10px",
    fontSize: 13,
    lineHeight: 1.45,
    marginBottom: 8,
  },
  engineCase: {
    color: "#72828a",
    fontSize: 12,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
};
