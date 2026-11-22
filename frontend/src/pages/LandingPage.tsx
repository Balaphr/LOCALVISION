import { useEffect, useRef, useState } from "react";
import { LoginPage } from "./LoginPage";
import type { User } from "../types/auth";
import { AICameraLogo } from "../components/AICameraLogo";

interface Props { onAuthenticated: (user: User) => void; }

type HeadingLine = { text: string; accent?: boolean };

const marqueeItems = ["Private · Local · Secure", "Encrypted Sessions", "Explainable AI", "Local Processing", "Zero Cloud Dependence"];
const tickerItems = ["ZERO CLOUD DEPENDENCE", "REAL-TIME LOCAL AI", "ENCRYPTED BY DESIGN", "AUDIT-READY DETECTIONS", "PRIVATE BY DEFAULT"];
const features = [
  { title: "Local AI Processing", description: "Run inference directly on your hardware. No data leaves your network.", icon: "⬢" },
  { title: "Real-Time Alerts", description: "Get instant notifications when motion, people, or vehicles are detected.", icon: "⚡" },
  { title: "Encrypted Storage", description: "All recordings and session data are encrypted at rest and in transit.", icon: "🔒" },
  { title: "Explainable AI", description: "Every detection comes with confidence scores and reasoning you can audit.", icon: "🔍" }
];
const overviewPoints = ["Unified live view, recordings, and event review", "Camera health and storage signals in one place", "Role-based access with encrypted sessions"];
const stats = [
  { value: "0ms", label: "Cloud round-trip required" },
  { value: "100%", label: "Data stays on your network" },
  { value: "24/7", label: "Local monitoring readiness" }
];

function AnimatedHeading({ lines, className = "" }: { lines: HeadingLine[]; className?: string }) {
  let wordIndex = 0;
  return (
    <span className={className}>
      {lines.map(line => (
        <span className={`heading-line${line.accent ? " heading-accent" : ""}`} key={line.text}>
          {line.text.split(" ").map(word => {
            const delay = wordIndex++ * 65;
            return <span className="heading-word" key={`${line.text}-${delay}`} style={{ animationDelay: `${delay}ms` }}>{word}</span>;
          })}
        </span>
      ))}
    </span>
  );
}

