import { useEffect, useState } from "react";
import type { Camera } from "../types/camera";
import type { Share } from "../types/auth";
import type { SharingHistoryItem } from "../types/operations";
import { cameraApi, sharingApi } from "../services/api";

export function SharingPage({ canWrite }: { canWrite: boolean }) {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [cameraId, setCameraId] = useState(0);
  const [shares, setShares] = useState<Share[]>([]);
  const [history, setHistory] = useState<SharingHistoryItem[]>([]);
  const [username, setUsername] = useState("");
  const [permission, setPermission] = useState<"viewer" | "operator">("viewer");
  const [notice, setNotice] = useState("");

  const loadShares = async (id: number) => {
    if (!id) return;
    setCameraId(id);
    setShares(await sharingApi.list(id));
  };

  const loadHistory = async () => {
    try { setHistory(await sharingApi.history()); } catch { setHistory([]); }
  };

  useEffect(() => {
    void cameraApi.list().then(result => {
      setCameras(result);
      const first = result[0]?.id ?? 0;
      setSelected(first ? [first] : []);
      if (first) void loadShares(first);
    }).catch(reason => setNotice(reason instanceof Error ? reason.message : "Cameras unavailable"));
    void loadHistory();
  }, []);

  const share = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canWrite) { setNotice("Your role has read-only access"); return; }
    if (!selected.length) { setNotice("Select at least one camera"); return; }
    try {
      for (const id of selected) await sharingApi.create(id, { username, permission });
      setUsername("");
      setNotice(`Camera access shared with ${username} for ${selected.length} camera(s)`);
      await loadShares(cameraId || selected[0]);
      await loadHistory();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Could not share camera");
    }
  };

  const update = async (shareId: number, next: "viewer" | "operator") => {
    try {
      await sharingApi.update(cameraId, shareId, next);
      await loadShares(cameraId);
      await loadHistory();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Could not update permission");
    }
  };

  const revoke = async (shareId: number) => {
    try {
      await sharingApi.remove(cameraId, shareId);
      await loadShares(cameraId);
      await loadHistory();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Could not revoke access");
    }
  };

  return <>
    <div className="page-heading"><div><span className="eyebrow">Access control / camera sharing</span><h1>Sharing & permissions</h1><p>Grant explicit viewer or operator access to selected cameras. Passwords are never involved.</p></div></div>
    {notice && <div className="notice inline-notice" role="status">{notice}</div>}
    <section className="settings-panel">
      <div className="section-title"><h2>Share cameras</h2><span>{cameras.length} available</span></div>
      <form className="sharing-form" onSubmit={share}>
        <div className="camera-checks">
          {cameras.map(camera => <label key={camera.id}><input type="checkbox" checked={selected.includes(camera.id)} onChange={event => setSelected(current => event.target.checked ? [...current, camera.id] : current.filter(id => id !== camera.id))} />{camera.name}</label>)}
          {!cameras.length && <span>No cameras are visible to your account.</span>}
        </div>
        <input value={username} onChange={event => setUsername(event.target.value)} placeholder="Existing username" required />
        <select value={permission} onChange={event => setPermission(event.target.value as "viewer" | "operator")}><option value="viewer">Viewer</option><option value="operator">Operator</option></select>
        <button className="primary" disabled={!canWrite}>Share access</button>
      </form>
    </section>
    <section className="settings-panel">
      <div className="section-title"><h2>Shared users</h2><select value={cameraId} onChange={event => void loadShares(Number(event.target.value))}>{cameras.map(camera => <option key={camera.id} value={camera.id}>{camera.name}</option>)}</select></div>
      {shares.map(item => <div className="setting-row" key={item.id}>
        <span><b>{item.username}</b><small>{item.role} account · {item.permission} camera permission</small></span>
        <select value={item.permission} disabled={!canWrite} onChange={event => void update(item.id, event.target.value as "viewer" | "operator")}><option value="viewer">Viewer</option><option value="operator">Operator</option></select>
        <button className="danger-button" disabled={!canWrite} onClick={() => void revoke(item.id)}>Revoke</button>
      </div>)}
      {!shares.length && <div className="empty-state">No sharing records for this camera.</div>}
    </section>
    <section className="settings-panel">
      <div className="section-title"><h2>Sharing history</h2><span>{history.length} actions</span></div>
      {history.map(item => <div className="setting-row" key={item.id}><span><b>{item.action}</b><small>{item.username ?? "system"} · {item.target} · {new Date(item.created_at).toLocaleString()}</small></span></div>)}
      {!history.length && <div className="empty-state">No sharing actions recorded.</div>}
    </section>
  </>;
}
