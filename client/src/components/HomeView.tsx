import { useEffect, useState, useCallback } from "react";
import { Copy, Check, ArrowUpRight, RefreshCw } from "lucide-react";
import { ScrollArea } from "./ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Message } from "../types";

interface FeedItem extends Message {
  conversation_title: string;
}

interface HomeData {
  stats: { messagesToday: number; totalMessages: number; totalConversations: number };
  connectedNodes: number;
  feed: FeedItem[];
}

interface HomeViewProps {
  onNavigate: (conversationId: string, messageId: string) => void;
  refreshTrigger: number;
}

async function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch { /**/ }
  }
  const el = Object.assign(document.createElement("textarea"), {
    value: text,
    style: "position:fixed;opacity:0",
  });
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

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex-1 border border-[var(--color-border)] px-4 py-3">
      <div className="text-xl font-mono font-semibold text-[var(--color-foreground)]">{value}</div>
      <div className="text-[11px] font-mono text-[var(--color-muted-foreground)] mt-0.5">{label}</div>
    </div>
  );
}

function FeedCard({ item, onNavigate }: { item: FeedItem; onNavigate: (cid: string, mid: string) => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await copyToClipboard(item.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const preview = item.content.length > 160
    ? item.content.slice(0, 160).trimEnd() + "…"
    : item.content;

  return (
    <div className="border border-[var(--color-border)] px-3 py-2.5 hover:bg-[var(--color-muted)]/40 transition-colors">
      {/* Header row */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] font-mono px-1.5 py-0.5 border border-[var(--color-border)] text-[var(--color-muted-foreground)] rounded-sm truncate max-w-[140px]">
          {item.conversation_title}
        </span>
        <span className="text-[11px] font-mono text-[var(--color-muted-foreground)] truncate">
          {item.device_name}
        </span>
        <span className="text-[11px] font-mono text-[var(--color-muted-foreground)] opacity-50 ml-auto shrink-0">
          {formatRelative(item.created_at)}
        </span>
        {/* Actions */}
        <button
          onClick={() => onNavigate(item.conversation_id, item.id)}
          title="Abrir conversa"
          className="shrink-0 h-5 w-5 flex items-center justify-center text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
        >
          <ArrowUpRight size={12} />
        </button>
        <button
          onClick={handleCopy}
          title="Copiar"
          className={cn(
            "shrink-0 h-5 w-5 flex items-center justify-center transition-colors",
            copied ? "text-green-500" : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          )}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>

      {/* Content preview */}
      <p className="text-xs font-mono text-[var(--color-foreground)] whitespace-pre-wrap break-words leading-relaxed opacity-80">
        {preview}
      </p>
    </div>
  );
}

export function HomeView({ onNavigate, refreshTrigger }: HomeViewProps) {
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/home")
      .then((r) => r.json())
      .then((d: HomeData) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load, refreshTrigger]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden min-w-0">
      {/* Header */}
      <div
        className="flex items-center justify-between border-b border-[var(--color-border)] px-4 pb-2 shrink-0"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <span className="text-xs font-mono font-medium text-[var(--color-muted-foreground)]">
          home
        </span>
        <button
          onClick={load}
          title="Atualizar"
          className={cn(
            "h-6 w-6 flex items-center justify-center text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors",
            loading && "animate-spin opacity-50"
          )}
        >
          <RefreshCw size={13} />
        </button>
      </div>

      <ScrollArea className="flex-1">
        {data && (
          <>
            {/* Stats */}
            <div className="flex gap-2 p-4">
              <Stat value={data.stats.messagesToday} label="msgs hoje" />
              <Stat value={data.stats.totalMessages} label="total msgs" />
              <Stat value={data.stats.totalConversations} label="conversas" />
              <Stat value={data.connectedNodes} label="nodes" />
            </div>

            {/* Feed */}
            <div className="px-4 pb-4">
              <p className="text-[10px] font-mono text-[var(--color-muted-foreground)] uppercase tracking-widest mb-2">
                atividade recente
              </p>
              {data.feed.length === 0 && (
                <p className="text-[11px] font-mono text-[var(--color-muted-foreground)] opacity-60 text-center py-8">
                  sem mensagens ainda
                </p>
              )}
              <div className="flex flex-col gap-1.5">
                {data.feed.map((item) => (
                  <FeedCard key={item.id} item={item} onNavigate={onNavigate} />
                ))}
              </div>
            </div>
          </>
        )}

        {!data && !loading && (
          <p className="text-[11px] font-mono text-[var(--color-muted-foreground)] text-center py-12">
            erro ao carregar
          </p>
        )}
      </ScrollArea>
    </div>
  );
}
