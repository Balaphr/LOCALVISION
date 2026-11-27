import { useEffect, useRef, useState } from "react";
import type { Camera } from "../types/camera";
import type { Recording } from "../types/recording";
import { recordingApi } from "../services/api";

const statusTone = (status: string) => {
  const value = status.toLowerCase();
  if (["ready", "completed", "complete", "saved", "available", "success"].includes(value)) return "ready";
  if (["active", "recording", "in_progress", "in-progress", "running"].includes(value)) return "active";
  if (["failed", "error", "missing", "warning", "offline", "invalid"].includes(value)) return "attention";
  return "other";
};

const statusGroups = [
  { key: "ready", label: "Ready" },
  { key: "active", label: "Active" },
  { key: "attention", label: "Needs attention" },
  { key: "other", label: "Other" }
] as const;

export function RecordingsPage({ cameras }: { cameras: Camera[] }) {
  const [items, setItems] = useState<Recording[]>([]);
  const [dates, setDates] = useState<{ date: string; count: number }[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [selected, setSelected] = useState<Recording | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [speed, setSpeed] = useState(1);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<{ reviews: any[]; audit: any[] } | null>(null);
  const video = useRef<HTMLVideoElement>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await recordingApi.list({ camera_id: cameraId ? Number(cameraId) : undefined, date });
      setItems(result.items);
      setSelected(current => current && result.items.some(item => item.id === current.id) ? current : result.items[0] ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load recordings");
    } finally {
      setLoading(false);
    }
  };

  const loadDates = async () => {
    try {
      const result = await recordingApi.dates(cameraId ? Number(cameraId) : undefined);
      setDates(result.items);
      if (result.items.length && !result.items.some(entry => entry.date === date)) setDate(result.items[0].date);
    } catch {
      setDates([]);
    }
  };

  const removeSelected = async () => {
    if (!selected) return;
    if (!window.confirm("Delete this recording permanently?")) return;
    try {
      await recordingApi.remove(selected.id);
      setSelected(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete recording");
    }
  };

  const reviewSelected = async (status: "reviewed" | "flagged" | "unreviewed", notes = "") => {
    if (!selected) return;
    setReviewBusy(true);
    setError("");
    try {
      const updated = await recordingApi.review(selected.id, { status, notes });
      setSelected(updated);
      setItems(current => current.map(item => item.id === updated.id ? updated : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save review");
    } finally {
      setReviewBusy(false);
    }
  };

  const openHistory = async () => {
    if (!selected) return;
    try {
      const data = await recordingApi.history(selected.id);
      setHistory(data);
      setHistoryOpen(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load history");
    }
  };

  useEffect(() => { void load(); }, [cameraId, date]);
  useEffect(() => { void loadDates(); }, [cameraId]);
  useEffect(() => { if (video.current) video.current.playbackRate = speed; }, [speed, selected]);

  const statusCounts = items.reduce<Record<string, number>>((counts, item) => {
    const status = item.status || "unknown";
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
  const statusEntries = Object.entries(statusCounts).sort(([left], [right]) => left.localeCompare(right));
  const groupedStatuses = statusGroups.map(group => ({ ...group, count: items.filter(item => statusTone(item.status || "unknown") === group.key).length }));
  const cameraCount = new Set(items.map(item => item.camera_id)).size;

  return <>
    <div className="page-heading"><div><span className="eyebrow">Evidence browser</span><h1>Recordings</h1><p>Review saved camera segments from configured Ubuntu storage.</p></div></div>
    <div className="recording-toolbar">
      <select value={cameraId} onChange={event => setCameraId(event.target.value)}><option value="">All cameras</option>{cameras.map(camera => <option value={camera.id} key={camera.id}>{camera.name}</option>)}</select>
      <input type="date" value={date} onChange={event => setDate(event.target.value)} />
      <button onClick={() => void load()}>Refresh</button>
    </div>
    {dates.length > 0 && <div className="recording-dates" aria-label="Recording dates">
      {dates.map(entry => <button key={entry.date} type="button" className={`recording-date-chip ${date === entry.date ? "active" : ""}`} onClick={() => setDate(entry.date)}>
        <b>{entry.date}</b><small>{entry.count} file{entry.count === 1 ? "" : "s"}</small>
      </button>)}
    </div>}
    <section className="recording-status-bar" aria-label="Recording status summary">
      <div className="recording-status-head"><span>Recording status</span><b>{items.length} total · {cameraCount} camera{cameraCount === 1 ? "" : "s"}</b></div>
      <div className="recording-status-track">
        {groupedStatuses.filter(group => group.count > 0).map(group => <i key={group.key} className={group.key} style={{ width: `${group.count / items.length * 100}%` }} title={`${group.label}: ${group.count}`} />)}
        {!items.length && <i className="empty" />}
      </div>
      <div className="recording-status-footer">
        <div className="recording-status-legend">{groupedStatuses.map(group => <span key={group.key} className={group.key}><i />{group.label} {group.count}</span>)}</div>
        <div className="recording-status-tags">{statusEntries.length ? statusEntries.map(([status, count]) => <span key={status} className={statusTone(status)}>{status}: {count}</span>) : <span>no status data</span>}</div>
      </div>
    </section>
    {error && <div className="error-state">{error}</div>}
    <div className="recording-layout">
      <section className="panel recording-list">
        <div className="section-title"><h2>Segments</h2><span>{loading ? "Loading…" : `${items.length} found`}</span></div>
        {!loading && !items.length && <div className="empty-state">No recordings for this filter.</div>}
        {items.map(item => <button className={`recording-row ${selected?.id === item.id ? "selected" : ""}`} key={item.id} onClick={() => setSelected(item)}>
          <span className="recording-kind">{item.kind}</span>
          <span><b>{item.camera ?? cameras.find(camera => camera.id === item.camera_id)?.name ?? `Camera ${item.camera_id}`}</b><small>{new Date(item.started_at).toLocaleString()} · {item.duration_seconds ? `${Math.round(item.duration_seconds / 60)} min` : "active"} · {(Number(item.size_bytes || 0) / 1048576).toFixed(1)} MB</small></span>
          <span className="recording-status">{item.status}{item.review_status && item.review_status !== "unreviewed" ? ` · ${item.review_status}` : ""}</span>
        </button>)}
      </section>
      <section className="panel player-panel">
        {selected ? <>
          {selected.fileUrl ? <video ref={video} controls preload="metadata" src={selected.fileUrl} onError={() => setError("The recording file is not available on configured storage.")} /> : <div className="error-state">This recording has no stored file.</div>}
          <div className="player-controls">
            <button onClick={() => video.current?.paused ? void video.current?.play() : video.current?.pause()}>Play / pause</button>
            <input aria-label="Seek recording" type="range" min={0} max={selected.duration_seconds ?? 600} defaultValue={0} onChange={event => { if (video.current) video.current.currentTime = Number(event.target.value); }} />
            <select value={speed} onChange={event => setSpeed(Number(event.target.value))}><option value={0.5}>0.5x</option><option value={1}>1x</option><option value={2}>2x</option><option value={4}>4x</option></select>
          </div>
          <div className="recording-meta"><span>{selected.name ?? selected.filename} · {new Date(selected.started_at).toLocaleString()} · {selected.duration_seconds ? `${Math.round(selected.duration_seconds / 60)} min` : "active"} · {(Number(selected.size_bytes || 0) / 1048576).toFixed(1)} MB · {selected.status} · review: {selected.review_status ?? "unreviewed"}</span>{selected.downloadUrl && <a className="button-link" href={selected.downloadUrl}>Download</a>}</div>
          <div className="player-controls">
            <button disabled={reviewBusy} onClick={() => void reviewSelected("reviewed")}>Mark reviewed</button>
            <button disabled={reviewBusy} onClick={() => void reviewSelected("flagged")}>Flag</button>
            <button disabled={reviewBusy} onClick={() => void reviewSelected("unreviewed")}>Reset review</button>
            <button onClick={() => void openHistory()}>History</button>
            <button onClick={() => void removeSelected()}>Delete</button>
          </div>
        </> : <div className="empty-state">Select a recording to play.</div>}
      </section>
    </div>
    {historyOpen && <div className="modal-backdrop"><div className="camera-form"><div className="form-heading"><div><span className="eyebrow">Recording history</span><h2>{selected?.name ?? "Recording"}</h2></div><button type="button" className="close-button" onClick={() => setHistoryOpen(false)}>×</button></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>When</th><th>Status</th><th>By</th><th>Notes</th></tr></thead><tbody>{(history?.reviews ?? []).map((row: any) => <tr key={row.id}><td>{row.created_at}</td><td>{row.review_status}</td><td>{row.reviewed_by ?? "—"}</td><td>{row.notes ?? "—"}</td></tr>)}{!(history?.reviews?.length) && <tr><td colSpan={4}>No review history.</td></tr>}</tbody></table></div><div className="form-actions"><button type="button" onClick={() => setHistoryOpen(false)}>Close</button></div></div></div>}
  </>;
}
