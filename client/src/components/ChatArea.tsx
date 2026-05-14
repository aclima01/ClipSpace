import { useEffect, useRef, useState, useCallback } from "react";
import { Send, PanelLeft, PanelLeftClose, Eraser, Trash2, Search } from "lucide-react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { ScrollArea } from "./ui/scroll-area";
import { MessageBubble } from "./MessageBubble";
import { useWebSocket } from "../hooks/useWebSocket";
import { randomUUID } from "@/lib/utils";
import type { Conversation, LocalMessage } from "../types";

const CONFIRM_TIMEOUT_MS = 5000;

interface ChatAreaProps {
  conversation: Conversation | null;
  deviceName: string;
  onConnectedCount: (count: number) => void;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  onMessageConfirmed: (conversationId: string) => void;
  onConversationTouched: (conversationId: string, updatedAt: string) => void;
  onMessagesCleared: (conversationId: string) => void;
  onConversationDeleted: (conversationId: string) => void;
  onConversationCreated: (conversation: { id: string; title: string; created_at: string; updated_at: string }) => void;
  targetMessageId: string | null;
  onTargetReached: () => void;
  onOpenSearch: () => void;
  onConversationRenamed: (conversationId: string, title: string) => void;
  onMessageDeleted: (messageId: string) => void;
}

