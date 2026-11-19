import { useEffect, useMemo, useState } from "react";
import type { Camera } from "../types/camera";
import type { RealtimeMessage } from "../hooks/useRealtime";
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

export function LivePage({ cameras, detections }: Props) {
  const [layout, setLayout] = useState(4);
  const [selected, setSelected] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [notice, setNotice] = useState("");
  const visible = useMemo(() => cameras.slice(0, layout), [cameras, layout]);

  useEffect(() => {
    if (!selected && cameras[0]) setSelected(cameras[0].id);
  }, [cameras, selected]);

  const snapshot = async (id: number) => {
    try {
      const result = await cameraApi.snapshot(id);
      setNotice(result.status === "ready" ? "Snapshot saved to storage" : result.message ?? "Snapshot unavailable");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Snapshot unavailable");
    }
  };

  return <>
    <div className="page-heading">
      <div><span className="eyebrow">Operations / live</span><h1>Live view</h1><p>Real camera streams with local AI detection overlays.</p></div>
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
        return <article className={`live-tile ${selected === camera.id ? "selected" : ""}`} key={camera.id} onClick={() => setSelected(camera.id)}>
          <div className="live-canvas" style={{ transform: `scale(${zoom})` }}>
            {camera.enabled ? <img className="live-stream" src={cameraApi.streamUrl(camera.id)} alt={`${camera.name} live stream`} /> : <div className="live-offline">Camera disabled</div>}
            <span className="live-badge">● {camera.enabled ? "LIVE" : "OFFLINE"}</span>
            <span className="live-spec">{camera.protocol} · {camera.location || camera.host}</span>
            {cameraDetections.map((message, index) => {
              const box = boxStyle(message);
              if (!box) return null;
              return <div className="detection-box" key={`${String(message.event_id)}-${index}`} style={box}><span>{String(message.description ?? "Person detected")} · {Math.round(Number(message.confidence ?? 0) * 100)}%</span></div>;
            })}
          </div>
          <div className="live-tile-footer"><div><b>{camera.name}</b><small>{cameraDetections[0] ? String(cameraDetections[0].description) : "No recent detections"}</small></div><button onClick={event => { event.stopPropagation(); void snapshot(camera.id); }}>Snapshot</button></div>
        </article>;
      })}
      {!cameras.length && <div className="empty-state">Add a camera to start live monitoring.</div>}
    </div>
  </>;
}
