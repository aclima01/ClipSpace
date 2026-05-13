import { useEffect, useRef, useState, useCallback } from "react";
import { Send, PanelLeft, PanelLeftClose, Eraser, Trash2 } from "lucide-react";
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
}: ChatAreaProps) {
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!conversation) { setMessages([]); return; }
    fetch(`/api/conversations/${conversation.id}/messages`)
      .then((r) => r.json())
      .then((msgs: LocalMessage[]) =>
        setMessages(msgs.map((m) => ({ ...m, status: "confirmed" as const })))
      )
      .catch(console.error);
  }, [conversation?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

  const { sendMessage } = useWebSocket({
    conversationId: conversation?.id ?? null,
    onMessage: handleIncoming,
    onConnectedCount,
    onConversationTouched,
    onMessagesCleared: handleMessagesCleared,
    onConversationDeleted: handleConversationDeleted,
    onConversationCreated,
  });

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
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
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
        <span className="text-xs font-mono font-medium truncate">
          {conversation?.title ?? "—"}
        </span>
        {conversation && (
          <div className="flex items-center gap-0.5 ml-auto shrink-0">
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
          </div>
        )}
      </div>

      {!conversation ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-xs font-mono text-[var(--color-muted-foreground)]">
            — selecione ou crie uma conversa —
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
              />
            ))}
            <div ref={bottomRef} />
          </ScrollArea>

          {/* Input — padding-bottom absorbs iOS home indicator */}
          <div
            className="border-t border-[var(--color-border)] px-3 pt-3 shrink-0"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          >
            <div className="flex items-end gap-2">
              <Textarea
                ref={textareaRef}
                value={text}
                onChange={handleTextChange}
                onKeyDown={handleKeyDown}
                placeholder="colar ou escrever aqui…"
                className="flex-1 min-h-[40px] max-h-[120px]"
                rows={1}
              />
              <Button
                size="icon"
                variant="outline"
                onClick={handleSend}
                disabled={!text.trim()}
                title="Enviar (Ctrl+Enter)"
                className="shrink-0"
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
