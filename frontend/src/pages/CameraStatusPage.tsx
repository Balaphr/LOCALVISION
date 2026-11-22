import { useEffect, useState } from "react";
import type { Camera } from "../types/camera";
import { operationsApi } from "../services/api";

export function CameraStatusPage({ cameras }: { cameras: Camera[] }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setData(await operationsApi.performance());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load camera status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const formatBytes = (value: number) => value >= 1073741824 ? `${(value / 1073741824).toFixed(2)} GB` : value >= 1048576 ? `${(value / 1048576).toFixed(1)} MB` : `${Math.round(value / 1024)} KB`;

  return <>
    <div className="page-heading"><div><span className="eyebrow">Operations / camera status</span><h1>Camera status & network</h1><p>Real-time per-camera stream health and server metrics.</p></div><button onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></div>
    {error && <div className="error-state">{error}</div>}
    {data?.totals && <div className="metrics">
      <div><small>Cameras</small><b>{data.totals.cameras}</b><span>{data.totals.online} online</span></div>
      <div><small>Total FPS</small><b>{data.totals.fps}</b><span>across streams</span></div>
      <div><small>Total bitrate</small><b>{data.totals.bitrate_kbps} kbps</b><span>{(data.totals.bitrate_kbps / 1000).toFixed(2)} Mbps</span></div>
      <div><small>System RAM</small><b>{data.system ? formatBytes(data.system.memory_used_bytes) : "—"}</b><span>{data.system ? `${(data.system.memory_used_bytes / data.system.memory_total_bytes * 100).toFixed(1)}% used` : ""}</span></div>
    </div>}
    <div className="live-grid live-grid-auto" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
      {(data?.cameras ?? []).map((item: any) => (
        <article className="live-tile" key={item.camera_id}>
          <div className="live-tile-footer" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
            <div><b>{item.name}</b><small>{item.host} · {item.protocol}</small></div>
            <small>Status: {item.status} {item.message ? `· ${item.message}` : ""}</small>
            <small>FPS: {item.fps ?? "—"} · Resolution: {item.resolution ?? "—"}</small>
            <small>Bitrate: {item.bitrate_kbps ?? "—"} kbps · Speed: {item.speed ?? "—"}x</small>
            <small>Reconnects: {item.restarts ?? 0} · Uptime: {item.uptime_seconds == null ? "—" : `${Math.round(item.uptime_seconds)}s`}</small>
            <small>Last frame: {item.last_frame_at ? new Date(item.last_frame_at).toLocaleTimeString() : "—"}</small>
            <small>Recording: {item.recording ?? "—"} {item.recording_error ? `· ${item.recording_error}` : ""}</small>
          </div>
        </article>
      ))}
    </div>
    {data?.system && <section className="panel" style={{ marginTop: 16 }}>
      <div className="section-title"><h2>Server performance</h2></div>
      <div className="metrics">
        <div><small>CPU cores</small><b>{data.system.cpu_count}</b><span>load: {data.system.load_average?.map((n: number) => n.toFixed(2)).join(", ")}</span></div>
        <div><small>Memory</small><b>{formatBytes(data.system.memory_used_bytes)}</b><span>of {formatBytes(data.system.memory_total_bytes)}</span></div>
        <div><small>Network RX</small><b>{formatBytes(data.system.network_rx_bytes)}</b><span>total received</span></div>
        <div><small>Network TX</small><b>{formatBytes(data.system.network_tx_bytes)}</b><span>total sent</span></div>
        <div><small>Uptime</small><b>{Math.round(data.system.uptime_seconds / 60)}m</b><span>{data.system.platform}</span></div>
      </div>
    </section>}
    {!data && !loading && <div className="empty-state">No camera status data available.</div>}
  </>;
}
