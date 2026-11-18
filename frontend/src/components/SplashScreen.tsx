interface Props { onComplete: () => void; }

export function SplashScreen({ onComplete }: Props) {
  return <main className="splash-screen" role="status" aria-label="Loading LocalVision AI"><div className="splash-orbit" aria-hidden="true" /><div className="splash-camera camera-logo" aria-hidden="true"><span className="camera-mount" /><span className="camera-body"><span className="camera-lens" /><span className="camera-status" /></span></div><div className="splash-copy"><span className="eyebrow">Secure local node</span><strong>LOCALVISION AI</strong><small>Initializing security operations</small></div><button className="splash-continue" onClick={onComplete}>Continue</button><div className="splash-timer" onAnimationEnd={onComplete} /></main>;
}
