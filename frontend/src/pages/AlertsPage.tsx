import { useEffect, useState } from "react";
import type { AlertItem } from "../types/operations";
import { operationsApi } from "../services/api";

export function AlertsPage({ canWrite }: { canWrite: boolean }) {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setAlerts(await operationsApi.alerts({ status, severity }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load alerts");
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(timer);
  }, [status, severity]);

  const update = async (id: number, next: "acknowledged" | "resolved") => {
    try {
      await operationsApi.updateAlert(id, next);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update alert");
    }
  };

  return <>
    <div className="page-heading"><div><span className="eyebrow">Operations / response</span><h1>Alert center</h1><p>Review, acknowledge, and resolve alerts produced by real local detections.</p></div></div>
    <div className="filter-bar">
      <select value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option><option value="new">New</option><option value="acknowledged">Acknowledged</option><option value="resolved">Resolved</option></select>
      <select value={severity} onChange={event => setSeverity(event.target.value)}><option value="">All severities</option><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></select>
      <button onClick={() => void load()}>Refresh</button>
      <span>{alerts.length} alerts</span>
    </div>
    {error && <div className="error-state">{error}</div>}
    <div className="alert-list">
      {alerts.map(alert => <article className={`alert-card ${alert.status}`} key={alert.id}>
        <div><span className="alert-level">{alert.severity} · {alert.kind}</span><h3>{alert.message}</h3><small>{alert.camera_name ?? `Camera ${alert.camera_id ?? "?"}`} · {new Date(alert.created_at).toLocaleString()} · {alert.status}</small></div>
        <div className="alert-actions">
          {alert.status !== "acknowledged" && alert.status !== "resolved" && <button disabled={!canWrite} onClick={() => void update(alert.id, "acknowledged")}>Acknowledge</button>}
          {alert.status !== "resolved" && <button disabled={!canWrite} onClick={() => void update(alert.id, "resolved")}>Resolve</button>}
        </div>
      </article>)}
      {!alerts.length && <div className="empty-state">No alerts match these filters.</div>}
    </div>
  </>;
}
