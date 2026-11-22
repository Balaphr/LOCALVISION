import { useEffect, useState } from "react";
import type { Camera } from "../types/camera";
import type { AiModel, AiSettings, AiStatus, AlertItem, Metrics } from "../types/operations";
import { monitoringApi, operationsApi } from "../services/api";
import { AICenter } from "./AICenter";
import { ZoneEditor } from "./ZoneEditor";

type HubSection = "overview" | "detection" | "rules" | "models" | "bot" | "voice" | "performance";
const sections: Array<[HubSection, string]> = [["overview", "Overview"], ["detection", "Live detection"], ["rules", "Rules & zones"], ["models", "Models"], ["bot", "AI Bot"], ["voice", "Voice"], ["performance", "Performance"]];

const defaultSettings: AiSettings = {
  detection_confidence: 0.55,
  motion_threshold: 12,
  frame_interval_ms: 10000,
  max_objects: 5,
  surveillance_enabled: true,
  alert_severity: "warning",
  notify_webhooks: true,
  voice_enabled: true,
  person_only: false
};

function VoicePanel({ settings, alerts, canWrite, onSave }: { settings: AiSettings; alerts: AlertItem[]; canWrite: boolean; onSave: (settings: Partial<AiSettings>) => Promise<void> }) {
  const [language, setLanguage] = useState("en-US");
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [notice, setNotice] = useState("");

  const announceLatest = () => {
    if (!("speechSynthesis" in window)) { setNotice("Browser speech synthesis is unavailable"); return; }
    if (!alerts.length) { setNotice("No real alerts are available to announce"); return; }
    const alert = alerts[0];
    const utterance = new SpeechSynthesisUtterance(`${alert.severity} alert from ${alert.camera_name ?? `camera ${alert.camera_id}`}: ${alert.message}`);
    utterance.lang = language;
    utterance.rate = rate;
    utterance.volume = volume;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setNotice("Announcing the latest real alert");
  };

  const requestMic = async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setNotice("Microphone API unavailable"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      setNotice("Microphone permission granted");
    } catch {
      setNotice("Microphone permission denied");
    }
  };

  return <div className="settings-grid">
    <div className="setting-card"><div><b>Voice announcements</b><small>Speak real alerts using browser speech synthesis.</small></div><input type="checkbox" checked={settings.voice_enabled} disabled={!canWrite} onChange={event => void onSave({ voice_enabled: event.target.checked })} /></div>
    <div className="setting-card"><div><b>Latest alert</b><small>{alerts[0]?.message ?? "No alerts available"}</small></div><button onClick={announceLatest}>Announce</button></div>
    <div className="setting-card"><label>Language<select value={language} onChange={event => setLanguage(event.target.value)}><option>en-US</option><option>en-GB</option><option>de-DE</option><option>fr-FR</option></select></label></div>
    <div className="setting-card"><label>Speed<input type="range" min=".5" max="2" step=".1" value={rate} onChange={event => setRate(Number(event.target.value))} /></label></div>
    <div className="setting-card"><label>Volume<input type="range" min="0" max="1" step=".1" value={volume} onChange={event => setVolume(Number(event.target.value))} /></label></div>
    <div className="setting-card"><div><b>Microphone</b><small>Optional permission check for future local speech-to-text.</small></div><button onClick={() => void requestMic()}>Request permission</button></div>
    {notice && <div className="notice inline-notice">{notice}</div>}
  </div>;
}

function BotPanel({ aiState }: { aiState: AiStatus | null }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const ask = async (value = question) => {
    if (!value.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await operationsApi.aiAsk(value);
      setAnswer(result.answer || "The local model returned an empty answer.");
      setQuestion("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Local AI assistant is unavailable");
    } finally {
      setBusy(false);
    }
  };

  return <div className="bot-panel">
    <div className="bot-intro"><span className="ai-orbit">✦</span><div><h2>Local AI assistant</h2><p>Answers are generated from real LocalVision events and alerts using the configured local text model.</p></div></div>
    <div className="bot-suggestions"><button onClick={() => void ask("Show today's person detections.")}>Today's person detections</button><button onClick={() => void ask("Summarize the newest alerts.")}>Newest alerts</button><button onClick={() => void ask("Which cameras produced the most detections?")}>Busiest cameras</button></div>
    <div className="bot-compose"><input value={question} onChange={event => setQuestion(event.target.value)} placeholder="Ask about your local security system" /><button className="primary" disabled={busy} onClick={() => void ask()}>{busy ? "Thinking…" : "Ask local model"}</button></div>
    {error && <div className="error-state">{error}</div>}
    {answer && <div className="notice inline-notice"><b>{aiState?.model ?? "Local model"}</b><p>{answer}</p></div>}
  </div>;
}

