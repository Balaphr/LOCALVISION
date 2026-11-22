import { useEffect, useState } from "react";
import type { Camera } from "../types/camera";
import type { EventItem } from "../types/operations";
import { operationsApi } from "../services/api";

export function EventsPage({ cameras }: { cameras: Camera[] }) {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [query, setQuery] = useState("");
  const [cameraId, setCameraId] = useState("");
  const [objectName, setObjectName] = useState("");
  const [start, setStart] = useState("");
  const [confidence, setConfidence] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
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

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [query, cameraId, objectName, start, confidence]);

  return <>
    <div className="page-heading"><div><span className="eyebrow">Operations / events</span><h1>Event center</h1><p>Search real local detections by camera, object, time, description, and confidence.</p></div><button onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></div>
    <form className="filter-bar" onSubmit={event => { event.preventDefault(); void load(); }}>
      <input placeholder="Search descriptions" value={query} onChange={event => setQuery(event.target.value)} />
      <select value={cameraId} onChange={event => setCameraId(event.target.value)}><option value="">All cameras</option>{cameras.map(camera => <option key={camera.id} value={camera.id}>{camera.name}</option>)}</select>
      <select value={objectName} onChange={event => setObjectName(event.target.value)}><option value="">All objects</option><option value="person">Person</option><option value="vehicle">Vehicle</option></select>
      <input type="datetime-local" value={start} onChange={event => setStart(event.target.value)} />
      <select value={confidence} onChange={event => setConfidence(event.target.value)}><option value="">Any confidence</option><option value="50">50%+</option><option value="75">75%+</option><option value="90">90%+</option></select>
      <button className="primary" disabled={loading}>{loading ? "Searching…" : "Search"}</button>
      <span>{events.length} results</span>
    </form>
    {error && <div className="error-state">{error}</div>}
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
  </>;
}
