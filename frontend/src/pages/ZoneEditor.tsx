import { useEffect, useRef, useState } from "react";
import type { Camera } from "../types/camera";
import type { Zone, ZoneInput, ZoneType } from "../types/recording";
import { zoneApi } from "../services/api";

const colors: Record<ZoneType, string> = { detection: "#51d1bd", ignore: "#8b9b9d", restricted: "#ef6b65", line: "#e5a45c" };

interface Props { cameras: Camera[]; canWrite: boolean; }

export function ZoneEditor({ cameras, canWrite }: Props) {
  const [cameraId, setCameraId] = useState(cameras[0]?.id ?? 0);
  const [zones, setZones] = useState<Zone[]>([]);
  const [points, setPoints] = useState<number[][]>([]);
  const [type, setType] = useState<ZoneType>("detection");
  const [name, setName] = useState("New zone");
  const [threshold, setThreshold] = useState(0.5);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canvas = useRef<HTMLDivElement>(null);

  const load = async (id: number) => {
    if (!id) {
      setZones([]);
      return;
    }
    try {
      setZones(await zoneApi.list(id));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load zones");
    }
  };

  useEffect(() => {
    if (!cameras.some(camera => camera.id === cameraId)) setCameraId(cameras[0]?.id ?? 0);
  }, [cameras, cameraId]);

  useEffect(() => { void load(cameraId); }, [cameraId]);

  const addPoint = (event: React.MouseEvent) => {
    if (!canvas.current) return;
    const rect = canvas.current.getBoundingClientRect();
    setPoints(current => [...current, [Number(((event.clientX - rect.left) / rect.width).toFixed(4)), Number(((event.clientY - rect.top) / rect.height).toFixed(4))]]);
  };

  const save = async () => {
    if (!canWrite) {
      setError("Your role has read-only access");
      return;
    }
    if (!cameraId || points.length < (type === "line" ? 2 : 3)) {
      setError(type === "line" ? "Click at least two points to draw a line." : "Click at least three points to draw a zone.");
      return;
    }
    const input: ZoneInput = { name, zone_type: type, points, enabled: true, object_filters: ["person", "car"], confidence_threshold: threshold, direction: type === "line" ? "any" : null };
    try {
      await zoneApi.create(cameraId, input);
      setPoints([]);
      setNotice("Zone saved");
      await load(cameraId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save zone");
    }
  };

  const remove = async (zoneId: number) => {
    if (!canWrite) {
      setError("Your role has read-only access");
      return;
    }
    try {
      await zoneApi.remove(cameraId, zoneId);
      setNotice("Zone removed");
      await load(cameraId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove zone");
    }
  };

  return <>
    <div className="page-heading"><div><span className="eyebrow">AI configuration</span><h1>Zones & lines</h1><p>Draw normalized regions and crossing lines for the local inference worker.</p></div></div>
    {error && <div className="error-state" role="alert">{error}</div>}
    {notice && <div className="notice inline-notice" role="status">{notice}</div>}
    <div className="zone-layout">
      <section className="panel">
        <div className="recording-toolbar">
          <select value={cameraId} onChange={event => setCameraId(Number(event.target.value))}>{cameras.map(camera => <option key={camera.id} value={camera.id}>{camera.name}</option>)}</select>
          <select value={type} onChange={event => { setType(event.target.value as ZoneType); setPoints([]); }}><option value="detection">Detection zone</option><option value="ignore">Ignore zone</option><option value="restricted">Restricted zone</option><option value="line">Line crossing</option></select>
        </div>
        <div ref={canvas} className="zone-canvas" onClick={addPoint}>
          <span>Click to draw → {points.length} point{points.length === 1 ? "" : "s"}</span>
          <svg viewBox="0 0 1 1" preserveAspectRatio="none">
            {zones.map(zone => <polyline key={zone.id} points={zone.points.map(point => point.join(",")).join(" ")} fill={zone.zone_type === "line" ? "none" : `${colors[zone.zone_type]}22`} stroke={colors[zone.zone_type]} strokeWidth=".006" />)}
            {points.length > 1 && <polyline points={points.map(point => point.join(",")).join(" ")} fill="none" stroke={colors[type]} strokeWidth=".008" />}
          </svg>
        </div>
        <div className="zone-form">
          <label>Zone name<input value={name} onChange={event => setName(event.target.value)} /></label>
          <label>Confidence <input type="number" min="0" max="1" step=".05" value={threshold} onChange={event => setThreshold(Number(event.target.value))} /></label>
          <button className="primary" disabled={!canWrite} onClick={() => void save()}>Save {type}</button>
          <button onClick={() => setPoints([])}>Clear</button>
        </div>
      </section>
      <section className="panel">
        <div className="section-title"><h2>Configured</h2><span>{zones.length}</span></div>
        {zones.map(zone => <div className="zone-row" key={zone.id}><i style={{ background: colors[zone.zone_type] }} /><span><b>{zone.name}</b><small>{zone.zone_type} → {Math.round(zone.confidence_threshold * 100)}%</small></span><button disabled={!canWrite} onClick={() => void remove(zone.id)}>Delete</button></div>)}
        {!zones.length && <div className="empty-state">No zones configured for this camera.</div>}
      </section>
    </div>
  </>;
}
