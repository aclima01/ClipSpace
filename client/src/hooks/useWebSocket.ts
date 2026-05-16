import { useEffect, useRef, useCallback, useState } from "react";
import type { LocalMessage, Page } from "../types";

interface UseWebSocketOptions {
  pageId: string | null;
  onMessage: (message: LocalMessage) => void;
  onConnectedCount: (count: number) => void;
  onPageTouched: (pageId: string, notebookId: string, updatedAt: string) => void;
  onMessagesCleared: (pageId: string) => void;
  onPageDeleted: (pageId: string, notebookId: string) => void;
  onNotebookDeleted: (notebookId: string) => void;
  onPageCreated: (page: Page) => void;
  onPageRenamed: (pageId: string, notebookId: string, title: string) => void;
  onNotebookCreated: (notebook: { id: string; title: string; created_at: string; updated_at: string }) => void;
  onNotebookRenamed: (notebookId: string, title: string) => void;
  onMessageDeleted: (messageId: string, pageId: string) => void;
  onMessageEdited: (messageId: string, content: string) => void;
  onMessagePinned: (messageId: string, pinned: boolean) => void;
}

export function useWebSocket({
  pageId,
  onMessage,
  onConnectedCount,
  onPageTouched,
  onMessagesCleared,
  onPageDeleted,
  onNotebookDeleted,
  onPageCreated,
  onPageRenamed,
  onNotebookCreated,
  onNotebookRenamed,
  onMessageDeleted,
  onMessageEdited,
  onMessagePinned,
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const pageIdRef = useRef(pageId);
  const onMessageRef = useRef(onMessage);
  const onConnectedCountRef = useRef(onConnectedCount);
  const onPageTouchedRef = useRef(onPageTouched);
  const onMessagesClearedRef = useRef(onMessagesCleared);
  const onPageDeletedRef = useRef(onPageDeleted);
  const onNotebookDeletedRef = useRef(onNotebookDeleted);
  const onPageCreatedRef = useRef(onPageCreated);
  const onPageRenamedRef = useRef(onPageRenamed);
  const onNotebookCreatedRef = useRef(onNotebookCreated);
  const onNotebookRenamedRef = useRef(onNotebookRenamed);
  const onMessageDeletedRef = useRef(onMessageDeleted);
  const onMessageEditedRef = useRef(onMessageEdited);
  const onMessagePinnedRef = useRef(onMessagePinned);
  const connectRef = useRef<() => void>(() => {});

  useEffect(() => { pageIdRef.current = pageId; }, [pageId]);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);
  useEffect(() => { onConnectedCountRef.current = onConnectedCount; }, [onConnectedCount]);
  useEffect(() => { onPageTouchedRef.current = onPageTouched; }, [onPageTouched]);
  useEffect(() => { onMessagesClearedRef.current = onMessagesCleared; }, [onMessagesCleared]);
  useEffect(() => { onPageDeletedRef.current = onPageDeleted; }, [onPageDeleted]);
  useEffect(() => { onNotebookDeletedRef.current = onNotebookDeleted; }, [onNotebookDeleted]);
  useEffect(() => { onPageCreatedRef.current = onPageCreated; }, [onPageCreated]);
  useEffect(() => { onPageRenamedRef.current = onPageRenamed; }, [onPageRenamed]);
  useEffect(() => { onNotebookCreatedRef.current = onNotebookCreated; }, [onNotebookCreated]);
  useEffect(() => { onNotebookRenamedRef.current = onNotebookRenamed; }, [onNotebookRenamed]);
  useEffect(() => { onMessageDeletedRef.current = onMessageDeleted; }, [onMessageDeleted]);
  useEffect(() => { onMessageEditedRef.current = onMessageEdited; }, [onMessageEdited]);
  useEffect(() => { onMessagePinnedRef.current = onMessagePinned; }, [onMessagePinned]);

  const subscribe = useCallback((ws: WebSocket) => {
    const id = pageIdRef.current;
    if (id && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "subscribe", pageId: id }));
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
        } else if (data.type === "page_touched") {
          onPageTouchedRef.current(data.pageId as string, data.notebookId as string, data.updatedAt as string);
        } else if (data.type === "messages_cleared") {
          onMessagesClearedRef.current(data.pageId as string);
        } else if (data.type === "page_deleted") {
          onPageDeletedRef.current(data.pageId as string, data.notebookId as string);
        } else if (data.type === "notebook_deleted") {
          onNotebookDeletedRef.current(data.notebookId as string);
        } else if (data.type === "page_created") {
          onPageCreatedRef.current(data.payload as Page);
        } else if (data.type === "page_renamed") {
          onPageRenamedRef.current(data.pageId as string, data.notebookId as string, data.title as string);
        } else if (data.type === "notebook_created") {
          onNotebookCreatedRef.current(data.payload);
        } else if (data.type === "notebook_renamed") {
          onNotebookRenamedRef.current(data.notebookId as string, data.title as string);
        } else if (data.type === "message_deleted") {
          onMessageDeletedRef.current(data.messageId as string, data.pageId as string);
        } else if (data.type === "message_edited") {
          onMessageEditedRef.current(data.messageId as string, data.content as string);
        } else if (data.type === "message_pinned") {
          onMessagePinnedRef.current(data.messageId as string, data.pinned as boolean);
        }
      } catch { /* ignore malformed */ }
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
  }, [pageId, subscribe]);

  const sendMessage = useCallback((content: string, deviceName: string, clientId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "message", content, deviceName, clientId }));
      return true;
    }
    return false;
  }, []);

  return { isConnected, sendMessage };
}
