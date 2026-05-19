import { useEffect, useState, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Check, ArrowUpRight, RefreshCw, PanelLeft, PanelLeftClose, Sparkles, Square, Eye, Code2, House } from "lucide-react";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { cn } from "@/lib/utils";
import { saveCache, loadCache } from "@/lib/offlineCache";
import type { Message } from "../types";

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

// ── Staleness helpers ──────────────────────────────────────────────────────────

function staleDays(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

function staleBorderClass(iso: string): string {
  const d = staleDays(iso);
  if (d < 2) return "border-l-green-500/70";
  if (d < 7) return "border-l-amber-500/60";
  return "border-l-red-500/70";
}

function staleDotClass(iso: string): string {
  const d = staleDays(iso);
  if (d < 2) return "bg-green-500/80";
  if (d < 7) return "bg-amber-500/70";
  return "bg-red-500/80";
}

function staleLabel(iso: string): string | null {
  const d = staleDays(iso);
  if (d >= 7) return `⚠ ${d}d`;
  if (d >= 2) return `${d}d`;
  return null;
}

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

const LAST_VISIT_KEY = "clipspace:lastVisit";

interface FeedItem extends Message {
  page_title: string;
  notebook_title: string;
  notebook_id: string;
}

interface HomeData {
  stats: { messagesToday: number; openTodos: number; totalPages: number; totalNotebooks: number };
  connectedNodes: number;
  feed: FeedItem[];
}

interface TodoGroup {
  notebookId: string;
  notebookTitle: string;
  pageId: string;
  pageTitle: string;
  pageUpdatedAt: string;
  items: string[];
}

interface RecentPage {
  notebookId: string;
  notebookTitle: string;
  pageId: string;
  pageTitle: string;
  updatedAt: string;
  newMessages: number;
}

interface BriefingData {
  openTodos: TodoGroup[];
  recentPages: RecentPage[];
}

interface HomeStats {
  messagesToday: number;
  openTodos: number;
  totalPages: number;
  totalNotebooks: number;
}

interface HomeViewProps {
  onNavigate: (pageId: string, messageId: string) => void;
  refreshTrigger: number;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  serverOnline: boolean;
  syncing: boolean;
  onStatsUpdated: (stats: HomeStats) => void;
  activeSection: "briefing" | "todos" | "feed";
}

async function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch { /**/ }
  }
  const el = Object.assign(document.createElement("textarea"), { value: text, style: "position:fixed;opacity:0" });
  document.body.appendChild(el);
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}


function FeedCard({ item, onNavigate, onNavigateToTask }: {
  item: FeedItem;
  onNavigate: (pid: string, mid: string) => void;
  onNavigateToTask: (taskId: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const preview = item.content.length > 160 ? item.content.slice(0, 160).trimEnd() + "…" : item.content;

  return (
    <div className={cn("bg-[var(--color-card)] border border-[var(--color-border)] border-l-2 rounded-xl px-3 py-2.5 hover:bg-[var(--color-muted)] transition-colors", staleBorderClass(item.created_at))}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] px-1.5 py-0.5 bg-[var(--color-muted)] border border-[var(--color-border)] text-[var(--color-muted-foreground)] rounded-md truncate max-w-[140px]">
          {item.notebook_title} / {item.page_title}
        </span>
        <span className="text-[11px] text-[var(--color-muted-foreground)] truncate">{item.device_name}</span>
        <span className="text-[11px] text-[var(--color-muted-foreground)] opacity-50 ml-auto shrink-0">{formatRelative(item.created_at)}</span>
        <button
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? "Recolher" : "Expandir preview"}
          className="shrink-0 h-5 w-5 flex items-center justify-center text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
        >
          {expanded ? <Code2 size={11} /> : <Eye size={11} />}
        </button>
        <button onClick={() => onNavigate(item.page_id, item.id)} title="Abrir" className="shrink-0 h-5 w-5 flex items-center justify-center text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors">
          <ArrowUpRight size={12} />
        </button>
        <button onClick={async () => { await copyToClipboard(item.content); setCopied(true); setTimeout(() => setCopied(false), 1500); }} title="Copiar"
          className={cn("shrink-0 h-5 w-5 flex items-center justify-center transition-colors", copied ? "text-green-500" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]")}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
      {expanded ? (
        <div className="md-preview text-xs opacity-90">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeTaskLinks]}
            components={{
              a: ({ href, children }) => {
                if (href?.startsWith("#TK-")) {
                  return (
                    <a className="task-link" href={href} onClick={(e) => { e.preventDefault(); onNavigateToTask(href.slice(1)); }}>
                      {children}
                    </a>
                  );
                }
                return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
              },
            }}
          >
            {item.content}
          </ReactMarkdown>
        </div>
      ) : (
        <p className="text-xs text-[var(--color-foreground)] whitespace-pre-wrap break-words leading-relaxed opacity-80">{preview}</p>
      )}
    </div>
  );
}

