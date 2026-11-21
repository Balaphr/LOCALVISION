import type { Camera } from "../types/camera";

interface Props {
  camera: Camera;
  canWrite: boolean;
  onEdit: (camera: Camera) => void;
  onDelete: (camera: Camera) => void;
}

export function CameraCard({ camera, canWrite, onEdit, onDelete }: Props) {
  return <article className="camera-card">
    <div className="camera-visual">
      <span className="live-badge">● {camera.enabled ? "ENABLED" : "DISABLED"}</span>
      <span className="camera-resolution">{camera.main_stream || camera.rtsp_url ? "STREAM CONFIGURED" : "NO STREAM URL"}</span>
    </div>
    <div className="camera-card-body"><div><h3>{camera.name}</h3><p>{camera.location || "No location"}</p></div><span className={`status-dot ${camera.enabled ? "online" : "offline"}`} /></div>
    <div className="camera-tags"><span>{camera.protocol}</span><span>{camera.recording_enabled ? "● Event clips" : "○ Clips off"}</span><span>{camera.ai_enabled ? "✦ AI on" : "AI off"}</span></div>
    <div className="camera-actions"><button disabled={!canWrite} onClick={() => onEdit(camera)}>Edit</button><button className="danger" disabled={!canWrite} onClick={() => onDelete(camera)}>Delete</button></div>
  </article>;
}
