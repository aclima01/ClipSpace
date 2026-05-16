import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { X, Send, Sparkles, RefreshCw, CheckCircle, Search, FilePlus, Copy, ClipboardList, Check, Settings2, ListChecks, Square } from "lucide-react";
import { ScrollArea } from "./ui/scroll-area";
import { cn } from "@/lib/utils";

// ── Task link rehype plugin ────────────────────────────────────────────────────

const TASK_LINK_RE = /#TK-\d+/g;

function rehypeTaskLinks() {
  return (tree: any) => {
    function walk(node: any) {
      if (!node.children) return;
      if (node.tagName === "code" || node.tagName === "pre") return;
      let i = 0;
      while (i < node.children.length) {
        const child = node.children[i];
        if (child.type === "text") {
          TASK_LINK_RE.lastIndex = 0;
          if (TASK_LINK_RE.test(child.value)) {
            const parts: any[] = [];
            TASK_LINK_RE.lastIndex = 0;
            let last = 0;
            let m: RegExpExecArray | null;
            while ((m = TASK_LINK_RE.exec(child.value)) !== null) {
              if (m.index > last) parts.push({ type: "text", value: child.value.slice(last, m.index) });
              parts.push({ type: "element", tagName: "a", properties: { className: ["task-link"], href: m[0] }, children: [{ type: "text", value: m[0] }] });
              last = m.index + m[0].length;
            }
            if (last < child.value.length) parts.push({ type: "text", value: child.value.slice(last) });
            node.children.splice(i, 1, ...parts);
            i += parts.length;
            continue;
          }
        } else {
          walk(child);
        }
        i++;
      }
    }
    walk(tree);
  };
}

interface AIAction {
  type: "posted" | "searched";
  detail: string;
}

interface AiMessage {
  role: "user" | "assistant";
  content: string;
  actions?: AIAction[];
  loading?: boolean;
}

interface AiPanelProps {
  pageId: string;
  pageTitle: string;
  notebookId: string;
  deviceName: string;
  onClose: () => void;
  onCreatePage: (content: string) => Promise<void>;
  onNavigateToTask?: (taskId: string) => void;
}

const AUTO_SUMMARY = "Resuma esta page por macro-tópico, cite as tasks abertas (- [ ] #XXXX) já existentes pelo ID sem replicá-las, e para cada uma formule uma pergunta direta de atualização — ex: \"O #0042 (@Ian) — implementar logs JSON — já foi concluído?\". Priorize Daily standup no início se houver.";

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch { /**/ }
  }
  const el = Object.assign(document.createElement("textarea"), {
    value: text, style: "position:fixed;opacity:0;pointer-events:none",
  });
  document.body.appendChild(el);
  el.focus(); el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
}

async function copyHtml(html: string, fallback: string) {
  try {
    if (navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([fallback], { type: "text/plain" }),
      })]);
      return;
    }
  } catch { /**/ }
  await copyText(fallback);
}

const PANEL_MIN = 280;
const PANEL_MAX = 760;
const PANEL_KEY = "clipspace:aiPanelWidth";
const INPUT_MIN = 60;
const INPUT_MAX = 400;
const INPUT_KEY = "clipspace:aiInputHeight";

