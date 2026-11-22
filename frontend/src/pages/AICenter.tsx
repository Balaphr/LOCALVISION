import { useEffect, useMemo, useState } from "react";
import type { Camera } from "../types/camera";
import type { EventItem } from "../types/operations";
import { operationsApi } from "../services/api";

export function AICenter({ cameras }: { cameras: Camera[] }) {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = () => operationsApi.events({ page_size: 100 })
      .then(result => { if (active) setEvents(result.items); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Could not load AI events"); })
      .finally(() => { if (active) setLoading(false); });
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const filtered = useMemo(() => events.filter(event => !filter || `${event.object_name ?? ""} ${event.kind} ${event.description ?? ""}`.toLowerCase().includes(filter.toLowerCase())), [events, filter]);

  return <>
    <div className="page-heading"><div><span className="eyebrow">Intelligence / explainability</span><h1>AI Center</h1><p>Every result shown here is sourced from the local detection event stream.</p></div></div>
    <div className="filter-bar"><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Search object, event, or description" /><span>{events.length} total events</span></div>
    {error && <div className="error-state">{error}</div>}
    {loading ? <div className="loading-state">Loading local detections…</div> : <div className="table-wrap"><table><thead><tr><th>Detection</th><th>Camera</th><th>Confidence</th><th>Time</th><th>Evidence</th></tr></thead><tbody>{filtered.map(event => <tr key={event.id}><td><strong>{event.object_name ?? event.kind}</strong><br /><small>{event.description ?? event.kind}</small></td><td>{event.camera_name ?? cameras.find(camera => camera.id === event.camera_id)?.name ?? `Camera ${event.camera_id ?? "unknown"}`}</td><td>{event.confidence == null ? "—" : `${Math.round(event.confidence * 100)}%`}</td><td>{new Date(event.occurred_at).toLocaleString()}</td><td>{event.snapshot_url ? <a href={event.snapshot_url} target="_blank" rel="noreferrer">Snapshot</a> : "No snapshot"}</td></tr>)}{!filtered.length && <tr><td colSpan={5}><div className="empty-state">No local detections match this filter.</div></td></tr>}</tbody></table></div>}
  </>;
}
