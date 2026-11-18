import { useEffect } from "react";

export interface RealtimeMessage { type: string; [key: string]: unknown; }

export function useRealtime(onMessage: (message: RealtimeMessage) => void): void {
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${window.location.host}/api/ws`);
    socket.onmessage = event => { try { onMessage(JSON.parse(event.data) as RealtimeMessage); } catch { /* Ignore malformed events. */ } };
    return () => socket.close();
  }, [onMessage]);
}