export function AiPanel({ pageId, pageTitle, notebookId, deviceName, onClose, onCreatePage, onNavigateToTask }: AiPanelProps) {
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [configText, setConfigText] = useState("");
  const [todosOpen, setTodosOpen] = useState(false);
  const [todos, setTodos] = useState<Array<{ messageId: string; text: string; fullLine: string }>>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef<string | null>(null);

  // ── Resize (panel width + input height) ──────────────────────────────────────
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem(PANEL_KEY) ?? "", 10);
    return isNaN(saved) ? 360 : Math.min(Math.max(saved, PANEL_MIN), PANEL_MAX);
  });
  const [inputHeight, setInputHeight] = useState(() => {
    const saved = parseInt(localStorage.getItem(INPUT_KEY) ?? "", 10);
    return isNaN(saved) ? 90 : Math.min(Math.max(saved, INPUT_MIN), INPUT_MAX);
  });
  const widthDragRef = useRef<{ startX: number; startW: number } | null>(null);
  const heightDragRef = useRef<{ startY: number; startH: number } | null>(null);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (widthDragRef.current) {
        const delta = widthDragRef.current.startX - e.clientX;
        setPanelWidth(Math.min(Math.max(widthDragRef.current.startW + delta, PANEL_MIN), PANEL_MAX));
      }
      if (heightDragRef.current) {
        const delta = heightDragRef.current.startY - e.clientY;
        setInputHeight(Math.min(Math.max(heightDragRef.current.startH + delta, INPUT_MIN), INPUT_MAX));
      }
    };
    const onEnd = () => {
      if (widthDragRef.current) {
        widthDragRef.current = null;
        setPanelWidth((w) => { localStorage.setItem(PANEL_KEY, String(w)); return w; });
      }
      if (heightDragRef.current) {
        heightDragRef.current = null;
        setInputHeight((h) => { localStorage.setItem(INPUT_KEY, String(h)); return h; });
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    const onTouchMove = (e: TouchEvent) => {
      if (widthDragRef.current) {
        const delta = widthDragRef.current.startX - e.touches[0].clientX;
        setPanelWidth(Math.min(Math.max(widthDragRef.current.startW + delta, PANEL_MIN), PANEL_MAX));
      }
      if (heightDragRef.current) {
        const delta = heightDragRef.current.startY - e.touches[0].clientY;
        setInputHeight(Math.min(Math.max(heightDragRef.current.startH + delta, INPUT_MIN), INPUT_MAX));
      }
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, []);

  // ── Notebook AI config ────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/notebooks/${notebookId}/ai-config`)
      .then((r) => r.json())
      .then(({ instructions }: { instructions: string }) => setConfigText(instructions ?? ""))
      .catch(() => {});
  }, [notebookId]);

  const saveConfig = () => {
    fetch(`/api/notebooks/${notebookId}/ai-config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instructions: configText }),
    }).catch(() => {});
  };

  // ── Todos view ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!todosOpen) return;
    fetch(`/api/pages/${pageId}/messages`)
      .then((r) => r.json())
      .then((msgs: Array<{ id: string; content: string }>) => {
        const items: Array<{ messageId: string; text: string; fullLine: string }> = [];
        const re = /^([-*+]\s+\[ \]\s+)(.+)$/gm;
        for (const msg of msgs) {
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(msg.content)) !== null) {
            items.push({ messageId: msg.id, text: m[2], fullLine: m[0] });
          }
        }
        setTodos(items);
      })
      .catch(() => {});
  }, [todosOpen, pageId]);

  const markTodoDone = async (item: { messageId: string; text: string; fullLine: string }) => {
    const res = await fetch(`/api/pages/${pageId}/messages`);
    const msgs: Array<{ id: string; content: string }> = await res.json();
    const msg = msgs.find((m) => m.id === item.messageId);
    if (!msg) return;
    const newContent = msg.content.replace(item.fullLine, item.fullLine.replace("[ ]", "[x]"));
    await fetch(`/api/messages/${item.messageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: newContent }),
    });
    setTodos((prev) => prev.filter((t) => t !== item));
  };

  // ── Persist display messages to localStorage ─────────────────────────────────
  useEffect(() => {
    if (messages.length === 0) return;
    const toSave = messages.filter((m) => !m.loading);
    if (toSave.length > 0) {
      localStorage.setItem(`clipspace:ai:${pageId}`, JSON.stringify(toSave));
    }
  }, [messages, pageId]);

  // ── Session init: restore from localStorage or auto-summarize ────────────────
  useEffect(() => {
    if (initializedRef.current === pageId) return;
    initializedRef.current = pageId;
    setMessages([]);
    setInput("");

    const saved = localStorage.getItem(`clipspace:ai:${pageId}`);
    if (saved) {
      try {
        const msgs = JSON.parse(saved) as AiMessage[];
        if (msgs.length > 0) { setMessages(msgs); return; }
      } catch { /* ignore */ }
    }
    // Pre-fill the input with the suggested prompt — user confirms or edits before sending
    setInput(AUTO_SUMMARY);
  }, [pageId]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  // ── Send message ─────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (userMsg: string) => {
    if (!userMsg.trim() || loading) return;

    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setMessages((prev) => [...prev, { role: "assistant", content: "", loading: true }]);
    setLoading(true);
    scrollToBottom();

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId, message: userMsg, deviceName }),
      });

      if (!response.ok || !response.body) {
        const err = await response.json().catch(() => ({ error: "Erro desconhecido" }));
        setMessages((prev) => {
          const msgs = [...prev];
          msgs[msgs.length - 1] = { role: "assistant", content: `_Erro: ${err.error}_` };
          return msgs;
        });
        setLoading(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6)) as {
              type: string;
              content?: string;
              action?: AIAction;
              message?: string;
            };
            if (evt.type === "token" && evt.content) {
              setMessages((prev) => {
                const msgs = [...prev];
                const last = msgs[msgs.length - 1];
                if (last?.role === "assistant")
                  msgs[msgs.length - 1] = { ...last, content: last.content + evt.content, loading: false };
                return msgs;
              });
              scrollToBottom();
            } else if (evt.type === "action" && evt.action) {
              setMessages((prev) => {
                const msgs = [...prev];
                const last = msgs[msgs.length - 1];
                if (last?.role === "assistant")
                  msgs[msgs.length - 1] = { ...last, actions: [...(last.actions ?? []), evt.action!] };
                return msgs;
              });
            } else if (evt.type === "done") {
              setLoading(false);
            } else if (evt.type === "error") {
              setMessages((prev) => {
                const msgs = [...prev];
                msgs[msgs.length - 1] = { role: "assistant", content: `_Erro: ${evt.message}_` };
                return msgs;
              });
              setLoading(false);
            }
          } catch { /* skip */ }
        }
      }
    } catch {
      setMessages((prev) => {
        const msgs = [...prev];
        msgs[msgs.length - 1] = { role: "assistant", content: "_Erro de conexão._" };
        return msgs;
      });
      setLoading(false);
    }
  }, [pageId, deviceName, loading, scrollToBottom]);


  // ── Actions ───────────────────────────────────────────────────────────────────
  const lastAiContent = useMemo(
    () => [...messages].reverse().find((m) => m.role === "assistant" && m.content && !m.loading)?.content ?? "",
    [messages]
  );

  const handleSend = () => {
    const msg = input.trim();
    if (!msg) return;
    setInput("");
    sendMessage(msg);
  };

  const handleClearSession = async () => {
    localStorage.removeItem(`clipspace:ai:${pageId}`);
    initializedRef.current = null;
    await fetch(`/api/ai/session/${pageId}`, { method: "DELETE" });
    setMessages([]);
    setInput(AUTO_SUMMARY);
  };

  const handleCreatePage = async () => {
    if (!lastAiContent || creating || loading) return;
    setCreating(true);
    await onCreatePage(lastAiContent);
    setCreating(false);
  };

  return (
    <div
      className="relative flex flex-col shrink-0 border-l border-[var(--color-border)] bg-[var(--color-card)] overflow-hidden"
      style={{ width: panelWidth }}
    >
      {/* Drag handle — left edge */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize z-10 hover:bg-[var(--color-muted-foreground)]/20 transition-colors"
        onMouseDown={(e) => {
          e.preventDefault();
          widthDragRef.current = { startX: e.clientX, startW: panelWidth };
          document.body.style.cursor = "ew-resize";
          document.body.style.userSelect = "none";
        }}
        onTouchStart={(e) => {
          widthDragRef.current = { startX: e.touches[0].clientX, startW: panelWidth };
        }}
      />

      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 pb-2 border-b border-[var(--color-border)] shrink-0"
        style={{ paddingTop: "max(0.99rem, env(safe-area-inset-top))" }}
      >
        <Sparkles size={13} className="text-[#d4774e] shrink-0" />
        <span className="flex-1 min-w-0 text-[13px] font-medium text-[var(--color-muted-foreground)] truncate">
          AI · {pageTitle}
        </span>
        <button
          onClick={() => { setTodosOpen((v) => !v); setConfigOpen(false); }}
          title="To-dos abertos desta page"
          className={cn(
            "h-5 w-5 flex items-center justify-center transition-colors",
            todosOpen
              ? "text-[var(--color-foreground)]"
              : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          )}
        >
          <ListChecks size={12} />
        </button>
        <button
          onClick={() => { setConfigOpen((v) => !v); setTodosOpen(false); }}
          title="Instruções do notebook"
          className={cn(
            "h-5 w-5 flex items-center justify-center transition-colors",
            configOpen
              ? "text-[var(--color-foreground)]"
              : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          )}
        >
          <Settings2 size={12} />
        </button>
        <button
          onClick={handleCreatePage}
          disabled={!lastAiContent || creating || loading}
          title="Criar nova page com este resumo"
          className={cn(
            "h-5 w-5 flex items-center justify-center transition-colors",
            lastAiContent && !creating && !loading
              ? "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              : "opacity-30 cursor-not-allowed"
          )}
        >
          <FilePlus size={12} />
        </button>
        <button
          onClick={handleClearSession}
          title="Nova sessão"
          className="h-5 w-5 flex items-center justify-center text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
        >
          <RefreshCw size={11} />
        </button>
        <button
          onClick={onClose}
          title="Fechar"
          className="h-5 w-5 flex items-center justify-center text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      {/* Notebook AI config panel */}
      {configOpen && (
        <div className="border-b border-[var(--color-border)] px-3 py-2.5 shrink-0 bg-[var(--color-muted)]/30">
          <p className="text-[10px] font-medium text-[var(--color-muted-foreground)] uppercase tracking-widest mb-1.5">
            instruções do notebook
          </p>
          <textarea
            value={configText}
            onChange={(e) => setConfigText(e.target.value)}
            onBlur={saveConfig}
            placeholder={"Ex: Este notebook é sobre a feature X.\nSempre mencione @Alexandre nas ações de liderança.\nPriorize bloqueios antes de pendências normais."}
            rows={5}
            className="w-full resize-none bg-transparent text-xs text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)]/60 outline-none border border-[var(--color-border)] rounded-sm px-2 py-1.5"
          />
          <p className="text-[10px] text-[var(--color-muted-foreground)] opacity-50 mt-1">
            salvo automaticamente · aplicado em cada chamada da AI
          </p>
        </div>
      )}

      {/* To-dos view */}
      {todosOpen && (
        <ScrollArea className="flex-1 px-3 py-3">
          {todos.length === 0 ? (
            <p className="text-[11px] text-[var(--color-muted-foreground)] opacity-60 text-center py-8">
              nenhum to-do aberto nesta page
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {todos.map((item, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 px-2 py-1.5 rounded-sm hover:bg-[var(--color-muted)]/40 group"
                >
                  <button
                    onClick={() => markTodoDone(item)}
                    className="mt-0.5 shrink-0 text-[var(--color-muted-foreground)] hover:text-green-500 transition-colors"
                    title="Marcar como concluído"
                  >
                    <Square size={12} />
                  </button>
                  <span className="text-xs text-[var(--color-foreground)] leading-relaxed break-words flex-1">
                    {item.text}
                  </span>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      )}

      {/* Messages */}
      {!todosOpen && <ScrollArea className="flex-1 px-3 py-3">
        <div className="flex flex-col gap-4">
          {messages.map((msg, i) => (
            <div key={i} className={cn("flex flex-col gap-1", msg.role === "user" ? "items-end" : "items-start")}>
              {msg.role === "user" ? (
                <div className="max-w-[85%] bg-[var(--color-muted)] px-2.5 py-1.5 text-xs text-[var(--color-foreground)] rounded-sm whitespace-pre-wrap break-words">
                  {msg.content}
                </div>
              ) : (
                <div className="w-full">
                  {msg.actions && msg.actions.length > 0 && (
                    <div className="flex flex-col gap-1 mb-2">
                      {msg.actions.map((a, ai) => (
                        <div
                          key={ai}
                          className="flex items-center gap-1.5 text-[10px] text-[var(--color-muted-foreground)] bg-[var(--color-muted)]/50 px-2 py-1 rounded-sm border border-[var(--color-border)]"
                        >
                          {a.type === "posted" ? (
                            <CheckCircle size={10} className="text-green-500 shrink-0" />
                          ) : (
                            <Search size={10} className="shrink-0" />
                          )}
                          <span className="truncate text-[10px]">
                            {a.type === "posted" ? "postado na conversa" : `buscado: "${a.detail}"`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {msg.loading && !msg.content ? (
                    <div className="flex gap-1 py-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-muted-foreground)] opacity-60 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-muted-foreground)] opacity-60 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-muted-foreground)] opacity-60 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  ) : (
                    <>
                      <div id={`ai-msg-${i}`} className="md-preview text-xs">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[rehypeTaskLinks]}
                          components={{
                            a: ({ href, children }) => {
                              if (href?.startsWith("#TK-") && onNavigateToTask) {
                                return (
                                  <a
                                    className="task-link"
                                    href={href}
                                    onClick={(e) => { e.preventDefault(); onNavigateToTask(href.slice(1)); }}
                                  >
                                    {children}
                                  </a>
                                );
                              }
                              return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
                            },
                          }}
                        >
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                      {msg.content && (
                        <div className="flex items-center gap-1 mt-1.5">
                          <button
                            onClick={async () => {
                              await copyText(msg.content);
                              setCopied(`md-${i}`);
                              setTimeout(() => setCopied(null), 1500);
                            }}
                            title="Copiar markdown"
                            className="h-4 w-4 flex items-center justify-center text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
                          >
                            {copied === `md-${i}` ? <Check size={10} /> : <Copy size={10} />}
                          </button>
                          <button
                            onClick={async () => {
                              const el = document.getElementById(`ai-msg-${i}`);
                              await copyHtml(el?.innerHTML ?? msg.content, msg.content);
                              setCopied(`html-${i}`);
                              setTimeout(() => setCopied(null), 1500);
                            }}
                            title="Copiar HTML"
                            className="h-4 w-4 flex items-center justify-center text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
                          >
                            {copied === `html-${i}` ? <Check size={10} /> : <ClipboardList size={10} />}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>}

      {/* Input drag handle */}
      <div
        className="group shrink-0 flex items-center justify-center border-t border-[var(--color-border)] cursor-ns-resize select-none"
        style={{ height: 8 }}
        onMouseDown={(e) => {
          e.preventDefault();
          heightDragRef.current = { startY: e.clientY, startH: inputHeight };
          document.body.style.cursor = "ns-resize";
          document.body.style.userSelect = "none";
        }}
        onTouchStart={(e) => {
          heightDragRef.current = { startY: e.touches[0].clientY, startH: inputHeight };
        }}
      >
        <div className="h-px w-8 bg-[var(--color-border)] group-hover:bg-[var(--color-muted-foreground)] transition-colors rounded-full" />
      </div>

      {/* Input */}
      <div
        className="flex flex-col px-3 pt-2 shrink-0"
        style={{ height: inputHeight, paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      >
        <div className="flex gap-1.5 flex-1 min-h-0">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Pergunte algo… (Ctrl+Enter)"
            disabled={loading}
            className="flex-1 h-full resize-none bg-transparent text-xs text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] outline-none border border-[var(--color-border)] rounded-sm px-2 py-1.5 disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            title="Enviar (Ctrl+Enter)"
            className="h-7 w-7 flex items-center justify-center shrink-0 self-end text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] disabled:opacity-30 transition-colors"
          >
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
