import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Clock, AlertTriangle, Code2, Eye, Copy, ClipboardList, Check, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LocalMessage } from "../types";

interface MessageBubbleProps {
  message: LocalMessage;
  isOwn: boolean;
  isTarget?: boolean;
  onDelete: () => Promise<void>;
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
        "h-5 w-5 flex items-center justify-center rounded-sm transition-colors",
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

export function MessageBubble({ message, isOwn, isTarget = false, onDelete }: MessageBubbleProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedPreview, setCopiedPreview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  const isPending = message.status === "pending";
  const isFailed = message.status === "failed";

  return (
    <div
      id={`msg-${message.id}`}
      className={cn(
        "flex flex-col mb-4 transition-opacity",
        isOwn ? "items-end" : "items-start",
        isTarget && "ring-1 ring-[var(--color-ring)] rounded-sm"
      )}
    >
      {/* Bubble */}
      <div
        className={cn(
          "w-full px-3 py-2 text-xs break-words rounded-sm transition-opacity",
          viewMode === "code" ? "font-mono whitespace-pre-wrap" : "font-sans",
          isOwn
            ? "bg-[var(--color-muted)] border-r-2 border-[var(--color-border)]"
            : "bg-[var(--color-card)] border border-[var(--color-border)]",
          isPending && "opacity-50",
          isFailed && "opacity-40"
        )}
      >
        {viewMode === "code" ? (
          message.content
        ) : (
          <div id={`msg-preview-${message.id}`} className="md-preview">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </div>
        )}
      </div>

      {/* Meta row */}
      <div className={cn(
        "flex items-center flex-wrap gap-x-1.5 gap-y-0.5 mt-1",
        isOwn ? "flex-row-reverse" : "flex-row"
      )}>
        {/* Device + time */}
        <span className="text-[11px] font-mono text-[var(--color-muted-foreground)]">
          {message.device_name}
        </span>
        <span className="text-[11px] font-mono text-[var(--color-muted-foreground)] opacity-50">
          {formatTime(message.created_at)}
        </span>

        <span className="text-[var(--color-border)] text-[10px] select-none">·</span>

        {/* View toggle */}
        <button
          onClick={() => setViewMode((m) => m === "preview" ? "code" : "preview")}
          title={viewMode === "preview" ? "Ver código" : "Preview markdown"}
          className="flex items-center gap-0.5 h-5 px-1.5 rounded-sm border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:border-[var(--color-muted-foreground)] transition-colors"
        >
          <Code2 size={10} className={cn(viewMode === "code" && "text-[var(--color-foreground)]")} />
          <span className="text-[9px] font-mono opacity-40">/</span>
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

        {/* Delete */}
        {confirmDelete ? (
          <button
            onClick={async () => { setConfirmDelete(false); await onDelete(); }}
            onBlur={() => setConfirmDelete(false)}
            autoFocus
            className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm border border-red-500/50 text-red-500 hover:bg-red-500/10 transition-colors"
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
          <span className="flex items-center gap-1 text-[10px] font-mono text-[var(--color-muted-foreground)] opacity-60">
            <Clock size={10} /> enviando…
          </span>
        )}
        {isFailed && (
          <span className="flex items-center gap-1 text-[10px] font-mono text-[var(--color-muted-foreground)]">
            <AlertTriangle size={10} /> não entregue
          </span>
        )}
      </div>
    </div>
  );
}
