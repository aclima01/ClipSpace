import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Clock, AlertTriangle, Code2, Eye, Copy, ClipboardList, Check, Trash2, Pencil, X, Pin, PinOff, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LocalMessage } from "../types";

// ── Task link plugin ───────────────────────────────────────────────────────────

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
            const parts = splitTaskLinks(child.value);
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

function splitTaskLinks(text: string): any[] {
  TASK_LINK_RE.lastIndex = 0;
  const parts: any[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = TASK_LINK_RE.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: "text", value: text.slice(last, m.index) });
    parts.push({
      type: "element",
      tagName: "a",
      properties: { className: ["task-link"], href: m[0] },
      children: [{ type: "text", value: m[0] }],
    });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}

// ── @mention highlighting ──────────────────────────────────────────────────────

const MENTION_RE = /@[\wÀ-ž]+/g;

// Rehype plugin: wraps @mention text nodes with <span class="mention">
// Defined at module level so react-markdown doesn't see a new reference each render.
function rehypeMentions() {
  return (tree: any) => {
    function walk(node: any) {
      if (!node.children) return;
      if (node.tagName === "code" || node.tagName === "pre") return;
      let i = 0;
      while (i < node.children.length) {
        const child = node.children[i];
        if (child.type === "text") {
          MENTION_RE.lastIndex = 0;
          if (MENTION_RE.test(child.value)) {
            const parts = splitMentions(child.value);
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

function splitMentions(text: string): any[] {
  MENTION_RE.lastIndex = 0;
  const parts: any[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION_RE.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: "text", value: text.slice(last, m.index) });
    parts.push({ type: "element", tagName: "span", properties: { className: ["mention"] }, children: [{ type: "text", value: m[0] }] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}

// For plain-text (code) mode: renders text with highlighted @mentions as React nodes.
function WithMentions({ text }: { text: string }) {
  MENTION_RE.lastIndex = 0;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = MENTION_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<span key={key++} className="mention">{m[0]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts.length ? parts : text}</>;
}

interface MessageBubbleProps {
  message: LocalMessage;
  isOwn: boolean;
  pageId: string;
  isTarget?: boolean;
  onDelete: () => Promise<void>;
  onEdit: (content: string) => Promise<void>;
  onPin: (pinned: boolean) => Promise<void>;
  onNavigateToTask?: (taskId: string) => void;
}

type ViewMode = "code" | "preview";

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch { /* fall through */ }
  }
  const el = document.createElement("textarea");
  el.value = text;
  el.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  document.body.appendChild(el);
  el.focus(); el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
}

async function copyHtmlToClipboard(html: string, fallbackText: string): Promise<void> {
  try {
    if (navigator.clipboard?.write) {
      const blob = new Blob([html], { type: "text/html" });
      const textBlob = new Blob([fallbackText], { type: "text/plain" });
      await navigator.clipboard.write([new ClipboardItem({ "text/html": blob, "text/plain": textBlob })]);
      return;
    }
  } catch { /* fall through */ }
  await copyToClipboard(fallbackText);
}

interface MetaButtonProps {
  icon: React.ReactNode;
  doneIcon?: React.ReactNode;
  title: string;
  active?: boolean;
  onClick: () => void;
  done?: boolean;
}

function MetaButton({ icon, doneIcon, title, active, onClick, done }: MetaButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "h-5 w-5 flex items-center justify-center rounded-md transition-colors",
        active
          ? "text-[var(--color-foreground)] bg-[var(--color-muted)]"
          : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
        done && "text-green-500"
      )}
    >
      {done ? (doneIcon ?? <Check size={11} />) : icon}
    </button>
  );
}

// Toggle the Nth checkbox in a markdown string (0-indexed)
function toggleCheckboxAt(content: string, index: number): string {
  let count = 0;
  return content.replace(/^([-*+]\s+)\[([ x])\]/gm, (match, prefix, state) => {
    if (count++ === index) return `${prefix}[${state === " " ? "x" : " "}]`;
    return match;
  });
}

export function MessageBubble({ message, isOwn, pageId, isTarget = false, onDelete, onEdit, onPin, onNavigateToTask }: MessageBubbleProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedPreview, setCopiedPreview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [improving, setImproving] = useState(false);
  const [improvedContent, setImprovedContent] = useState<string | null>(null);

  const handleCopyCode = async () => {
    await copyToClipboard(message.content);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 1500);
  };

  const handleCopyPreview = async () => {
    // Render markdown to HTML string for clipboard
    const tmp = document.createElement("div");
    tmp.className = "md-preview";
    // Build a simple HTML string from the rendered element
    const el = document.getElementById(`msg-preview-${message.id}`);
    const html = el ? el.innerHTML : message.content;
    await copyHtmlToClipboard(html, message.content);
    setCopiedPreview(true);
    setTimeout(() => setCopiedPreview(false), 1500);
  };

  const handleImprove = async () => {
    if (improving) return;
    setImprovedContent(null);
    setImproving(true);
    try {
      const res = await fetch(`/api/messages/${message.id}/improve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId }),
      });
      if (!res.ok || !res.body) { setImproving(false); return; }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let accumulated = "";
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
            const evt = JSON.parse(line.slice(6)) as { type: string; content?: string };
            if (evt.type === "token" && evt.content) {
              accumulated += evt.content;
              setImprovedContent(accumulated);
            } else if (evt.type === "done") {
              setImproving(false);
            }
          } catch { /**/ }
        }
      }
    } catch { setImproving(false); }
  };

  const isPending = message.status === "pending";
  const isFailed = message.status === "failed";

  return (
    <div
      id={`msg-${message.id}`}
      className={cn(
        "flex flex-col mb-4 transition-opacity",
        isOwn ? "items-end" : "items-start",
        isTarget && "ring-1 ring-[var(--color-ring)] rounded-xl"
      )}
    >
      {/* Bubble */}
      <div
        className={cn(
          "w-full px-3 py-2.5 text-xs break-words rounded-xl transition-opacity",
          !editMode && (viewMode === "code" ? "font-mono whitespace-pre-wrap" : "font-sans"),
          isOwn
            ? "bg-[var(--color-muted)] border border-[var(--color-border)]"
            : "bg-[var(--color-card)] border border-[var(--color-border)]",
          message.pinned && "border-l-2 border-l-amber-400/60",
          isPending && "opacity-50",
          isFailed && "opacity-40"
        )}
      >
        {editMode ? (
          <div className="flex flex-col gap-1.5">
            <textarea
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Escape") { setEditMode(false); return; }
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  const trimmed = editValue.trim();
                  if (trimmed && trimmed !== message.content) await onEdit(trimmed);
                  setEditMode(false);
                }
              }}
              className="w-full bg-transparent font-mono text-xs text-[var(--color-foreground)] resize-none outline-none border-b border-[var(--color-border)] pb-1 min-h-[4rem]"
              style={{ fieldSizing: "content" } as React.CSSProperties}
            />
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  const trimmed = editValue.trim();
                  if (trimmed && trimmed !== message.content) await onEdit(trimmed);
                  setEditMode(false);
                }}
                className="text-[10px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
              >
                salvar
              </button>
              <span className="text-[10px] font-mono text-[var(--color-muted-foreground)] opacity-40">ctrl+enter</span>
              <button
                onClick={() => setEditMode(false)}
                className="ml-auto text-[10px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
              >
                cancelar
              </button>
            </div>
          </div>
        ) : viewMode === "code" ? (
          <WithMentions text={message.content} />
        ) : (() => {
          // Local counter so each checkbox gets its sequential index during render
          let cbIdx = 0;
          return (
            <div id={`msg-preview-${message.id}`} className="md-preview">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeMentions, rehypeTaskLinks]}
                components={{
                  input: (props) => {
                    const { ref: _ref, ...rest } = props as React.InputHTMLAttributes<HTMLInputElement> & { ref?: unknown };
                    if (rest.type !== "checkbox") return <input {...rest} />;
                    const idx = cbIdx++;
                    return (
                      <input
                        type="checkbox"
                        checked={rest.checked ?? false}
                        onChange={async () => {
                          const next = toggleCheckboxAt(message.content, idx);
                          if (next !== message.content) await onEdit(next);
                        }}
                      />
                    );
                  },
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
                {message.content}
              </ReactMarkdown>
            </div>
          );
        })()}
      </div>

      {/* AI improve preview */}
      {(improving || improvedContent !== null) && (
        <div className="w-full mt-1.5 border border-[var(--color-border)] rounded-xl px-3 py-2.5 bg-[var(--color-card)]">
          {improving && !improvedContent ? (
            <div className="flex gap-1 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-muted-foreground)] opacity-60 animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-muted-foreground)] opacity-60 animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-muted-foreground)] opacity-60 animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          ) : (
            <div className="md-preview text-xs">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{improvedContent ?? ""}</ReactMarkdown>
            </div>
          )}
          {!improving && improvedContent !== null && (
            <div className="flex items-center gap-3 mt-2 pt-2 border-t border-[var(--color-border)]">
              <button
                onClick={async () => { await onEdit(improvedContent.trim()); setImprovedContent(null); }}
                className="text-[10px] text-[var(--color-foreground)] hover:opacity-70 transition-opacity"
              >
                aplicar
              </button>
              <span className="text-[10px] font-mono text-[var(--color-muted-foreground)] opacity-40">substitui in-place</span>
              <button
                onClick={() => setImprovedContent(null)}
                className="ml-auto text-[10px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
              >
                cancelar
              </button>
            </div>
          )}
        </div>
      )}

      {/* Meta row */}
      <div className={cn(
        "flex items-center flex-wrap gap-x-1.5 gap-y-0.5 mt-1",
        isOwn ? "flex-row-reverse" : "flex-row"
      )}>
        {/* Device + time */}
        <span className="text-[11px] text-[var(--color-muted-foreground)]">
          {message.device_name}
        </span>
        <span className="text-[11px] text-[var(--color-muted-foreground)] opacity-40">
          {formatTime(message.created_at)}
        </span>

        <span className="text-[var(--color-border)] text-[10px] select-none">·</span>

        {/* View toggle */}
        <button
          onClick={() => setViewMode((m) => m === "preview" ? "code" : "preview")}
          title={viewMode === "preview" ? "Ver código" : "Preview markdown"}
          className="flex items-center gap-0.5 h-5 px-1.5 rounded-md border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:border-[var(--color-muted-foreground)] transition-colors"
        >
          <Code2 size={10} className={cn(viewMode === "code" && "text-[var(--color-foreground)]")} />
          <span className="text-[9px] opacity-40">/</span>
          <Eye size={10} className={cn(viewMode === "preview" && "text-[var(--color-foreground)]")} />
        </button>

        <span className="text-[var(--color-border)] text-[10px] select-none">·</span>

        {/* Copy actions */}
        <MetaButton
          icon={<Copy size={11} />}
          title="Copiar código"
          onClick={handleCopyCode}
          done={copiedCode}
        />
        <MetaButton
          icon={<ClipboardList size={11} />}
          title="Copiar preview (HTML)"
          onClick={handleCopyPreview}
          done={copiedPreview}
        />

        <span className="text-[var(--color-border)] text-[10px] select-none">·</span>

        {/* Pin */}
        <MetaButton
          icon={message.pinned ? <PinOff size={11} /> : <Pin size={11} />}
          title={message.pinned ? "Desafixar" : "Fixar no topo"}
          active={message.pinned}
          onClick={() => onPin(!message.pinned)}
        />

        <span className="text-[var(--color-border)] text-[10px] select-none">·</span>

        {/* Edit */}
        <MetaButton
          icon={editMode ? <X size={11} /> : <Pencil size={11} />}
          title={editMode ? "Cancelar edição" : "Editar nota"}
          active={editMode}
          onClick={() => {
            if (editMode) { setEditMode(false); return; }
            setEditValue(message.content);
            setEditMode(true);
          }}
        />

        <span className="text-[var(--color-border)] text-[10px] select-none">·</span>

        {/* AI improve */}
        <MetaButton
          icon={<Wand2 size={11} />}
          title="Melhorar com AI"
          active={improving || improvedContent !== null}
          onClick={handleImprove}
        />

        <span className="text-[var(--color-border)] text-[10px] select-none">·</span>

        {/* Delete */}
        {confirmDelete ? (
          <button
            onClick={async () => { setConfirmDelete(false); await onDelete(); }}
            onBlur={() => setConfirmDelete(false)}
            autoFocus
            className="text-[10px] px-1.5 py-0.5 rounded-md border border-red-500/50 text-red-500 hover:bg-red-500/10 transition-colors"
          >
            confirmar
          </button>
        ) : (
          <MetaButton
            icon={<Trash2 size={11} />}
            title="Excluir mensagem"
            onClick={() => setConfirmDelete(true)}
          />
        )}

        {/* Status */}
        {isPending && (
          <span className="flex items-center gap-1 text-[10px] text-[var(--color-muted-foreground)] opacity-60">
            <Clock size={10} /> enviando…
          </span>
        )}
        {isFailed && (
          <span className="flex items-center gap-1 text-[10px] text-[var(--color-muted-foreground)]">
            <AlertTriangle size={10} /> não entregue
          </span>
        )}
      </div>
    </div>
  );
}
