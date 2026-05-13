import { useEffect, useRef, useState, useCallback } from "react";
import Highlighter from "react-highlight-words";
import { Search, MessageSquare, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Conversation, Message } from "../types";

interface MessageResult extends Message {
  conversation_title: string;
}

interface Results {
  conversations: Conversation[];
  messages: MessageResult[];
}

interface SearchOverlayProps {
  onSelectConversation: (id: string) => void;
  onSelectMessage: (conversationId: string, messageId: string) => void;
  onClose: () => void;
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SearchOverlay({ onSelectConversation, onSelectMessage, onClose }: SearchOverlayProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results>({ conversations: [], messages: [] });
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doSearch = useCallback((q: string) => {
    if (!q.trim()) { setResults({ conversations: [], messages: [] }); return; }
    setLoading(true);
    fetch(`/api/search?q=${encodeURIComponent(q)}`)
      .then((r) => r.json())
      .then((data: Results) => { setResults(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(q), 200);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  };

  const hasResults = results.conversations.length > 0 || results.messages.length > 0;
  const searched = query.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{ paddingTop: "max(4rem, env(safe-area-inset-top) + 3rem)" }}
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Panel */}
      <div
        className="relative w-full max-w-lg mx-4 bg-[var(--color-card)] border border-[var(--color-border)] shadow-xl flex flex-col overflow-hidden"
        style={{ maxHeight: "70dvh", borderRadius: 4 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--color-border)]">
          <Search size={13} className="text-[var(--color-muted-foreground)] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="buscar conversas e mensagens…"
            className="flex-1 bg-transparent text-xs font-mono text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] outline-none"
          />
          {loading && (
            <span className="text-[10px] font-mono text-[var(--color-muted-foreground)]">…</span>
          )}
          <kbd className="text-[10px] font-mono text-[var(--color-muted-foreground)] border border-[var(--color-border)] px-1 rounded-sm">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div className="overflow-y-auto">
          {searched && !hasResults && !loading && (
            <p className="px-3 py-6 text-center text-[11px] font-mono text-[var(--color-muted-foreground)] opacity-60">
              nenhum resultado para "{query}"
            </p>
          )}

          {!searched && (
            <p className="px-3 py-6 text-center text-[11px] font-mono text-[var(--color-muted-foreground)] opacity-60">
              ctrl+k para buscar
            </p>
          )}

          {/* Conversations */}
          {results.conversations.length > 0 && (
            <section>
              <p className="px-3 pt-3 pb-1 text-[10px] font-mono text-[var(--color-muted-foreground)] uppercase tracking-widest">
                conversas
              </p>
              {results.conversations.map((conv) => (
                <button
                  key={conv.id}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--color-muted)] transition-colors"
                  onClick={() => { onSelectConversation(conv.id); onClose(); }}
                >
                  <FolderOpen size={12} className="text-[var(--color-muted-foreground)] shrink-0" />
                  <span className="text-xs font-mono truncate flex-1">
                    <Highlighter
                      searchWords={[query]}
                      textToHighlight={conv.title}
                      highlightClassName="search-highlight"
                      autoEscape
                    />
                  </span>
                  <span className="text-[10px] font-mono text-[var(--color-muted-foreground)] shrink-0">
                    {formatTime(conv.updated_at)}
                  </span>
                </button>
              ))}
            </section>
          )}

          {/* Messages */}
          {results.messages.length > 0 && (
            <section className="pb-2">
              <p className="px-3 pt-3 pb-1 text-[10px] font-mono text-[var(--color-muted-foreground)] uppercase tracking-widest">
                mensagens
              </p>
              {results.messages.map((msg) => (
                <button
                  key={msg.id}
                  className="w-full flex flex-col gap-0.5 px-3 py-2 text-left hover:bg-[var(--color-muted)] transition-colors"
                  onClick={() => { onSelectMessage(msg.conversation_id, msg.id); onClose(); }}
                >
                  <div className="flex items-center gap-2">
                    <MessageSquare size={11} className="text-[var(--color-muted-foreground)] shrink-0" />
                    <span className={cn(
                      "text-[10px] font-mono truncate",
                      "text-[var(--color-muted-foreground)]"
                    )}>
                      {msg.conversation_title}
                    </span>
                    <span className="text-[10px] font-mono text-[var(--color-muted-foreground)] ml-auto shrink-0">
                      {formatTime(msg.created_at)}
                    </span>
                  </div>
                  <p className="text-[11px] font-mono text-[var(--color-foreground)] line-clamp-2 pl-[19px]">
                    <Highlighter
                      searchWords={[query]}
                      textToHighlight={msg.content}
                      highlightClassName="search-highlight"
                      autoEscape
                    />
                  </p>
                </button>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