export function ChatArea({
  conversation,
  deviceName,
  onConnectedCount,
  onToggleSidebar,
  sidebarOpen,
  onMessageConfirmed,
  onConversationTouched,
  onMessagesCleared,
  onConversationDeleted,
  onConversationCreated,
  targetMessageId,
  onTargetReached,
  onOpenSearch,
  onConversationRenamed,
  onMessageDeleted,
}: ChatAreaProps) {
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [text, setText] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Resizable input panel
  const PANEL_MIN = 80;
  const PANEL_MAX = 480;
  const PANEL_KEY = "clipspace:inputPanelHeight";
  const [panelHeight, setPanelHeight] = useState(() => {
    const saved = parseInt(localStorage.getItem(PANEL_KEY) ?? "", 10);
    return isNaN(saved) ? 120 : Math.min(Math.max(saved, PANEL_MIN), PANEL_MAX);
  });
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  const onDragStart = (clientY: number) => {
    dragRef.current = { startY: clientY, startH: panelHeight };
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
  };

  const onDragMove = useCallback((clientY: number) => {
    if (!dragRef.current) return;
    const delta = dragRef.current.startY - clientY;
    const next = Math.min(Math.max(dragRef.current.startH + delta, PANEL_MIN), PANEL_MAX);
    setPanelHeight(next);
  }, []);

  const onDragEnd = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    setPanelHeight((h) => { localStorage.setItem(PANEL_KEY, String(h)); return h; });
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => onDragMove(e.clientY);
    const onTouchMove = (e: TouchEvent) => onDragMove(e.touches[0].clientY);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onDragEnd);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onDragEnd);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onDragEnd);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onDragEnd);
    };
  }, [onDragMove, onDragEnd]);

  useEffect(() => {
    if (!conversation) { setMessages([]); return; }
    fetch(`/api/conversations/${conversation.id}/messages`)
      .then((r) => r.json())
      .then((msgs: LocalMessage[]) =>
        setMessages(msgs.map((m) => ({ ...m, status: "confirmed" as const })))
      )
      .catch(console.error);
  }, [conversation?.id]);

  // Scroll to bottom on new messages (skip if jumping to a specific target)
  useEffect(() => {
    if (targetMessageId) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, targetMessageId]);

  // Scroll to and flash a specific message from search
  useEffect(() => {
    if (!targetMessageId || messages.length === 0) return;
    const el = document.getElementById(`msg-${targetMessageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("search-target-flash");
    const t = setTimeout(() => {
      el.classList.remove("search-target-flash");
      onTargetReached();
    }, 1500);
    return () => clearTimeout(t);
  }, [targetMessageId, messages, onTargetReached]);

  const handleIncoming = useCallback((msg: LocalMessage) => {
    setMessages((prev) => {
      // Replace matching pending message using clientId
      if (msg.clientId) {
        const idx = prev.findIndex(
          (m) => m.status === "pending" && m.clientId === msg.clientId
        );
        if (idx !== -1) {
          const next = [...prev];
          next[idx] = { ...msg, status: "confirmed" };
          return next;
        }
      }
      // Deduplicate by server id
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, { ...msg, status: "confirmed" }];
    });
    // Bubble up so the sidebar can re-sort conversations
    onMessageConfirmed(msg.conversation_id);
  }, [onMessageConfirmed]);

  const handleMessagesCleared = useCallback((conversationId: string) => {
    if (conversationId === conversation?.id) setMessages([]);
    onMessagesCleared(conversationId);
  }, [conversation?.id, onMessagesCleared]);

  const handleConversationDeleted = useCallback((conversationId: string) => {
    if (conversationId === conversation?.id) setMessages([]);
    onConversationDeleted(conversationId);
  }, [conversation?.id, onConversationDeleted]);

  const handleMessageDeleted = useCallback((messageId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    onMessageDeleted(messageId);
  }, [onMessageDeleted]);

  const { sendMessage } = useWebSocket({
    conversationId: conversation?.id ?? null,
    onMessage: handleIncoming,
    onConnectedCount,
    onConversationTouched,
    onMessagesCleared: handleMessagesCleared,
    onConversationDeleted: handleConversationDeleted,
    onConversationCreated,
    onConversationRenamed,
    onMessageDeleted: handleMessageDeleted,
  });

  const startTitleEdit = () => {
    if (!conversation) return;
    setTitleValue(conversation.title);
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.select(), 0);
  };

  const commitTitleEdit = async () => {
    setEditingTitle(false);
    const trimmed = titleValue.trim();
    if (!trimmed || !conversation || trimmed === conversation.title) return;
    await fetch(`/api/conversations/${conversation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmed }),
    });
  };

  const handleClearMessages = async () => {
    if (!conversation) return;
    if (!confirm("Limpar todas as mensagens desta conversa?")) return;
    await fetch(`/api/conversations/${conversation.id}/messages`, { method: "DELETE" });
  };

  const handleDeleteConversation = async () => {
    if (!conversation) return;
    if (!confirm(`Excluir a conversa "${conversation.title}"?`)) return;
    await fetch(`/api/conversations/${conversation.id}`, { method: "DELETE" });
  };

  const handleSend = () => {
    const content = text.trim();
    if (!content || !conversation) return;

    const clientId = randomUUID();
    const optimistic: LocalMessage = {
      id: clientId,
      conversation_id: conversation.id,
      content,
      device_name: deviceName,
      created_at: new Date().toISOString(),
      clientId,
      status: "pending",
    };

    setMessages((prev) => [...prev, optimistic]);
    setText("");
    textareaRef.current?.focus();

    const sent = sendMessage(content, deviceName, clientId);

    // If WS send failed immediately, mark as failed right away
    if (!sent) {
      setMessages((prev) =>
        prev.map((m) => (m.clientId === clientId ? { ...m, status: "failed" } : m))
      );
      return;
    }

    // Timeout: if server hasn't confirmed after CONFIRM_TIMEOUT_MS, mark failed
    setTimeout(() => {
      setMessages((prev) =>
        prev.map((m) =>
          m.clientId === clientId && m.status === "pending"
            ? { ...m, status: "failed" }
            : m
        )
      );
    }, CONFIRM_TIMEOUT_MS);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden min-w-0">
      {/* Header — padding-top absorbs iOS status bar in standalone mode */}
      <div
        className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 pb-2 shrink-0"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <Button
          size="icon"
          variant="ghost"
          onClick={onToggleSidebar}
          title={sidebarOpen ? "Fechar menu" : "Abrir menu"}
          className="h-6 w-6 shrink-0"
        >
          {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeft size={14} />}
        </Button>
        {editingTitle ? (
          <input
            ref={titleInputRef}
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={commitTitleEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTitleEdit();
              if (e.key === "Escape") setEditingTitle(false);
            }}
            className="flex-1 min-w-0 bg-transparent text-xs font-mono font-medium text-[var(--color-foreground)] outline-none border-b border-[var(--color-border)] pb-px"
          />
        ) : (
          <button
            className="flex-1 min-w-0 text-left text-xs font-mono font-medium truncate hover:opacity-70 transition-opacity"
            onClick={startTitleEdit}
            title="Clique para renomear"
          >
            {conversation?.title ?? "—"}
          </button>
        )}
        <div className="flex items-center gap-0.5 ml-auto shrink-0">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            onClick={onOpenSearch}
            title="Buscar (Ctrl+K)"
          >
            <Search size={13} />
          </Button>
        {conversation && (
          <>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              onClick={handleClearMessages}
              title="Limpar mensagens"
            >
              <Eraser size={13} />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              onClick={handleDeleteConversation}
              title="Excluir conversa"
            >
              <Trash2 size={13} />
            </Button>
          </>
        )}
        </div>
      </div>

      {!conversation ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-xs font-mono text-[var(--color-muted-foreground)]">
            — selecione ou crie uma nota —
          </p>
        </div>
      ) : (
        <>
          <ScrollArea className="flex-1 px-5 py-5">
            {messages.length === 0 && (
              <p className="text-center text-[11px] font-mono text-[var(--color-muted-foreground)] mt-8 opacity-60">
                sem notas
              </p>
            )}
            {messages.map((msg) => (
              <MessageBubble
                key={msg.clientId ?? msg.id}
                message={msg}
                isOwn={msg.device_name === deviceName}
                isTarget={msg.id === targetMessageId}
                onDelete={async () => {
                  await fetch(`/api/messages/${msg.id}`, { method: "DELETE" });
                }}
              />
            ))}
            <div ref={bottomRef} />
          </ScrollArea>

          {/* Drag handle */}
          <div
            className="group shrink-0 flex items-center justify-center border-t border-[var(--color-border)] cursor-ns-resize select-none"
            style={{ height: 8 }}
            onMouseDown={(e) => { e.preventDefault(); onDragStart(e.clientY); }}
            onTouchStart={(e) => onDragStart(e.touches[0].clientY)}
          >
            <div className="h-px w-8 bg-[var(--color-border)] group-hover:bg-[var(--color-muted-foreground)] transition-colors rounded-full" />
          </div>

          {/* Input panel — padding-bottom absorbs iOS home indicator */}
          <div
            className="flex flex-col px-3 pt-2 shrink-0"
            style={{
              height: panelHeight,
              paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
            }}
          >
            <div className="flex gap-2 flex-1 min-h-0">
              <Textarea
                ref={textareaRef}
                value={text}
                onChange={handleTextChange}
                onKeyDown={handleKeyDown}
                placeholder="colar ou escrever aqui…"
                className="flex-1 h-full resize-none"
              />
              <Button
                size="icon"
                variant="outline"
                onClick={handleSend}
                disabled={!text.trim()}
                title="Enviar (Ctrl+Enter)"
                className="shrink-0 self-end"
              >
                <Send size={13} />
              </Button>
            </div>
            <p className="mt-1 text-[10px] font-mono text-[var(--color-muted-foreground)] opacity-60">
              ctrl+enter para enviar
            </p>
          </div>
        </>
      )}
    </div>
  );
}
