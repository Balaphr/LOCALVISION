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
        <stop offset="0%" stopColor="#5ed8c4" />
        <stop offset="55%" stopColor="#237c75" />
        <stop offset="100%" stopColor="#0d3a3d" />
      </linearGradient>
      <linearGradient id={ringId} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#d8fff8" />
        <stop offset="45%" stopColor="#51d1bd" />
        <stop offset="100%" stopColor="#165c5b" />
      </linearGradient>
      <radialGradient id={coreId} cx="38%" cy="34%" r="70%">
        <stop offset="0%" stopColor="#eafffb" />
        <stop offset="18%" stopColor="#7fe8d8" />
        <stop offset="55%" stopColor="#1c6b69" />
        <stop offset="100%" stopColor="#06181d" />
      </radialGradient>
    </defs>
    <g className="ai-logo-shell">
      <path className="ai-logo-mount" d="M9 7h8l2.4 3H6.6L9 7Z" />
      <rect className="ai-logo-body" x="2.5" y="9.5" width="27" height="18" rx="5" fill={`url(#${bodyId})`} />
      <circle className="ai-logo-orbit" cx="16" cy="18.5" r="11" />
      <circle className="ai-logo-ring" cx="16" cy="18.5" r="8" fill={`url(#${ringId})`} />
      <g className="ai-logo-iris">
        {irisAngles.map(angle => <path key={angle} d="M16 10.5 L17.5 14 L14.5 14 Z" transform={`rotate(${angle} 16 18.5)`} />)}
      </g>
      <circle className="ai-logo-glow" cx="16" cy="18.5" r="7" />
      <circle className="ai-logo-core" cx="16" cy="18.5" r="5.2" fill={`url(#${coreId})`} />
      <circle className="ai-logo-glint" cx="14" cy="16.5" r="1.05" />
      <circle className="ai-logo-status" cx="25" cy="13.2" r="0.95" />
    </g>
  </svg>;
});