export function HomeView({ onNavigate, refreshTrigger, onToggleSidebar, sidebarOpen, serverOnline, syncing, onStatsUpdated, activeSection }: HomeViewProps) {
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Morning Briefing ────────────────────────────────────────────────────────
  const sinceRef = useRef<string>("");
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [aiContent, setAiContent] = useState("");
  const [aiGeneratedAt, setAiGeneratedAt] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const loadAiBriefing = useCallback(() => {
    fetch("/api/briefing/ai")
      .then((r) => r.ok ? r.json() : null)
      .then((d: { content: string; generatedAt: string } | null) => {
        if (d?.content) { setAiContent(d.content); setAiGeneratedAt(d.generatedAt); }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const lastVisit = localStorage.getItem(LAST_VISIT_KEY) ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    sinceRef.current = lastVisit;

    loadAiBriefing();

    fetch(`/api/briefing?since=${encodeURIComponent(lastVisit)}`)
      .then((r) => r.json())
      .then((d: BriefingData) => setBriefing(d))
      .catch(() => {});

    // Update lastVisit on unmount
    return () => { localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString()); };
  }, [loadAiBriefing]);

  const generateAiBriefing = async () => {
    if (aiLoading) return;
    setAiContent("");
    setAiGeneratedAt(null);
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai/briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ since: sinceRef.current }),
      });
      if (!res.ok || !res.body) { setAiLoading(false); return; }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.trim().startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(part.trim().slice(6)) as { type: string; content?: string; generatedAt?: string };
            if (evt.type === "token" && evt.content) setAiContent((p) => p + evt.content);
            if (evt.type === "done") { setAiLoading(false); setAiGeneratedAt(evt.generatedAt ?? new Date().toISOString()); }
          } catch { /**/ }
        }
      }
    } catch { setAiLoading(false); }
  };

  // ── Home data ───────────────────────────────────────────────────────────────
  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/home")
      .then((r) => r.json())
      .then(async (d: HomeData) => {
        setData(d);
        setLoading(false);
        onStatsUpdated(d.stats);
        await saveCache("home", d);
      })
      .catch(async () => {
        const cached = await loadCache<HomeData>("home");
        if (cached) { setData(cached); onStatsUpdated(cached.stats); }
        setLoading(false);
      });
  }, [onStatsUpdated]);

  useEffect(() => { load(); }, [load, refreshTrigger]);

  const navigateToTask = useCallback(async (taskId: string) => {
    const res = await fetch(`/api/tasks/${taskId}`);
    if (!res.ok) return;
    const { pageId, messageId } = await res.json() as { pageId: string; messageId: string };
    onNavigate(pageId, messageId);
  }, [onNavigate]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden min-w-0">
      {/* Header */}
      <div
        className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 pb-2 shrink-0"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <Button size="icon" variant="ghost" onClick={onToggleSidebar} title={sidebarOpen ? "Fechar menu" : "Abrir menu"} className="h-6 w-6 shrink-0">
          {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeft size={14} />}
        </Button>
        <House size={13} className="shrink-0 text-[var(--color-muted-foreground)]" />
        <span className="text-[13px] font-medium shrink-0">Home</span>
        {/* Statusline */}
        <div className="flex items-center flex-1 min-w-0 overflow-hidden ml-2 gap-0 font-mono text-[11px] text-[var(--color-muted-foreground)]">
          {data ? (
            <>
              <span className="shrink-0">{data.stats.messagesToday} notes hoje</span>
              <span className="mx-2 opacity-30 shrink-0">·</span>
              <span className={cn("shrink-0", data.stats.openTodos > 0 ? "text-amber-500/80" : "")}>{data.stats.openTodos} to-dos</span>
              <span className="mx-2 opacity-30 shrink-0">·</span>
              <span className="shrink-0">{data.stats.totalPages} pages</span>
              <span className="mx-2 opacity-30 shrink-0">·</span>
              <span className="shrink-0">{data.stats.totalNotebooks} notebooks</span>
            </>
          ) : (
            <span className="opacity-30">—</span>
          )}
        </div>
        {/* Server status */}
        <ServerStatusBadge serverOnline={serverOnline} syncing={syncing} />
        <button onClick={() => { load(); loadAiBriefing(); }} title="Atualizar"
          className={cn("h-6 w-6 flex items-center justify-center text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors shrink-0", loading && "animate-spin opacity-50")}>
          <RefreshCw size={13} />
        </button>
      </div>

      <ScrollArea className="flex-1">
        {!data && !loading && (
          <p className="text-[12px] text-[var(--color-muted-foreground)] text-center py-12">erro ao carregar</p>
        )}

        {/* ── Briefing Matinal ───────────────────────────────────────────────── */}
        {activeSection === "briefing" && (
          <div className="px-4 py-4">
            {/* AI generate button */}
            <div className="flex items-center justify-end gap-2 mb-3">
              {aiGeneratedAt && !aiLoading && (
                <span className="text-[10px] text-[var(--color-muted-foreground)] opacity-50">
                  {formatRelative(aiGeneratedAt)}
                </span>
              )}
              <button
                onClick={generateAiBriefing}
                disabled={aiLoading}
                className={cn(
                  "flex items-center gap-1 text-[12px] transition-colors",
                  aiLoading
                    ? "text-[var(--color-muted-foreground)] opacity-50 cursor-default"
                    : "text-[#d4774e] hover:opacity-80"
                )}
              >
                <Sparkles size={11} />
                {aiLoading ? "gerando…" : aiContent ? "regenerar" : "gerar com AI"}
              </button>
            </div>

            {/* AI narrative */}
            {aiContent && (
              <div className="md-preview text-xs border border-[var(--color-border)] rounded-sm px-3 py-2.5 mb-3">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeTaskLinks]}
                  components={{
                    a: ({ href, children }) => {
                      if (href?.startsWith("#TK-")) {
                        return (
                          <a className="task-link" href={href} onClick={(e) => { e.preventDefault(); navigateToTask(href.slice(1)); }}>
                            {children}
                          </a>
                        );
                      }
                      return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
                    },
                  }}
                >
                  {aiContent}
                </ReactMarkdown>
              </div>
            )}

            {/* Recent pages */}
            {briefing && briefing.recentPages.length > 0 && (
              <div className="border border-[var(--color-border)] rounded-sm">
                <div className="px-3 py-2.5">
                  <p className="text-[10px] font-medium text-[var(--color-muted-foreground)] uppercase tracking-widest mb-2">
                    atividade desde sua última visita
                  </p>
                  <div className="flex flex-col gap-1">
                    {briefing.recentPages.map((page) => (
                      <button key={page.pageId} onClick={() => onNavigate(page.pageId, "")}
                        className="flex items-center gap-2 text-left hover:bg-[var(--color-muted)]/40 transition-colors rounded-sm px-1 py-0.5">
                        <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", staleDotClass(page.updatedAt))} />
                        <span className="text-[12px] text-[var(--color-foreground)] truncate flex-1">
                          {page.notebookTitle} / {page.pageTitle}
                        </span>
                        <span className="text-[10px] text-[var(--color-muted-foreground)] shrink-0">
                          {page.newMessages > 0 ? `+${page.newMessages}` : formatRelative(page.updatedAt)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {!aiContent && (!briefing || briefing.recentPages.length === 0) && !aiLoading && (
              <p className="text-[12px] text-[var(--color-muted-foreground)] opacity-50 text-center py-8">
                nenhuma informação disponível
              </p>
            )}
          </div>
        )}

        {/* ── To-dos ────────────────────────────────────────────────────────── */}
        {activeSection === "todos" && (
          <div className="px-4 py-4">
            {!briefing ? (
              <p className="text-[12px] text-[var(--color-muted-foreground)] opacity-50 text-center py-8">
                carregando…
              </p>
            ) : briefing.openTodos.length === 0 ? (
              <p className="text-[12px] text-[var(--color-muted-foreground)] opacity-50 text-center py-8">
                nenhum to-do aberto
              </p>
            ) : (
              <div className="border border-[var(--color-border)] rounded-sm">
                <div className="px-3 py-2.5">
                  <div className="flex flex-col gap-2">
                    {briefing.openTodos.map((group) => (
                      <div key={group.pageId}>
                        <div className="flex items-center gap-1.5 mb-1">
                          <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", staleDotClass(group.pageUpdatedAt))} />
                          <button onClick={() => onNavigate(group.pageId, "")}
                            className="text-[11px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors">
                            {group.notebookTitle} / {group.pageTitle}
                          </button>
                          {staleLabel(group.pageUpdatedAt) && (
                            <span className={cn("text-[9px] ml-auto shrink-0", staleDays(group.pageUpdatedAt) >= 7 ? "text-red-500" : "text-[var(--color-muted-foreground)] opacity-60")}>
                              {staleLabel(group.pageUpdatedAt)}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-col gap-0.5 pl-2">
                          {group.items.map((item, i) => {
                            const taskMatch = item.match(/#TK-\d+/);
                            const taskId = taskMatch ? taskMatch[0].slice(1) : null;
                            return (
                              <button key={i} onClick={() => taskId ? navigateToTask(taskId) : onNavigate(group.pageId, "")} className="flex items-start gap-1.5 text-left hover:opacity-70 transition-opacity">
                                <Square size={10} className="shrink-0 mt-0.5 text-[var(--color-muted-foreground)]" />
                                <span className="text-[12px] text-[var(--color-foreground)] leading-relaxed break-words">{item}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Atividade Recente ──────────────────────────────────────────────── */}
        {activeSection === "feed" && data && (
          <div className="px-4 py-4">
            {data.feed.length === 0 ? (
              <p className="text-[12px] text-[var(--color-muted-foreground)] opacity-60 text-center py-8">
                sem mensagens ainda
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {data.feed.map((item) => (
                  <FeedCard key={item.id} item={item} onNavigate={onNavigate} onNavigateToTask={navigateToTask} />
                ))}
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
