import { useEffect, useState } from "react";
import type { AlertItem } from "../types/operations";
import { operationsApi } from "../services/api";

export function AlertsPage({ canWrite }: { canWrite: boolean }) {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setAlerts(await operationsApi.alerts());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load alerts");
    }
  };

  useEffect(() => { void load(); }, []);

  const acknowledge = async (id: number) => {
    try {
      await operationsApi.acknowledgeAlert(id);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not acknowledge alert");
    }
  };

  return <>
    <div className="page-heading"><div><span className="eyebrow">Operations / response</span><h1>Alert center</h1><p>Detect, review, and acknowledge local AI alerts.</p></div></div>
    {error && <div className="error-state">{error}</div>}
    <div className="alert-list">
      {alerts.map(alert => <article className={`alert-card ${alert.status}`} key={alert.id}>
        <div><span className="alert-level">{alert.kind}</span><h3>{alert.message}</h3><small>{new Date(alert.created_at).toLocaleString()} · {alert.status}</small></div>
        {alert.status === "open" && <button disabled={!canWrite} onClick={() => void acknowledge(alert.id)}>Acknowledge</button>}
      </article>)}
      {!alerts.length && <div className="empty-state">No alerts are available from the API.</div>}
    </div>
  </>;
}
