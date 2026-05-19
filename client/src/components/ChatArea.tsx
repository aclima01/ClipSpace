import { useEffect, useRef, useState, useCallback } from "react";
import { Send, PanelLeft, PanelLeftClose, Eraser, Trash2, Search, Sparkles, Pin, ChevronDown, FileText } from "lucide-react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { ScrollArea } from "./ui/scroll-area";
import { MessageBubble } from "./MessageBubble";
import { AiPanel } from "./AiPanel";
import { useWebSocket } from "../hooks/useWebSocket";
import { randomUUID, cn } from "@/lib/utils";
import { saveCache, loadCache, enqueueMessage } from "@/lib/offlineCache";
import type { Page, LocalMessage } from "../types";

const CONFIRM_TIMEOUT_MS = 5000;

function ServerStatusBadge({ serverOnline, syncing }: { serverOnline: boolean; syncing: boolean }) {
  if (syncing) return (
    <span className="shrink-0 flex items-center gap-1 font-mono text-[11px] text-amber-500/80">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
      sincronizando
    </span>
  );
  if (serverOnline) return (
    <span className="shrink-0 flex items-center gap-1 font-mono text-[11px] text-green-500/70">
      <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
      online
    </span>
  );
  return (
    <span className="shrink-0 flex items-center gap-1 font-mono text-[11px] text-red-500/70">
      <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
      offline
    </span>
  );
}

interface ChatAreaProps {
  page: Page | null;
  deviceName: string;
  onConnectedCount: (count: number) => void;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  onMessageConfirmed: (pageId: string, notebookId: string) => void;
  onPageTouched: (pageId: string, notebookId: string, updatedAt: string) => void;
  onMessagesCleared: (pageId: string) => void;
  onPageDeleted: (pageId: string, notebookId: string) => void;
  onNotebookDeleted: (notebookId: string) => void;
  onPageCreated: (page: Page) => void;
  onNotebookCreated: (notebook: { id: string; title: string; created_at: string; updated_at: string }) => void;
  targetMessageId: string | null;
  onTargetReached: () => void;
  onOpenSearch: () => void;
  onPageRenamed: (pageId: string, notebookId: string, title: string) => void;
  onNotebookRenamed: (notebookId: string, title: string) => void;
  onMessageDeleted: (messageId: string) => void;
  onCreatePageFromSummary: (content: string) => Promise<void>;
  onNavigateToTask: (taskId: string) => void;
  homeStats: { messagesToday: number; openTodos: number; totalPages: number; totalNotebooks: number } | null;
  serverOnline: boolean;
  syncing: boolean;
  refreshTrigger: number;
}

