import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Camera, CameraStatus } from "../types/camera";
import type { RealtimeMessage } from "../hooks/useRealtime";
import { HlsPlayer } from "../components/HlsPlayer";
import { cameraApi } from "../services/api";

const layouts = [1, 2, 4, 6, 9, 16];

interface Props {
  cameras: Camera[];
  detections: RealtimeMessage[];
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface RecordingState {
  status: string;
  desired: boolean;
  last_error?: string | null;
  last_recording_at?: string | null;
}

const boxStyle = (message: RealtimeMessage): Box | null => {
  const value = message.bounding_box;
  if (!value || typeof value !== "object") return null;
  const box = value as Record<string, unknown>;
  const x = Number(box.x);
  const y = Number(box.y);
  const width = Number(box.width);
  const height = Number(box.height);
  const frameWidth = Number(message.width) || 0;
  const frameHeight = Number(message.height) || 0;
  if (!frameWidth || !frameHeight || [x, y, width, height].some(number => !Number.isFinite(number))) return null;
  return { left: x / frameWidth * 100, top: y / frameHeight * 100, width: width / frameWidth * 100, height: height / frameHeight * 100 };
};

const streamLabel = (status?: CameraStatus) => {
  const value = String(status?.status ?? "").toLowerCase();
  if (value === "online" || value === "recording") return "LIVE";
  if (value === "reconnecting" || value === "starting") return value.toUpperCase();
  if (value === "offline" || value === "error") return "OFFLINE";
  return "CONNECTING";
};

export function LivePage({ cameras, detections }: Props) {
  const [layout, setLayout] = useState(4);
  const [selected, setSelected] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [notice, setNotice] = useState("");
  const [statuses, setStatuses] = useState<Record<number, CameraStatus>>({});
  const [recordings, setRecordings] = useState<Record<number, RecordingState>>({});
  const [busy, setBusy] = useState<Record<number, boolean>>({});
  const timer = useRef<number | null>(null);
  const visible = useMemo(() => cameras.slice(0, layout), [cameras, layout]);

  const refresh = useCallback(async () => {
    const entries = await Promise.all(cameras.filter(camera => camera.enabled).map(async camera => {
      const [status, recording] = await Promise.all([
        cameraApi.status(camera.id).catch(() => null),
        cameraApi.recordStatus(camera.id).catch(() => null)
      ]);
      return { id: camera.id, status, recording };
    }));
    const statusMap: Record<number, CameraStatus> = {};
    const recordingMap: Record<number, RecordingState> = {};
    for (const entry of entries) {
      if (entry.status) statusMap[entry.id] = entry.status;
      recordingMap[entry.id] = {
        status: entry.recording?.status ?? "unknown",
        desired: entry.recording?.desired ?? false,
        last_error: entry.recording?.last_error ?? null,
        last_recording_at: entry.recording?.last_recording_at ?? null
      };
    }
    setStatuses(previous => ({ ...previous, ...statusMap }));
    setRecordings(previous => ({ ...previous, ...recordingMap }));
  }, [cameras]);

  useEffect(() => {
    if (!selected && cameras[0]) setSelected(cameras[0].id);
  }, [cameras, selected]);

  useEffect(() => {
    void refresh();
    timer.current = window.setInterval(() => void refresh(), 5000);
    return () => {
      if (timer.current !== null) window.clearInterval(timer.current);
    };
  }, [refresh]);

  const controlRecording = async (id: number, start: boolean) => {
    setBusy(previous => ({ ...previous, [id]: true }));
    setNotice("");
    try {
      const result = start ? await cameraApi.recordStart(id) : await cameraApi.recordStop(id);
      setNotice(result.message ?? (start ? "Recording started" : "Recording stopped"));
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Recording control failed");
    } finally {
      setBusy(previous => ({ ...previous, [id]: false }));
    }
  };

  const snapshot = async (id: number) => {
    try {
      await cameraApi.snapshot(id);
      setNotice("Snapshot saved");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Snapshot unavailable");
    }
  };

  return <>
    <div className="page-heading">
      <div><span className="eyebrow">Operations / live</span><h1>Live view</h1><p>Real RTSP camera streams with recording controls.</p></div>
      <div className="layout-picker" aria-label="Camera grid layout">{layouts.map(size => <button className={layout === size ? "active" : ""} key={size} onClick={() => setLayout(size)}>{size}</button>)}</div>
    </div>
    {notice && <div className="notice inline-notice" onClick={() => setNotice("")}>{notice}</div>}
    <div className="live-toolbar">
      <span><i className="status-dot" /> {cameras.filter(camera => camera.enabled).length} enabled</span>
      <span>{detections.length} recent AI detections</span>
      <label>Zoom <input type="range" min={1} max={2} step={0.1} value={zoom} onChange={event => setZoom(Number(event.target.value))} /></label>
    </div>
    <div className={`live-grid live-grid-${layout}`}>
      {visible.map(camera => {
        const cameraDetections = detections.filter(message => message.camera_id === camera.id);
        const status = statuses[camera.id];
        const recording = recordings[camera.id];
        const recordingActive = recording?.status === "recording";
        const statusText = status?.message || status?.status || "Connecting";
        return <article className={`live-tile ${selected === camera.id ? "selected" : ""}`} key={camera.id} onClick={() => setSelected(camera.id)}>
          <div className="live-canvas" style={{ transform: `scale(${zoom})` }}>
            {camera.enabled ? <HlsPlayer src={cameraApi.streamUrl(camera.id)} className="live-stream" /> : <div className="live-offline">Camera disabled</div>}
            <span className={`live-badge ${streamLabel(status) === "LIVE" ? "" : "degraded"}`}>● {streamLabel(status)}</span>
            <span className="live-spec">{camera.protocol} · {camera.location || camera.host}{statusText ? ` · ${statusText}` : ""}</span>
            {cameraDetections.map((message, index) => {
              const box = boxStyle(message);
              if (!box) return null;
              return <div className="detection-box" key={`${String(message.event_id)}-${index}`} style={box}><span>{String(message.description ?? "Person detected")} · {Math.round(Number(message.confidence ?? 0) * 100)}%</span></div>;
            })}
          </div>
          <div className="live-tile-footer">
            <div><b>{camera.name}</b><small>{recording?.last_error ? `Recording error: ${recording.last_error}` : recordingActive ? `Recording · ${recording.last_recording_at ? new Date(recording.last_recording_at).toLocaleTimeString() : "active"}` : cameraDetections[0] ? String(cameraDetections[0].description) : "No recent detections"}</small></div>
            <div className="live-actions">
              <button disabled={busy[camera.id] || !camera.enabled} onClick={event => { event.stopPropagation(); void controlRecording(camera.id, !recordingActive); }}>{busy[camera.id] ? "…" : recordingActive ? "Stop" : "Record"}</button>
              <button onClick={event => { event.stopPropagation(); void snapshot(camera.id); }}>Snapshot</button>
            </div>
          </div>
        </article>;
      })}
      {!cameras.length && <div className="empty-state">Add a camera to start live monitoring.</div>}
    </div>
  </>;
}
