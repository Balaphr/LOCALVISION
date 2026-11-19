import { useEffect, useRef, useState } from "react";
import { LoginPage } from "./LoginPage";
import { authApi } from "../services/api";
import type { User } from "../types/auth";

interface Props { onAuthenticated: (user: User) => void; }

export function LandingPage({ onAuthenticated }: Props) {
  const [showLogin, setShowLogin] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const markRevealed = (id: string) => {
    setRevealed(prev => ({ ...prev, [id]: true }));
  };

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const id = entry.target.getAttribute("data-reveal-id");
            if (id) markRevealed(id);
          }
        });
      },
      { threshold: 0.15 }
    );
    document.querySelectorAll("[data-reveal-id]").forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  if (showLogin) {
    return <LoginPage onAuthenticated={onAuthenticated} />;
  }

  const features = [
    { title: "Local AI Processing", description: "Run inference directly on your hardware. No data leaves your network.", icon: "⬢" },
    { title: "Real-Time Alerts", description: "Get instant notifications when motion, people, or vehicles are detected.", icon: "⚡" },
    { title: "Encrypted Storage", description: "All recordings and session data are encrypted at rest and in transit.", icon: "🔒" },
    { title: "Explainable AI", description: "Every detection comes with confidence scores and reasoning you can audit.", icon: "🔍" },
  ];

  return (
    <main className="landing-shell">
      <nav className="landing-nav">
        <div className="landing-brand">
          <span className="brand-mark camera-logo landing-logo" aria-hidden="true">
            <span className="camera-mount" />
            <span className="camera-body"><span className="camera-lens" /><span className="camera-status" /></span>
          </span>
          <span><b>LOCALVISION AI</b></span>
        </div>
        <button className="landing-signin" onClick={() => setShowLogin(true)}>Sign In</button>
      </nav>

      <section className="landing-hero">
        <div className="landing-marquee" aria-hidden="true">
          <div className="marquee-track">
            <span className="marquee-item">Private · Local · Secure</span>
            <span className="marquee-divider">•</span>
            <span className="marquee-item">Encrypted Sessions</span>
            <span className="marquee-divider">•</span>
            <span className="marquee-item">Explainable AI</span>
            <span className="marquee-divider">•</span>
            <span className="marquee-item">Local Processing</span>
            <span className="marquee-divider">•</span>
            <span className="marquee-item">Zero Cloud Dependence</span>
            <span className="marquee-divider">•</span>
            <span className="marquee-item">Private · Local · Secure</span>
            <span className="marquee-divider">•</span>
            <span className="marquee-item">Encrypted Sessions</span>
            <span className="marquee-divider">•</span>
            <span className="marquee-item">Explainable AI</span>
            <span className="marquee-divider">•</span>
            <span className="marquee-item">Local Processing</span>
            <span className="marquee-divider">•</span>
            <span className="marquee-item">Zero Cloud Dependence</span>
          </div>
        </div>

        <div className="landing-hero-grid">
          <div className="landing-hero-content" data-reveal-id="hero">
            <span className="landing-eyebrow">Your security node, clearly understood.</span>
            <h1 className="landing-heading">
              AI-Powered Video Security<br />
              <span className="landing-heading-highlight">Running Entirely on Your Hardware</span>
            </h1>
            <p className="landing-description">
              Turn any camera into an intelligent security system with local AI processing,
              real-time alerts, and encrypted storage — no cloud required.
            </p>
            <div className="landing-cta">
              <button className="landing-btn landing-btn-primary" onClick={() => setShowLogin(true)}>
                Sign In to Your Node
              </button>
              <button className="landing-btn landing-btn-secondary">Explore Features</button>
            </div>
          </div>

          <div className="landing-hero-visual" data-reveal-id="hero-visual">
            <div className="landing-canvas">
              <div className="landing-orbit" />
              <div className="landing-camera-mock">
                <div className="mock-body">
                  <div className="mock-lens" />
                  <div className="mock-status" />
                </div>
              </div>
              <div className="landing-glow" />
            </div>
          </div>
        </div>
      </section>

      <section className="landing-features" data-reveal-id="features">
        <div className="section-header">
          <span className="section-eyebrow">Built for privacy, designed for control</span>
          <h2 className="section-heading">Everything you need, nothing you don't.</h2>
        </div>
        <div className="feature-grid">
          {features.map((f, i) => (
            <div
              key={f.title}
              className={`feature-card ${revealed["feature-" + i] ? "revealed" : ""}`}
              data-reveal-id={`feature-${i}`}
            >
              <div className="feature-icon">{f.icon}</div>
              <h3 className="feature-title">{f.title}</h3>
              <p className="feature-description">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-stats" data-reveal-id="stats">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">0ms</div>
            <div className="stat-label">Local inference latency</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">100%</div>
            <div className="stat-label">Data stays on your network</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">256-bit</div>
            <div className="stat-label">AES encryption at rest</div>
          </div>
        </div>
      </section>

      <section className="landing-cta-section" data-reveal-id="final-cta">
        <div className="cta-card">
          <h2>Ready to take control of your video security?</h2>
          <button className="landing-btn landing-btn-primary cta-btn" onClick={() => setShowLogin(true)}>
            Sign In — It's Free
          </button>
        </div>
      </section>
    </main>
  );
}