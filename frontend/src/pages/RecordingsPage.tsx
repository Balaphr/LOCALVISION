import { useEffect, useRef, useState } from "react";
import type { Camera } from "../types/camera";
import type { Recording } from "../types/recording";
import { recordingApi } from "../services/api";

export function RecordingsPage({ cameras }: { cameras: Camera[] }) {
  const [items, setItems] = useState<Recording[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [selected, setSelected] = useState<Recording | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [speed, setSpeed] = useState(1);
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

  useEffect(() => { void load(); }, [cameraId, date]);
  useEffect(() => { if (video.current) video.current.playbackRate = speed; }, [speed, selected]);

  return <>
    <div className="page-heading"><div><span className="eyebrow">Evidence browser</span><h1>Recordings</h1><p>Review saved camera segments from configured Ubuntu storage.</p></div></div>
    <div className="recording-toolbar">
      <select value={cameraId} onChange={event => setCameraId(event.target.value)}><option value="">All cameras</option>{cameras.map(camera => <option value={camera.id} key={camera.id}>{camera.name}</option>)}</select>
      <input type="date" value={date} onChange={event => setDate(event.target.value)} />
      <button onClick={() => void load()}>Refresh</button>
    </div>
    {error && <div className="error-state">{error}</div>}
    <div className="recording-layout">
      <section className="panel recording-list">
        <div className="section-title"><h2>Segments</h2><span>{loading ? "Loading…" : `${items.length} found`}</span></div>
        {!loading && !items.length && <div className="empty-state">No recordings for this filter.</div>}
        {items.map(item => <button className={`recording-row ${selected?.id === item.id ? "selected" : ""}`} key={item.id} onClick={() => setSelected(item)}>
          <span className="recording-kind">{item.kind}</span>
          <span><b>{item.camera ?? cameras.find(camera => camera.id === item.camera_id)?.name ?? `Camera ${item.camera_id}`}</b><small>{new Date(item.started_at).toLocaleString()} · {item.duration_seconds ? `${Math.round(item.duration_seconds / 60)} min` : "active"} · {(Number(item.size_bytes || 0) / 1048576).toFixed(1)} MB</small></span>
          <span className="recording-status">{item.status}</span>
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
          <div className="recording-meta"><span>{selected.name ?? selected.filename} · {new Date(selected.started_at).toLocaleString()} · {selected.duration_seconds ? `${Math.round(selected.duration_seconds / 60)} min` : "active"} · {(Number(selected.size_bytes || 0) / 1048576).toFixed(1)} MB · {selected.status}</span>{selected.downloadUrl && <a className="button-link" href={selected.downloadUrl}>Download</a>}</div>
        </> : <div className="empty-state">Select a recording to play.</div>}
      </section>
    </div>
  </>;
}
