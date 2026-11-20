import { useEffect } from "react";

export interface RealtimeMessage { type: string; [key: string]: unknown; }

export function useRealtime(onMessage: (message: RealtimeMessage) => void): void {
  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer: number | undefined;
    let active = true;
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${protocol}://${window.location.host}/api/ws`;
    const connect = () => {
      if (!active) return;
      socket = new WebSocket(url);
      socket.onmessage = event => {
        try {
          onMessage(JSON.parse(event.data) as RealtimeMessage);
        } catch {
          return;
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (active) timer = window.setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
      socket?.close();
    };
  }, [onMessage]);
}
