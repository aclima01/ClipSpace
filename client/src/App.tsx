import { useEffect, useState, useCallback, useRef } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatArea } from "./components/ChatArea";
import { TooltipProvider } from "./components/ui/tooltip";
import type { Conversation } from "./types";

const STORAGE_KEY = "clipspace:deviceName";

function generateDeviceName(): string {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `node-${suffix}`;
}

function loadDeviceName(): string {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) return saved;
  const name = generateDeviceName();
  localStorage.setItem(STORAGE_KEY, name);
  return name;
}

function generateTitle(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return `Notes ${dd}/${mm} ${hh}:${min}`;
}

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string>(loadDeviceName);
  const [connectedCount, setConnectedCount] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 640);
  const [unreadIds, setUnreadIds] = useState<ReadonlySet<string>>(new Set());

  // Ref so callbacks always see the latest activeId without re-creating
  const activeIdRef = useRef(activeId);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  useEffect(() => {
    fetch("/api/conversations")
      .then((r) => r.json())
      .then((data: Conversation[]) => {
        setConversations(data);
        if (data.length > 0) setActiveId(data[0].id);
      });
  }, []);

  const handleRenameDevice = (name: string) => {
    localStorage.setItem(STORAGE_KEY, name);
    setDeviceName(name);
  };

  const handleNew = async () => {
    const title = generateTitle();
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const conv: Conversation = await res.json();
    // Don't add to state here — the WS broadcast (conversation_created) does it
    // for all clients including this one. Just activate the new conversation.
    setActiveId(conv.id);
  };

  const handleRename = async (id: string, title: string) => {
    await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title } : c))
    );
  };

  const handleSelect = (id: string) => {
    setActiveId(id);
    setUnreadIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (window.innerWidth < 640) setSidebarOpen(false);
  };

  const handleConnectedCount = useCallback((count: number) => {
    setConnectedCount(count);
  }, []);

  const bringToTop = useCallback((conversationId: string, updatedAt: string) => {
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === conversationId);
      if (idx <= 0) return prev;
      const updated = { ...prev[idx], updated_at: updatedAt };
      return [updated, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });
  }, []);

  const handleMessageConfirmed = useCallback((conversationId: string) => {
    bringToTop(conversationId, new Date().toISOString());
  }, [bringToTop]);

  const handleConversationTouched = useCallback((conversationId: string, updatedAt: string) => {
    bringToTop(conversationId, updatedAt);
    if (conversationId !== activeIdRef.current) {
      setUnreadIds((prev) => {
        if (prev.has(conversationId)) return prev;
        const next = new Set(prev);
        next.add(conversationId);
        return next;
      });
    }
  }, [bringToTop]);

  const handleConversationCreated = useCallback((conv: Conversation) => {
    setConversations((prev) => {
      if (prev.some((c) => c.id === conv.id)) return prev;
      return [conv, ...prev];
    });
  }, []);

  const handleMessagesCleared = useCallback((conversationId: string) => {
    // ChatArea listens to this via WS and will clear its own message list;
    // nothing to update in App state
    void conversationId;
  }, []);

  const handleConversationDeleted = useCallback((conversationId: string) => {
    setConversations((prev) => {
      const remaining = prev.filter((c) => c.id !== conversationId);
      // If the deleted conversation was active, move to the next one
      if (activeIdRef.current === conversationId) {
        setActiveId(remaining.length > 0 ? remaining[0].id : null);
      }
      return remaining;
    });
    setUnreadIds((prev) => {
      if (!prev.has(conversationId)) return prev;
      const next = new Set(prev);
      next.delete(conversationId);
      return next;
    });
  }, []);

  const activeConv = conversations.find((c) => c.id === activeId) ?? null;

  return (
    <TooltipProvider>
      <div className="flex overflow-hidden bg-[var(--color-background)]" style={{ height: "100dvh" }}>
        <Sidebar
          open={sidebarOpen}
          conversations={conversations}
          activeId={activeId}
          onSelect={handleSelect}
          onNew={handleNew}
          onRename={handleRename}
          connectedCount={connectedCount}
          deviceName={deviceName}
          onRenameDevice={handleRenameDevice}
          unreadIds={unreadIds}
        />
        <ChatArea
          conversation={activeConv}
          deviceName={deviceName}
          onConnectedCount={handleConnectedCount}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          sidebarOpen={sidebarOpen}
          onMessageConfirmed={handleMessageConfirmed}
          onConversationTouched={handleConversationTouched}
          onConversationCreated={handleConversationCreated}
          onMessagesCleared={handleMessagesCleared}
          onConversationDeleted={handleConversationDeleted}
        />
      </div>
    </TooltipProvider>
  );
}
