import type { Camera } from "../types/camera";
import { CameraCard } from "../components/CameraCard";
interface Props { cameras: Camera[]; canWrite: boolean; onAdd: () => void; onEdit: (camera: Camera) => void; onDelete: (camera: Camera) => void; }
export function CamerasPage({ cameras, canWrite, onAdd, onEdit, onDelete }: Props) {
  return <>
    <div className="page-heading">
      <div><span className="eyebrow">Camera manager</span><h1>Your cameras</h1><p>Manage RTSP connections without exposing camera credentials.</p></div>
      <button className="primary" disabled={!canWrite} onClick={onAdd}>＋ Add camera</button>
    </div>
    <div className="camera-grid">{cameras.map(camera => <CameraCard key={camera.id} camera={camera} canWrite={canWrite} onEdit={onEdit} onDelete={onDelete} />)}{!cameras.length && <div className="empty-state">No cameras configured yet.<br /><button className="primary" disabled={!canWrite} onClick={onAdd}>Add your first camera</button></div>}</div>
  </>;
}