export function AIHub({ cameras, canWrite }: { cameras: Camera[]; canWrite: boolean }) {
  const [section, setSection] = useState<HubSection>("overview");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [aiState, setAiState] = useState<AiStatus | null>(null);
  const [models, setModels] = useState<AiModel[]>([]);
  const [settings, setSettings] = useState<AiSettings>(defaultSettings);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [notice, setNotice] = useState("");

  const refresh = async () => {
    const [metricsValue, aiValue, modelsValue, settingsValue, alertsValue] = await Promise.all([
      monitoringApi.metrics().catch(() => null),
      operationsApi.aiStatus().catch(() => null),
      operationsApi.aiModels().catch(() => ({ models: [] })),
      operationsApi.aiSettings().catch(() => null),
      operationsApi.alerts({ status: "new" }).catch(() => [])
    ]);
    if (metricsValue) setMetrics(metricsValue);
    if (aiValue) setAiState(aiValue);
    setModels(modelsValue.models);
    if (settingsValue) setSettings(settingsValue.settings);
    setAlerts(alertsValue);
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => window.clearInterval(timer);
  }, []);

  const saveSettings = async (changes: Partial<AiSettings>) => {
    try {
      const result = await operationsApi.saveAiSettings(changes);
      setSettings(result.settings);
      setNotice("AI rules saved and applied to the local bridge");
      await refresh();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Could not save AI rules");
    }
  };

  const control = async (action: "start" | "stop") => {
    try {
      await operationsApi.surveillanceControl(action);
      setNotice(`Local surveillance ${action === "start" ? "started" : "stopped"}`);
      await refresh();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : `Could not ${action} surveillance`);
    }
  };

  return <>
    <div className="page-heading"><div><span className="eyebrow">Intelligence / control plane</span><h1>AI Hub</h1><p>Local models, explainable detections, rules, voice, and performance from the running system.</p></div><span className="hub-status"><i /> {aiState?.status ?? "checking"}</span></div>
    {notice && <div className="notice inline-notice">{notice}</div>}
    {aiState?.error && <div className="error-state">{aiState.error}</div>}
    <nav className="hub-tabs" aria-label="AI Hub sections">{sections.map(([id, label]) => <button className={section === id ? "active" : ""} key={id} onClick={() => setSection(id)}>{label}</button>)}</nav>
    {section === "overview" && <div className="ai-overview">
      <div className="ai-hero panel"><span className="ai-orbit">✦</span><div><span className="eyebrow">Active provider</span><h2>{aiState?.model ?? "—"}</h2><p>{aiState?.provider ?? "Awaiting API"} · {aiState?.local_only ? "local only" : "provider status unavailable"}</p></div></div>
      <div className="ai-stat-grid">
        <div className="health-card"><small>AI service</small><b>{aiState?.status ?? "—"}</b><span>{aiState?.error ? "Check bridge" : "Backend status"}</span></div>
        <div className="health-card"><small>Configured cameras</small><b>{aiState?.counts?.cameras ?? cameras.length}</b><span>AI scope</span></div>
        <div className="health-card"><small>Events</small><b>{aiState?.counts?.events ?? "—"}</b><span>Local detections</span></div>
        <div className="health-card"><small>New alerts</small><b>{aiState?.counts?.new_alerts ?? "—"}</b><span>Require response</span></div>
      </div>
    </div>}
    {section === "detection" && <AICenter cameras={cameras} />}
    {section === "rules" && <>
      <ZoneEditor cameras={cameras} canWrite={canWrite} />
      <div className="settings-grid">
        <label>Confidence threshold<input type="range" min=".1" max=".99" step=".01" value={settings.detection_confidence} disabled={!canWrite} onChange={event => setSettings(current => ({ ...current, detection_confidence: Number(event.target.value) }))} /></label>
        <label>Motion threshold<input type="number" min="1" max="100" value={settings.motion_threshold} disabled={!canWrite} onChange={event => setSettings(current => ({ ...current, motion_threshold: Number(event.target.value) }))} /></label>
        <label>Frame interval (ms)<input type="number" min="2000" step="1000" value={settings.frame_interval_ms} disabled={!canWrite} onChange={event => setSettings(current => ({ ...current, frame_interval_ms: Number(event.target.value) }))} /></label>
        <label>Max objects<input type="number" min="1" max="20" value={settings.max_objects} disabled={!canWrite} onChange={event => setSettings(current => ({ ...current, max_objects: Number(event.target.value) }))} /></label>
        <label>Alert severity<select value={settings.alert_severity} disabled={!canWrite} onChange={event => setSettings(current => ({ ...current, alert_severity: event.target.value as AiSettings["alert_severity"] }))}><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option><option value="none">None</option></select></label>
        <div className="setting-card"><div><b>Webhook notifications</b><small>Send new alerts to enabled integrations.</small></div><input type="checkbox" checked={settings.notify_webhooks} disabled={!canWrite} onChange={event => setSettings(current => ({ ...current, notify_webhooks: event.target.checked }))} /></div>
        <div className="setting-card"><div><b>Person only</b><small>Ignore vehicle and generic motion detections.</small></div><input type="checkbox" checked={settings.person_only} disabled={!canWrite} onChange={event => setSettings(current => ({ ...current, person_only: event.target.checked }))} /></div>
        <div className="setting-card"><div><b>Surveillance</b><small>{settings.surveillance_enabled ? "Real frame analysis is active." : "Frame analysis is stopped."}</small></div><div className="button-row"><button disabled={!canWrite} onClick={() => void control("start")}>Start</button><button disabled={!canWrite} onClick={() => void control("stop")}>Stop</button></div></div>
        <button className="primary" disabled={!canWrite} onClick={() => void saveSettings(settings)}>Save and apply rules</button>
      </div>
    </>}
    {section === "models" && <div className="panel settings-grid">
      <div className="setting-card"><div><b>Detection backend</b><small>{aiState?.detector ? JSON.stringify(aiState.detector) : "No detector reported"}</small></div><span className="status-badge">{aiState?.status ?? "unknown"}</span></div>
      {models.map(model => <div className="setting-card" key={model.id}><div><b>{model.id}</b><small>{model.kind ?? "model"} · {model.endpoint ?? "local endpoint"}</small></div><span className="status-badge">Available</span></div>)}
      {!models.length && <div className="empty-state">No local models are reporting.</div>}
    </div>}
    {section === "bot" && <BotPanel aiState={aiState} />}
    {section === "voice" && <VoicePanel settings={settings} alerts={alerts} canWrite={canWrite} onSave={saveSettings} />}
    {section === "performance" && <div className="system-grid">
      <div className="health-card"><small>Inference FPS</small><b>{aiState?.fps == null ? "—" : aiState.fps}</b><span>Reported by local bridge</span></div>
      <div className="health-card"><small>Latest frame</small><b>{aiState?.last_frame_at ? new Date(aiState.last_frame_at).toLocaleTimeString() : "—"}</b><span>Real camera analysis</span></div>
      <div className="health-card"><small>Detections</small><b>{aiState?.counts?.events ?? "—"}</b><span>Local event records</span></div>
      <div className="health-card"><small>CPU usage</small><b>{metrics?.cpu == null ? "—" : `${metrics.cpu}%`}</b><span>System API</span></div>
      <div className="health-card"><small>Memory usage</small><b>{metrics?.ram == null ? "—" : `${metrics.ram}%`}</b><span>System API</span></div>
    </div>}
  </>;
}
