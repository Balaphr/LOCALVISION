interface Props { onComplete: () => void; }

const irisBlades = [0, 60, 120, 180, 240, 300];

export function SplashScreen({ onComplete }: Props) {
  return <main className="splash-screen" role="status" aria-label="Loading LocalVision AI">
    <div className="splash-center">
      <div className="splash-stage" aria-hidden="true">
        <span className="splash-focus focus-tl" />
        <span className="splash-focus focus-tr" />
        <span className="splash-focus focus-bl" />
        <span className="splash-focus focus-br" />
        <svg className="splash-ai-lens" viewBox="0 0 320 320" focusable="false">
          <defs>
            <radialGradient id="lvLensCore" cx="42%" cy="36%" r="72%">
              <stop offset="0%" stopColor="#eafffb" />
              <stop offset="14%" stopColor="#7fe8d8" />
              <stop offset="42%" stopColor="#1c6b69" />
              <stop offset="72%" stopColor="#08252c" />
              <stop offset="100%" stopColor="#041014" />
            </radialGradient>
            <linearGradient id="lvLensRing" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#d8fff8" />
              <stop offset="35%" stopColor="#51d1bd" />
              <stop offset="70%" stopColor="#165c5b" />
              <stop offset="100%" stopColor="#8ce8d7" />
            </linearGradient>
            <linearGradient id="lvLensBlade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1c5d5a" />
              <stop offset="100%" stopColor="#071b20" />
            </linearGradient>
          </defs>
          <circle className="lens-halo" cx="160" cy="160" r="142" />
          <circle className="lens-outer" cx="160" cy="160" r="120" />
          <circle className="lens-inner" cx="160" cy="160" r="94" />
          <circle className="lens-track" cx="160" cy="160" r="108" />
          <g className="lens-iris">
            {irisBlades.map(angle => <path key={angle} d="M160 66 L171 98 L149 98 Z" fill="url(#lvLensBlade)" transform={`rotate(${angle} 160 160)`} />)}
          </g>
          <circle className="lens-core" cx="160" cy="160" r="60" />
          <circle className="lens-glint" cx="138" cy="132" r="11" />
          <path className="lens-scan" d="M104 160 A56 56 0 0 1 216 160" />
          <text className="lens-mark" x="160" y="171">AI</text>
        </svg>
      </div>
      <div className="splash-copy"><span className="eyebrow">LocalVision neural core</span><strong>FOCUS LOCKED</strong><small>Initializing secure AI vision</small></div>
    </div>
    <button className="splash-continue" onClick={onComplete}>Continue</button>
    <div className="splash-timer" onAnimationEnd={onComplete} />
  </main>;
}
