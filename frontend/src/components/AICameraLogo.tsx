import { memo, useId } from "react";

interface Props { className?: string; }

const irisAngles = [0, 60, 120, 180, 240, 300];

export const AICameraLogo = memo(function AICameraLogo({ className }: Props) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const bodyId = `lv-body-${id}`;
  const ringId = `lv-ring-${id}`;
  const coreId = `lv-core-${id}`;

  return <svg className={`ai-camera-logo${className ? ` ${className}` : ""}`} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={bodyId} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#8ce8d7" />
        <stop offset="45%" stopColor="#237c75" />
        <stop offset="100%" stopColor="#082f35" />
      </linearGradient>
      <linearGradient id={ringId} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#eafffb" />
        <stop offset="45%" stopColor="#51d1bd" />
        <stop offset="100%" stopColor="#165c5b" />
      </linearGradient>
      <radialGradient id={coreId} cx="38%" cy="34%" r="70%">
        <stop offset="0%" stopColor="#eafffb" />
        <stop offset="20%" stopColor="#7fe8d8" />
        <stop offset="58%" stopColor="#1c6b69" />
        <stop offset="100%" stopColor="#06181d" />
      </radialGradient>
    </defs>
    <g className="ai-logo-shell">
      <path className="ai-logo-mount" d="M12.5 4.1 16 2 19.5 4.1 18.5 6.4 H13.5 Z" />
      <path className="ai-logo-frame" d="M16 2.2 28 8.8 V23.2 L16 29.8 4 23.2 V8.8 Z" fill={`url(#${bodyId})`} />
      <path className="ai-logo-inner" d="M16 5.8 24.6 10.6 V21.4 L16 26.2 7.4 21.4 V10.6 Z" />
      <circle className="ai-logo-orbit" cx="16" cy="16.8" r="10.1" />
      <circle className="ai-logo-ring" cx="16" cy="16.8" r="7.2" fill={`url(#${ringId})`} />
      <g className="ai-logo-iris">
        {irisAngles.map(angle => <path key={angle} d="M16 9.6 L17.4 13 L14.6 13 Z" transform={`rotate(${angle} 16 16.8)`} />)}
      </g>
      <circle className="ai-logo-glow" cx="16" cy="16.8" r="6.5" />
      <circle className="ai-logo-core" cx="16" cy="16.8" r="5" fill={`url(#${coreId})`} />
      <text className="ai-logo-text" x="16" y="18.8">AI</text>
      <circle className="ai-logo-glint" cx="13.8" cy="14.8" r="1" />
      <circle className="ai-logo-status" cx="25.2" cy="11.5" r="0.9" />
    </g>
  </svg>;
});
