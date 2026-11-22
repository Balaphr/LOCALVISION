import { useEffect, useState } from "react";
import type { Camera } from "../types/camera";
import type { EventItem, PersonSession } from "../types/operations";
import { operationsApi } from "../services/api";

export function EventsPage({ cameras }: { cameras: Camera[] }) {
  const [view, setView] = useState<"sessions" | "detections">("sessions");
  const [sessions, setSessions] = useState<PersonSession[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [query, setQuery] = useState("");
  const [cameraId, setCameraId] = useState("");
  const [objectName, setObjectName] = useState("");
  const [start, setStart] = useState("");
  const [confidence, setConfidence] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const loadSessions = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await operationsApi.personSessions({
        search: query,
        camera_id: cameraId ? Number(cameraId) : undefined,
        start: start ? new Date(start).toISOString() : undefined,
        page_size: 100
      });
      setSessions(result.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load activity sessions");
    } finally {
      setLoading(false);
    }
  };

  const loadEvents = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await operationsApi.events({
        search: query,
        camera_id: cameraId ? Number(cameraId) : undefined,
        object_name: objectName,
        start: start ? new Date(start).toISOString() : undefined,
        min_confidence: confidence ? Number(confidence) / 100 : undefined,
        page_size: 100
      });
      setEvents(result.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load events");
    } finally {
      setLoading(false);
    }
  };

  const load = async () => { if (view === "sessions") await loadSessions(); else await loadEvents(); };

  useEffect(() => { void load(); }, [view, query, cameraId, objectName, start, confidence]);

  const formatDuration = (seconds?: number | null) => {
    if (seconds == null) return "active";
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return mins > 0 ? `${mins} min ${secs}s` : `${secs}s`;
  };

  return <>
    <div className="page-heading"><div><span className="eyebrow">Operations / events</span><h1>Event center</h1><p>Real human activity sessions sourced from AI detection.</p></div><button onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></div>
    <div className="filter-bar">
      <button type="button" className={view === "sessions" ? "primary" : ""} onClick={() => setView("sessions")}>Activity sessions</button>
      <button type="button" className={view === "detections" ? "primary" : ""} onClick={() => setView("detections")}>Raw detections</button>
      <input placeholder="Search" value={query} onChange={event => setQuery(event.target.value)} />
      <select value={cameraId} onChange={event => setCameraId(event.target.value)}><option value="">All cameras</option>{cameras.map(camera => <option key={camera.id} value={camera.id}>{camera.name}</option>)}</select>
      {view === "detections" && <select value={objectName} onChange={event => setObjectName(event.target.value)}><option value="">All objects</option><option value="person">Person</option><option value="vehicle">Vehicle</option></select>}
      <input type="datetime-local" value={start} onChange={event => setStart(event.target.value)} />
      {view === "detections" && <select value={confidence} onChange={event => setConfidence(event.target.value)}><option value="">Any confidence</option><option value="50">50%+</option><option value="75">75%+</option><option value="90">90%+</option></select>}
      <span>{view === "sessions" ? sessions.length : events.length} results</span>
    </div>
    {error && <div className="error-state">{error}</div>}
    {view === "sessions" ? (
      <div className="event-list">
        {sessions.map(session => <article className="event-card" key={session.id}>
          <div className="event-severity"><i />{session.status === "active" ? "Active" : "Completed"}</div>
          <div className="event-main">
            <h3>{session.camera_name ?? cameras.find(camera => camera.id === session.camera_id)?.name ?? `Camera ${session.camera_id ?? "?"}`} – Human Detected</h3>
            <p>Entry: {new Date(session.entry_at).toLocaleString()} · {session.exit_at ? `Exit: ${new Date(session.exit_at).toLocaleString()}` : "Still in view"}</p>
            <small>Duration: {formatDuration(session.duration_seconds ?? (session.status === "active" ? (Date.now() - new Date(session.entry_at).getTime()) / 1000 : null))} · {session.activity ?? "Person detected in monitored area"}</small>
          </div>
          <div className="event-evidence">
            {session.snapshot_url && <><img src={session.snapshot_url} alt="Detection snapshot" /><a href={session.snapshot_url} target="_blank" rel="noreferrer">View snapshot</a></>}
            {!session.snapshot_url && <span>No media attached</span>}
          </div>
        </article>)}
        {!sessions.length && <div className="empty-state">No human activity sessions match these filters.</div>}
      </div>
    ) : (
      <div className="event-list">
        {events.map(event => <article className="event-card" key={event.id}>
          <div className="event-severity"><i />{(event.confidence ?? 0) >= 0.85 ? "High confidence" : "Detection"}</div>
          <div className="event-main">
            <h3>{event.description ?? event.object_name ?? event.kind}</h3>
            <p>{event.camera_name ?? cameras.find(camera => camera.id === event.camera_id)?.name ?? `Camera ${event.camera_id ?? "?"}`} · {new Date(event.occurred_at).toLocaleString()}</p>
            <small>{event.object_name ?? "object"} · {event.confidence == null ? "No confidence value" : `Confidence ${Math.round(event.confidence * 100)}%`}{event.track_id ? ` · Track ${event.track_id}` : ""}</small>
          </div>
          <div className="event-evidence">
            {event.snapshot_url && <><img src={event.snapshot_url} alt="Detection snapshot" /><a href={event.snapshot_url} target="_blank" rel="noreferrer">View snapshot</a></>}
            {!event.snapshot_url && <span>No media attached</span>}
          </div>
        </article>)}
        {!events.length && <div className="empty-state">No events match these filters.</div>}
      </div>
    )}
  </>;
}
