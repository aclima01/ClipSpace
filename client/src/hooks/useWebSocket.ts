import { useEffect, useRef, useCallback, useState } from "react";
import type { LocalMessage } from "../types";

interface UseWebSocketOptions {
  conversationId: string | null;
  onMessage: (message: LocalMessage) => void;
  onConnectedCount: (count: number) => void;
  onConversationTouched: (conversationId: string, updatedAt: string) => void;
  onMessagesCleared: (conversationId: string) => void;
  onConversationDeleted: (conversationId: string) => void;
  onConversationCreated: (conversation: { id: string; title: string; created_at: string; updated_at: string }) => void;
}

export function useWebSocket({
  conversationId,
  onMessage,
  onConnectedCount,
  onConversationTouched,
  onMessagesCleared,
  onConversationDeleted,
  onConversationCreated,
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const conversationIdRef = useRef(conversationId);
  const onMessageRef = useRef(onMessage);
  const onConnectedCountRef = useRef(onConnectedCount);
  const onConversationTouchedRef = useRef(onConversationTouched);
  const onMessagesClearedRef = useRef(onMessagesCleared);
  const onConversationDeletedRef = useRef(onConversationDeleted);
  const onConversationCreatedRef = useRef(onConversationCreated);
  const connectRef = useRef<() => void>(() => {});

  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);
  useEffect(() => { onConnectedCountRef.current = onConnectedCount; }, [onConnectedCount]);
  useEffect(() => { onConversationTouchedRef.current = onConversationTouched; }, [onConversationTouched]);
  useEffect(() => { onMessagesClearedRef.current = onMessagesCleared; }, [onMessagesCleared]);
  useEffect(() => { onConversationDeletedRef.current = onConversationDeleted; }, [onConversationDeleted]);
  useEffect(() => { onConversationCreatedRef.current = onConversationCreated; }, [onConversationCreated]);

  const subscribe = useCallback((ws: WebSocket) => {
    const id = conversationIdRef.current;
    if (id && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "subscribe", conversationId: id }));
    }
  }, []);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      subscribe(ws);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);
        if (data.type === "message") {
          onMessageRef.current({ ...data.payload, status: "confirmed" } as LocalMessage);
        } else if (data.type === "connected_count") {
          onConnectedCountRef.current(data.count as number);
        } else if (data.type === "conversation_touched") {
          onConversationTouchedRef.current(data.conversationId as string, data.updatedAt as string);
        } else if (data.type === "messages_cleared") {
          onMessagesClearedRef.current(data.conversationId as string);
        } else if (data.type === "conversation_deleted") {
          onConversationDeletedRef.current(data.conversationId as string);
        } else if (data.type === "conversation_created") {
          onConversationCreatedRef.current(data.payload);
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      setTimeout(() => connectRef.current(), 2000);
    };

    ws.onerror = () => ws.close();
  }, [subscribe]);

  useEffect(() => { connectRef.current = connect; }, [connect]);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  useEffect(() => {
    if (wsRef.current) subscribe(wsRef.current);
  }, [conversationId, subscribe]);

  const sendMessage = useCallback((content: string, deviceName: string, clientId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "message", content, deviceName, clientId }));
      return true;
    }
    return false;
  }, []);

  return { isConnected, sendMessage };
}