export function ChatArea({
  page,
  deviceName,
  onConnectedCount,
  onToggleSidebar,
  sidebarOpen,
  onMessageConfirmed,
  onPageTouched,
  onMessagesCleared,
  onPageDeleted,
  onNotebookDeleted,
  onPageCreated,
  onNotebookCreated,
  targetMessageId,
  onTargetReached,
  onOpenSearch,
  onPageRenamed,
  onNotebookRenamed,
  onMessageDeleted,
  onCreatePageFromSummary,
  onNavigateToTask,
  homeStats,
  serverOnline,
  syncing,
  refreshTrigger,
}: ChatAreaProps) {
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [text, setText] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [pinnedExpanded, setPinnedExpanded] = useState(true);
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
    if (!page) { setMessages([]); return; }
    fetch(`/api/pages/${page.id}/messages`)
      .then((r) => r.json())
      .then(async (msgs: LocalMessage[]) => {
        const confirmed = msgs.map((m) => ({ ...m, status: "confirmed" as const }));
        setMessages(confirmed);
        await saveCache(`messages:${page.id}`, msgs);
      })
      .catch(async () => {
        const cached = await loadCache<LocalMessage[]>(`messages:${page.id}`);
        if (cached) setMessages(cached.map((m) => ({ ...m, status: "confirmed" as const })));
      });
  }, [page?.id, refreshTrigger]);

  useEffect(() => {
    if (targetMessageId) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, targetMessageId]);

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
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, { ...msg, status: "confirmed" }];
    });
    onMessageConfirmed(msg.page_id, page?.notebook_id ?? "");
  }, [onMessageConfirmed, page?.notebook_id]);

  const handleMessagesCleared = useCallback((pageId: string) => {
    if (pageId === page?.id) setMessages([]);
    onMessagesCleared(pageId);
  }, [page?.id, onMessagesCleared]);

  const handlePageDeleted = useCallback((pageId: string, notebookId: string) => {
    if (pageId === page?.id) setMessages([]);
    onPageDeleted(pageId, notebookId);
  }, [page?.id, onPageDeleted]);

  const handleMessageDeleted = useCallback((messageId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    onMessageDeleted(messageId);
  }, [onMessageDeleted]);

  const handleMessageEdited = useCallback((messageId: string, content: string) => {
    setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, content } : m));
  }, []);

  const handleMessagePinned = useCallback((messageId: string, pinned: boolean) => {
    setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, pinned } : m));
  }, []);

  const { sendMessage } = useWebSocket({
    pageId: page?.id ?? null,
    onMessage: handleIncoming,
    onConnectedCount,
    onPageTouched,
    onMessagesCleared: handleMessagesCleared,
    onPageDeleted: handlePageDeleted,
    onNotebookDeleted,
    onPageCreated,
    onPageRenamed,
    onNotebookCreated,
    onNotebookRenamed,
    onMessageDeleted: handleMessageDeleted,
    onMessageEdited: handleMessageEdited,
    onMessagePinned: handleMessagePinned,
  });

  const startTitleEdit = () => {
    if (!page) return;
    setTitleValue(page.title);
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.select(), 0);
  };

  const commitTitleEdit = async () => {
    setEditingTitle(false);
    const trimmed = titleValue.trim();
    if (!trimmed || !page || trimmed === page.title) return;
    await fetch(`/api/pages/${page.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmed }),
    });
  };

  const handleClearMessages = async () => {
    if (!page) return;
    if (!confirm("Limpar todas as notas desta page?")) return;
    await fetch(`/api/pages/${page.id}/messages`, { method: "DELETE" });
  };

  const handleDeletePage = async () => {
    if (!page) return;
    if (!confirm(`Excluir a page "${page.title}"?`)) return;
    await fetch(`/api/pages/${page.id}`, { method: "DELETE" });
  };

  const handleSend = () => {
    const content = text.trim();
    if (!content || !page) return;

    const clientId = randomUUID();
    const optimistic: LocalMessage = {
      id: clientId,
      page_id: page.id,
      content,
      device_name: deviceName,
      created_at: new Date().toISOString(),
      pinned: false,
      clientId,
      status: "pending",
    };

    setMessages((prev) => [...prev, optimistic]);
    setText("");
    textareaRef.current?.focus();

    const sent = sendMessage(content, deviceName, clientId);

    if (!sent) {
      if (!serverOnline) {
        enqueueMessage({ id: clientId, pageId: page.id, content, deviceName, createdAt: new Date().toISOString() });
        // stays "pending" until sync
      } else {
        setMessages((prev) =>
          prev.map((m) => (m.clientId === clientId ? { ...m, status: "failed" } : m))
        );
      }
      return;
    }

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

  return (
    <div className="flex flex-1 overflow-hidden min-w-0">
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* Header */}
        <div
          className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 pb-2 shrink-0"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <Button size="icon" variant="ghost" onClick={onToggleSidebar} title={sidebarOpen ? "Fechar menu" : "Abrir menu"} className="h-6 w-6 shrink-0">
            {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeft size={14} />}
          </Button>
          <FileText size={13} className="shrink-0 text-[var(--color-muted-foreground)]" />
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
              className="shrink-0 max-w-[180px] bg-transparent text-[13px] font-medium text-[var(--color-foreground)] outline-none border-b border-[var(--color-border)] pb-px"
            />
          ) : (
            <button
              className="shrink-0 max-w-[180px] text-left text-[13px] font-medium truncate hover:opacity-70 transition-opacity"
              onClick={startTitleEdit}
              title="Clique para renomear"
            >
              {page?.title ?? "—"}
            </button>
          )}
          {/* Statusline */}
          <div className="flex items-center flex-1 min-w-0 overflow-hidden ml-1 gap-0 font-mono text-[11px] text-[var(--color-muted-foreground)]">
            {homeStats ? (
              <>
                <span className="shrink-0">{homeStats.messagesToday} notes hoje</span>
                <span className="mx-2 opacity-30 shrink-0">·</span>
                <span className={cn("shrink-0", homeStats.openTodos > 0 ? "text-amber-500/80" : "")}>{homeStats.openTodos} to-dos</span>
                <span className="mx-2 opacity-30 shrink-0">·</span>
                <span className="shrink-0">{homeStats.totalPages} pages</span>
                <span className="mx-2 opacity-30 shrink-0">·</span>
                <span className="shrink-0">{homeStats.totalNotebooks} notebooks</span>
              </>
            ) : (
              <span className="opacity-30">—</span>
            )}
          </div>
          {/* Server status indicator */}
          <ServerStatusBadge serverOnline={serverOnline} syncing={syncing} />
          {/* Actions */}
          <div className="flex items-center gap-0.5 shrink-0">
            <Button size="icon" variant="ghost" className="h-6 w-6 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]" onClick={onOpenSearch} title="Buscar (Ctrl+K)">
              <Search size={13} />
            </Button>
            {page && (
              <>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]" onClick={handleClearMessages} title="Limpar notas">
                  <Eraser size={13} />
                </Button>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]" onClick={handleDeletePage} title="Excluir page">
                  <Trash2 size={13} />
                </Button>
                <Button size="icon" variant="ghost" className={cn("h-6 w-6 transition-colors", aiOpen ? "bg-[var(--color-muted)]" : "hover:bg-[var(--color-muted)]")} onClick={() => setAiOpen((v) => !v)} title="Painel AI">
                  <Sparkles size={13} className="text-[#d4774e]" />
                </Button>
              </>
            )}
          </div>
        </div>

        {!page ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-[13px] text-[var(--color-muted-foreground)]">
              — selecione ou crie uma page —
            </p>
          </div>
        ) : (
          <>
            {/* Pinned messages section */}
            {messages.some((m) => m.pinned) && (
              <div className="border-b border-[var(--color-border)] shrink-0">
                <button
                  className="flex items-center gap-1.5 w-full px-5 py-1.5 text-[11px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
                  onClick={() => setPinnedExpanded((v) => !v)}
                >
                  <Pin size={9} />
                  <span className="text-[11px]">fixadas ({messages.filter((m) => m.pinned).length})</span>
                  <ChevronDown
                    size={10}
                    className={cn("ml-auto transition-transform duration-150", pinnedExpanded && "rotate-180")}
                  />
                </button>
                {pinnedExpanded && (
                  <div className="px-5 pb-2 flex flex-col gap-1.5">
                    {messages.filter((m) => m.pinned).map((msg) => (
                      <div key={msg.id} className="flex items-start gap-2 group">
                        <Pin size={9} className="text-amber-400/60 shrink-0 mt-1" />
                        <p className="text-[11px] text-[var(--color-foreground)] flex-1 line-clamp-2 leading-relaxed break-words">
                          {msg.content.replace(/^#+ /gm, "").slice(0, 120)}
                        </p>
                        <button
                          onClick={async () => {
                            await fetch(`/api/messages/${msg.id}/pin`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ pinned: false }),
                            });
                          }}
                          title="Desafixar"
                          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                        >
                          <ChevronDown size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <ScrollArea className="flex-1 px-5 py-5">
              {messages.length === 0 && (
                <p className="text-center text-[12px] text-[var(--color-muted-foreground)] mt-8 opacity-60">
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
                  onEdit={async (content) => {
                    await fetch(`/api/messages/${msg.id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ content }),
                    });
                  }}
                  onPin={async (pinned) => {
                    await fetch(`/api/messages/${msg.id}/pin`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ pinned }),
                    });
                  }}
                  onNavigateToTask={onNavigateToTask}
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

            {/* Input panel */}
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
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="colar ou escrever aqui…"
                  className="flex-1 h-full resize-none"
                />
                <Button
                  size="icon"
                  variant="default"
                  onClick={handleSend}
                  disabled={!text.trim()}
                  title="Enviar (Ctrl+Enter)"
                  className="shrink-0 self-end"
                >
                  <Send size={13} />
                </Button>
              </div>
              <p className="mt-1 text-[11px] text-[var(--color-muted-foreground)] opacity-60">
                ctrl+enter para enviar
              </p>
            </div>
          </>
        )}
      </div>
      {aiOpen && page && (
        <AiPanel
          pageId={page.id}
          pageTitle={page.title}
          notebookId={page.notebook_id}
          deviceName={deviceName}
          onClose={() => setAiOpen(false)}
          onCreatePage={onCreatePageFromSummary}
          onNavigateToTask={onNavigateToTask}
        />
      )}
    </div>
  );
}
