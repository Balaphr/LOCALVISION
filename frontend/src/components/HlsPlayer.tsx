import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

interface Props {
  src: string;
  className?: string;
}

export function HlsPlayer({ src, className }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let hls: Hls | null = null;
    let retries = 0;
    setError("");

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
    } else if (Hls.isSupported()) {
      hls = new Hls({ lowLatencyMode: true, backBufferLength: 30, enableWorker: true });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retries < 3) {
          retries += 1;
          window.setTimeout(() => hls?.startLoad(), 1500 * retries);
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && retries < 3) {
          retries += 1;
          hls?.recoverMediaError();
        } else {
          setError("Live stream unavailable");
        }
      });
    } else {
      setError("HLS is not supported by this browser");
    }

    void video.play().catch(() => undefined);
    return () => {
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [src]);

  return <div className="hls-wrap"><video ref={videoRef} className={className} autoPlay muted playsInline controls />{error && <div className="stream-error">{error}</div>}</div>;
}
