import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

export type StreamState = "idle" | "playing" | "stalled" | "error";

interface Props {
  src: string;
  className?: string;
  onStateChange?: (state: StreamState) => void;
}

export function HlsPlayer({ src, className, onStateChange }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const stateRef = useRef<StreamState>("idle");

  useEffect(() => { stateRef.current = "idle"; onStateChange?.("idle"); }, [src]);

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
    let frozenSince: number | null = null;

    const reportState = (state: StreamState) => {
      if (stateRef.current === state) return;
      stateRef.current = state;
      onStateChange?.(state);
    };

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
      reportState("stalled");
      clearReload();
      reloadTimer = window.setTimeout(() => {
        reloadTimer = null;
        destroyHls();
        video.removeAttribute("src");
        video.load();
        start();
      }, Math.min(5000, 600 * Math.max(retries, 1)));
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
        reportState("error");
        return;
      }
hls = new Hls({
         xhrSetup: (xhr: XMLHttpRequest) => { xhr.withCredentials = true; },
         lowLatencyMode: true,
         backBufferLength: 6,
         maxBufferLength: 8,
         maxMaxBufferLength: 16,
         enableWorker: true,
          manifestLoadingMaxRetry: 8,
          manifestLoadingRetryDelay: 600,
          levelLoadingMaxRetry: 8,
          levelLoadingRetryDelay: 600,
          fragLoadingMaxRetry: 8,
          fragLoadingRetryDelay: 600,
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
        reportState("error");
        reconnect();
      });
    };

    const onPlaying = () => {
      retries = 0;
      lastProgress = Date.now();
      frozenSince = null;
      setError("");
      reportState("playing");
    };

    video.addEventListener("playing", onPlaying);
    start();
    stallTimer = window.setInterval(() => {
      if (document.hidden || video.paused || video.ended) return;
      const current = video.currentTime;
      if (Number.isFinite(current) && current > lastTime + 0.05) {
        lastTime = current;
        lastProgress = Date.now();
        frozenSince = null;
        return;
      }
      if (frozenSince === null) frozenSince = Date.now();
      if (Date.now() - frozenSince > 6000 && video.seekable && video.seekable.length) {
        const edge = video.seekable.end(video.seekable.length - 1);
        if (edge - current > 2) {
          try { video.currentTime = Math.max(0, edge - 0.5); } catch {}
          frozenSince = Date.now();
          lastProgress = Date.now();
          return;
        }
      }
      if (Date.now() - lastProgress > 12000) reconnect();
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
