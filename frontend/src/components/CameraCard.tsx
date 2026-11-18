import type { Camera } from "../types/camera";

interface Props { camera: Camera; onEdit: (camera: Camera) => void; onDelete: (camera: Camera) => void; onTest: (camera: Camera) => void; }
export function CameraCard({ camera, onEdit, onDelete, onTest }: Props) {
  return <article className="camera-card"><div className="camera-visual"><span className="live-badge">● {camera.enabled ? "ONLINE" : "DISABLED"}</span><span className="camera-resolution">{camera.main_stream ? "STREAM CONFIGURED" : "NO STREAM"}</span><span className="camera-glyph">◉</span></div><div className="camera-card-body"><div><h3>{camera.name}</h3><p>{camera.location || "No location"}</p></div><span className={`status-dot ${camera.enabled ? "online" : "offline"}`} /> </div><div className="camera-tags"><span>{camera.protocol}</span><span>{camera.recording_enabled ? "● Recording" : "○ Recording off"}</span><span>{camera.ai_enabled ? "✦ AI on" : "AI off"}</span></div><div className="camera-actions"><button onClick={() => onTest(camera)}>Test</button><button onClick={() => onEdit(camera)}>Edit</button><button className="danger" onClick={() => onDelete(camera)}>Delete</button></div></article>;
}
