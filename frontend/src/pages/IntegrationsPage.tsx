import { useEffect, useState } from "react";
import type { Integration, IntegrationInput } from "../types/operations";
import { integrationApi } from "../services/api";

interface Props { canWrite: boolean; }

const empty: IntegrationInput = { name: "", kind: "webhook", endpoint: "", auth_method: "none", secret: "", enabled: true };

export function IntegrationsPage({ canWrite }: Props) {
  const [items, setItems] = useState<Integration[]>([]);
  const [form, setForm] = useState<IntegrationInput>(empty);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setItems(await integrationApi.list());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load integrations");
    }
  };

  useEffect(() => { void load(); }, []);

  const update = (key: keyof IntegrationInput, value: string | boolean) => {
    setForm(current => ({ ...current, [key]: value }));
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canWrite) {
      setError("Your role has read-only access");
      return;
    }
    try {
      await integrationApi.create(form);
      setForm(empty);
      setNotice("Integration added");
      setError("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add integration");
    }
  };

  const test = async (id: number) => {
    try {
      const result = await integrationApi.test(id);
      if (result.ok) {
        setNotice(`Connection test succeeded (${result.status_code ?? 200})`);
        setError("");
      } else {
        setError(result.error ?? "Connection test failed");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Connection test failed");
    }
  };

  const remove = async (id: number) => {
    if (!canWrite) {
      setError("Your role has read-only access");
      return;
    }
    try {
      await integrationApi.remove(id);
      setNotice("Integration removed");
      setError("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove integration");
    }
  };

  return <>
    <div className="page-heading"><div><span className="eyebrow">System / integrations</span><h1>API integrations</h1><p>Optional notification destinations with encrypted credentials.</p></div></div>
    {notice && <div className="notice inline-notice" role="status">{notice}</div>}
    {error && <div className="error-state" role="alert">{error}</div>}
    {canWrite && <section className="settings-panel">
      <div className="section-title"><h2>Add integration</h2><span>Local endpoint</span></div>
      <form className="settings-form-grid" onSubmit={create}>
        <label>Name<input required value={form.name} onChange={event => update("name", event.target.value)} /></label>
        <label>Kind<input required value={form.kind} onChange={event => update("kind", event.target.value)} /></label>
        <label>Endpoint<input required type="url" value={form.endpoint} onChange={event => update("endpoint", event.target.value)} /></label>
        <label>Authentication<select value={form.auth_method} onChange={event => update("auth_method", event.target.value)}><option value="none">None</option><option value="bearer">Bearer token</option><option value="api_key">API key</option></select></label>
        <label>Secret<input type="password" value={form.secret ?? ""} autoComplete="off" onChange={event => update("secret", event.target.value)} /></label>
        <label className="toggle-setting"><span>Enabled</span><input type="checkbox" checked={form.enabled} onChange={event => update("enabled", event.target.checked)} /></label>
        <div className="form-actions"><button className="primary" type="submit">Add integration</button></div>
      </form>
    </section>}
    <div className="integration-grid">
      {items.map(item => <article className="integration-card" key={item.id}>
        <div className="integration-icon">↗</div>
        <div><h3>{item.name}</h3><p>{item.kind} · {item.auth_method}</p><small>{item.enabled ? "Enabled" : "Disabled"} · secrets never displayed</small></div>
        <div className="integration-actions"><button onClick={() => void test(item.id)}>Test connection</button>{canWrite && <button disabled={!canWrite} onClick={() => void remove(item.id)}>Delete</button>}</div>
      </article>)}
      {!items.length && <div className="empty-state">No integrations configured. Add a webhook, email, or local automation endpoint above.</div>}
    </div>
  </>;
}
