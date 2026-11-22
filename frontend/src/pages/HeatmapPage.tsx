import { useEffect, useState } from "react";
import type { Camera } from "../types/camera";
import { operationsApi } from "../services/api";

const HeatmapGrid = ({ grid }: { grid: number[][] }) => {
  const max = Math.max(1, ...grid.flat());
  return (
    <div className="heatmap-grid" style={{ gridTemplateColumns: `repeat(${grid[0]?.length ?? 16}, 1fr)` }}>
      {grid.map((row, y) => row.map((value, x) => (
        <div key={`${x}-${y}`} className="heatmap-cell" style={{ opacity: 0.12 + (value / max) * 0.88 }} title={`${value}`}>
          {value > 0 ? value : ""}
        </div>
      )))}
    </div>
  );
};

export function HeatmapPage({ cameras }: { cameras: Camera[] }) {
  const [cameraId, setCameraId] = useState("");
  const [period, setPeriod] = useState("day");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setData(await operationsApi.heatmap({ camera_id: cameraId ? Number(cameraId) : undefined, period, date, compare: true }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load heatmap");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [cameraId, period, date]);

  const peakHour = data?.current?.peak_hours ? data.current.peak_hours.indexOf(Math.max(...data.current.peak_hours)) : -1;

  return <>
    <div className="page-heading"><div><span className="eyebrow">Analytics / heatmap</span><h1>AI heatmap analytics</h1><p>Human movement density and activity patterns from AI detections.</p></div><button onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></div>
    <div className="filter-bar">
      <select value={cameraId} onChange={event => setCameraId(event.target.value)}><option value="">All cameras</option>{cameras.map(camera => <option key={camera.id} value={camera.id}>{camera.name}</option>)}</select>
      <select value={period} onChange={event => setPeriod(event.target.value)}><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option></select>
      <input type="date" value={date} onChange={event => setDate(event.target.value)} />
      <span>{data?.current?.total_events ?? 0} person detections</span>
    </div>
    {error && <div className="error-state">{error}</div>}
    {data && <>
      <section className="panel">
        <div className="section-title"><h2>Movement density</h2><span>{data.current.start?.slice(0, 10)} to {data.current.end?.slice(0, 10)}</span></div>
        <HeatmapGrid grid={data.current.grid} />
      </section>
      <div className="metrics">
        <div><small>Peak hour</small><b>{peakHour >= 0 ? `${peakHour}:00` : "—"}</b><span>highest activity</span></div>
        <div><small>Sessions</small><b>{data.current.sessions}</b><span>people detected</span></div>
        <div><small>Avg duration</small><b>{data.current.avg_duration_seconds == null ? "—" : `${Math.round(data.current.avg_duration_seconds)}s`}</b><span>per session</span></div>
        <div><small>Total person-time</small><b>{Math.round((data.current.total_duration_seconds ?? 0) / 60)}m</b><span>minutes in view</span></div>
      </div>
      <section className="panel">
        <div className="section-title"><h2>Peak activity hours</h2></div>
        <div className="health-bars">
          {data.current.peak_hours.map((value: number, hour: number) => (
            <div className="health-bar-row" key={hour}><span>{hour}:00</span><i><b style={{ width: `${Math.min(100, (value / Math.max(1, ...data.current.peak_hours)) * 100)}%` }} /></i><small>{value}</small></div>
          ))}
        </div>
      </section>
      {data.previous && <section className="panel">
        <div className="section-title"><h2>Previous period comparison</h2><span>{data.previous.start?.slice(0, 10)} to {data.previous.end?.slice(0, 10)}</span></div>
        <HeatmapGrid grid={data.previous.grid} />
        <div className="metrics">
          <div><small>Previous detections</small><b>{data.previous.total_events}</b></div>
          <div><small>Previous sessions</small><b>{data.previous.sessions}</b></div>
        </div>
      </section>}
    </>}
  </>;
}
