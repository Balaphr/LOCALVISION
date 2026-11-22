import { AICameraLogo } from "./AICameraLogo";

interface Props { active: string; role?: string; onNavigate: (page: string) => void; }
const items = [["dashboard", "⌂", "Dashboard"], ["live", "◉", "Live View"], ["cameras", "▣", "Cameras"], ["recordings", "▤", "Recordings"], ["events", "◌", "Event Center"], ["ai", "✦", "AI Center"], ["alerts", "!", "Alert Center"], ["sharing", "↗", "Sharing"], ["storage", "▥", "Storage"], ["users", "♙", "Users"], ["integrations", "↗", "Integrations"], ["settings", "⚙", "Settings"], ["system", "◌", "System"]];
const adminOnly = new Set(["storage", "users", "system"]);

export function Sidebar({ active, role, onNavigate }: Props) {
  const visible = items.filter(([id]) => role === "admin" || !adminOnly.has(id));
  return <aside className="sidebar"><button className="brand brand-button" onClick={() => onNavigate("dashboard")} aria-label="Return to dashboard"><span className="brand-mark" aria-hidden="true"><AICameraLogo /></span><span><b>LOCALVISION AI</b></span></button><div className="nav-label">Workspace</div>{visible.map(([id, icon, label]) => <button className={`nav-button ${active === id ? "active" : ""}`} key={id} onClick={() => onNavigate(id)}><span>{icon}</span>{label}</button>)}<div className="system-status"><i /> All systems operational<br /><small>local node · phase 1</small></div></aside>;
}
