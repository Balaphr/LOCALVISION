import type { Camera } from "../types/camera";
import { cameraApi } from "../services/api";

interface Props {
  camera: Camera;
  onEdit: (camera: Camera) => void;
  onDelete: (camera: Camera) => void;
  onTest: (camera: Camera) => void;
}

export function CameraCard({ camera, onEdit, onDelete, onTest }: Props) {
  return <article className="camera-card">
    <div className="camera-visual">
      {camera.enabled && <img src={cameraApi.previewUrl(camera.id)} alt={`${camera.name} preview`} loading="lazy" />}
      <span className="live-badge">● {camera.enabled ? "ENABLED" : "DISABLED"}</span>
      <span className="camera-resolution">{camera.main_stream || camera.rtsp_url ? "STREAM CONFIGURED" : "NO STREAM URL"}</span>
    </div>
    <div className="camera-card-body"><div><h3>{camera.name}</h3><p>{camera.location || "No location"}</p></div><span className={`status-dot ${camera.enabled ? "online" : "offline"}`} /></div>
    <div className="camera-tags"><span>{camera.protocol}</span><span>{camera.recording_enabled ? "● Event clips" : "○ Clips off"}</span><span>{camera.ai_enabled ? "✦ AI on" : "AI off"}</span></div>
    <div className="camera-actions"><button onClick={() => onTest(camera)}>Test</button><button onClick={() => onEdit(camera)}>Edit</button><button className="danger" onClick={() => onDelete(camera)}>Delete</button></div>
  </article>;
}
