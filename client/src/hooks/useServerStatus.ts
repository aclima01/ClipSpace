import { useEffect, useRef, useState, useCallback } from "react";

interface UseServerStatusOptions {
  onReconnect: () => Promise<void>;
}

export function useServerStatus({ onReconnect }: UseServerStatusOptions) {
  const [serverOnline, setServerOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const wasOnlineRef = useRef(true);
  const syncingRef = useRef(false);
  const onReconnectRef = useRef(onReconnect);
  useEffect(() => { onReconnectRef.current = onReconnect; }, [onReconnect]);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (res.ok) {
        if (!wasOnlineRef.current && !syncingRef.current) {
          wasOnlineRef.current = true;
          setServerOnline(true);
          syncingRef.current = true;
          setSyncing(true);
          try { await onReconnectRef.current(); } finally {
            syncingRef.current = false;
            setSyncing(false);
          }
        } else {
          setServerOnline(true);
        }
      } else {
        wasOnlineRef.current = false;
        setServerOnline(false);
      }
    } catch {
      wasOnlineRef.current = false;
      setServerOnline(false);
    }
  }, []);

  useEffect(() => {
    check();
    const id = setInterval(check, 10_000);
    return () => clearInterval(id);
  }, [check]);

  return { serverOnline, syncing };
}