export function LandingPage({ onAuthenticated }: Props) {
  const [showLogin, setShowLogin] = useState(false);
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (showLogin) return;
    const nodes = rootRef.current?.querySelectorAll<HTMLElement>("[data-reveal]");
    if (!nodes?.length) return;
    if (typeof IntersectionObserver === "undefined") {
      nodes.forEach(node => node.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    nodes.forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, [showLogin]);

  if (showLogin) return <LoginPage onAuthenticated={onAuthenticated} />;

  const openLogin = () => setShowLogin(true);
  const scrollToFeatures = () => document.getElementById("features")?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <main className="landing-shell" ref={rootRef}>
      <nav className="landing-nav">
        <div className="landing-brand">
          <span className="brand-mark landing-logo" aria-hidden="true"><AICameraLogo /></span>
          <span><b>LOCALVISION AI</b></span>
        </div>
        <div className="landing-nav-actions">
          <span className="landing-status"><i /> EDGE NODE ONLINE</span>
          <button className="landing-signin" onClick={openLogin}>
            <span>Sign In</span><span className="signin-arrow">→</span>
          </button>
        </div>
      </nav>

      <section className="landing-hero">
        <div className="landing-marquee" aria-hidden="true">
          <div className="marquee-track">
            {[...marqueeItems, ...marqueeItems].map((item, index) => (
              <span className="marquee-item" key={index}>{item}<span className="marquee-divider">•</span></span>
            ))}
          </div>
        </div>

        <div className="landing-hero-grid">
          <div className="landing-hero-content">
            <span className="landing-eyebrow">Your security node, clearly understood.</span>
            <h1 className="landing-heading">
              <AnimatedHeading lines={[
                { text: "AI-Powered Video Security" },
                { text: "Running Entirely on Your Hardware", accent: true }
              ]} />
            </h1>
            <p className="landing-description">
              Turn any camera into an intelligent security system with local AI processing,
              real-time alerts, and encrypted storage — no cloud required.
            </p>
            <div className="landing-cta">
              <button className="landing-btn landing-btn-primary" onClick={openLogin}>Sign In to Your Node</button>
              <button className="landing-btn landing-btn-secondary" onClick={scrollToFeatures}>Explore Features</button>
            </div>
            <div className="hero-proof">
              <span>◉ No cloud required</span>
              <span>⌁ Session encrypted</span>
              <span>✦ Audit-ready AI</span>
            </div>
          </div>

          <div className="landing-hero-visual" aria-hidden="true">
            <div className="landing-canvas">
              <div className="landing-orbit landing-orbit-one" />
              <div className="landing-orbit landing-orbit-two" />
              <div className="landing-camera-mock">
                <div className="mock-body">
                  <div className="mock-lens" />
                  <div className="mock-status" />
                </div>
              </div>
              <div className="landing-glow" />
              <span className="visual-ring-label ring-one">LIVE</span>
              <span className="visual-ring-label ring-two">LOCAL</span>
            </div>
          </div>
        </div>
      </section>

      <div className="cinematic-ticker" aria-hidden="true">
        <div className="ticker-track">
          {[0, 1].map(group => (
            <div className="ticker-group" key={group}>
              {tickerItems.map(item => (
                <span className="ticker-item" key={`${group}-${item}`}>{item}<span className="ticker-sep">◆</span></span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <section className="landing-features" id="features">
        <div className="section-header" data-reveal>
          <span className="section-eyebrow">Built for privacy, designed for control</span>
          <h2 className="section-heading">Everything you need, nothing you don't.</h2>
          <p>Focused tooling that keeps every frame, event, and decision inside your network.</p>
        </div>
        <div className="feature-grid">
          {features.map((feature, index) => (
            <article className="feature-card" key={feature.title} data-reveal>
              <div className="feature-icon">{feature.icon}</div>
              <h3 className="feature-title">{feature.title}</h3>
              <p className="feature-description">{feature.description}</p>
              <span className="feature-index">0{index + 1}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-overview" id="overview">
        <div className="overview-grid">
          <div className="overview-copy" data-reveal>
            <span className="section-eyebrow">One calm command center</span>
            <h2 className="section-heading overview-heading">
              <AnimatedHeading lines={[
                { text: "See every signal." },
                { text: "Understand every event.", accent: true }
              ]} />
            </h2>
            <p className="overview-description">
              Cameras, recordings, alerts, and AI operations come together in a single local
              workspace designed for clarity, speed, and complete control.
            </p>
            <ul className="overview-list">
              {overviewPoints.map(point => <li key={point}><i>✓</i>{point}</li>)}
            </ul>
            <button className="landing-btn landing-btn-secondary" onClick={openLogin}>Open the console</button>
          </div>

          <div className="overview-console" data-reveal aria-hidden="true">
            <div className="console-bar">
              <span className="console-dots"><i /><i /><i /></span>
              <span>LOCALVISION / LIVE OPERATIONS</span>
              <span className="console-live">● LIVE</span>
            </div>
            <div className="console-body">
              <div className="console-feed">
                <div className="feed-grid-lines" />
                <span className="feed-tag">CAM 04 · NORTH ENTRY</span>
                <span className="feed-detection"><i /> PERSON DETECTED <b>98%</b></span>
                <span className="feed-scan" />
              </div>
              <div className="console-stats">
                <div className="console-stat">
                  <small>ACTIVE CAMERAS</small>
                  <b>12</b>
                  <span className="mini-bar"><i className="bar-78" /></span>
                </div>
                <div className="console-stat">
                  <small>EVENTS TODAY</small>
                  <b>46</b>
                  <span className="mini-bar"><i className="bar-46" /></span>
                </div>
                <div className="console-stat">
                  <small>NODE HEALTH</small>
                  <b>91%</b>
                  <span className="mini-bar"><i className="bar-91" /></span>
                </div>
              </div>
            </div>
            <div className="console-footer">
              <span>EDGE NODE ONLINE</span>
              <span>LATENCY 28ms</span>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-stats">
        <div className="stats-grid">
          {stats.map(stat => (
            <div className="stat-card" key={stat.label} data-reveal>
              <div className="stat-value">{stat.value}</div>
              <div className="stat-label">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-cta-section" data-reveal>
        <div className="cta-card">
          <span className="section-eyebrow">Your network. Your rules.</span>
          <h2>Ready to take control of your video security?</h2>
          <button className="landing-btn landing-btn-primary cta-btn" onClick={openLogin}>Sign In — It's Free</button>
        </div>
      </section>

      <footer className="landing-footer">
        <span>LOCALVISION AI</span>
        <span>Private by design · Built for the edge</span>
      </footer>
    </main>
  );
}
