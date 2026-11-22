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
    let active = true;
    let retries = 0;
    let reloadTimer: number | null = null;
    let stallTimer: number | null = null;
    let lastTime = -1;
    let lastProgress = Date.now();

    const clearReload = () => {
      if (reloadTimer === null) return;
      window.clearTimeout(reloadTimer);
      reloadTimer = null;
    };

    const destroyHls = () => {
      hls?.destroy();
      hls = null;
    };

    const play = () => {
      void video.play().catch(() => undefined);
    };

    const reconnect = () => {
      if (!active || reloadTimer !== null) return;
      retries += 1;
      setError("Reconnecting…");
      clearReload();
reloadTimer = window.setTimeout(() => {
         reloadTimer = null;
         destroyHls();
         video.removeAttribute("src");
         video.load();
         start();
       }, Math.min(5000, 1000 * retries));
    };

    const start = () => {
      if (!active) return;
      setError("");
      lastTime = -1;
      lastProgress = Date.now();
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
        video.onerror = () => reconnect();
        play();
        return;
      }
      if (!Hls.isSupported()) {
        setError("HLS is not supported by this browser");
        return;
      }
hls = new Hls({
         lowLatencyMode: true,
         backBufferLength: 6,
         maxBufferLength: 8,
         maxMaxBufferLength: 16,
         enableWorker: true,
         manifestLoadingMaxRetry: 8,
         manifestLoadingRetryDelay: 1000,
         levelLoadingMaxRetry: 8,
         levelLoadingRetryDelay: 1000,
         fragLoadingMaxRetry: 8,
         fragLoadingRetryDelay: 1000,
         liveSyncDurationCount: 2,
         liveMaxLatencyDurationCount: 6,
         maxLiveSyncPlaybackRate: 1.2
       });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        retries = 0;
        lastProgress = Date.now();
        setError("");
        play();
      });
      hls.on(Hls.Events.FRAG_LOADED, () => {
        lastProgress = Date.now();
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && retries < 2) {
          retries += 1;
          hls?.recoverMediaError();
          play();
          return;
        }
        reconnect();
      });
    };

    const onPlaying = () => {
      retries = 0;
      lastProgress = Date.now();
      setError("");
    };

    video.addEventListener("playing", onPlaying);
    start();
    stallTimer = window.setInterval(() => {
      if (document.hidden || video.paused || video.ended) return;
      const current = video.currentTime;
      if (Number.isFinite(current) && current > lastTime + 0.05) {
        lastTime = current;
        lastProgress = Date.now();
        return;
      }
      if (Date.now() - lastProgress > 15000) reconnect();
    }, 2000);

    return () => {
      active = false;
      clearReload();
      if (stallTimer !== null) window.clearInterval(stallTimer);
      video.removeEventListener("playing", onPlaying);
      video.onerror = null;
      destroyHls();
      video.removeAttribute("src");
      video.load();
    };
  }, [src]);

  return <div className="hls-wrap"><video ref={videoRef} className={className} autoPlay muted playsInline />{error && <div className="stream-error">{error}</div>}</div>;
}
