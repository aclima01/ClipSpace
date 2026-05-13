import { useState } from "react";
import { Copy, Check, Clock, AlertTriangle } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import type { LocalMessage } from "../types";

interface MessageBubbleProps {
  message: LocalMessage;
  isOwn: boolean;
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function copyToClipboard(text: string): Promise<void> {
  // navigator.clipboard requires HTTPS or localhost — falls back to
  // execCommand for plain-HTTP LAN access.
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fall through
    }
  }
  const el = document.createElement("textarea");
  el.value = text;
  el.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  document.body.appendChild(el);
  el.focus();
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
}

export function MessageBubble({ message, isOwn }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await copyToClipboard(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const isPending = message.status === "pending";
  const isFailed = message.status === "failed";

  return (
    <div className={cn("flex flex-col mb-4", isOwn ? "items-end" : "items-start")}>
      {/* Bubble */}
      <div
        className={cn(
          "w-full px-3 py-2 text-xs font-mono whitespace-pre-wrap break-words rounded-sm transition-opacity",
          isOwn
            ? "bg-[var(--color-muted)] border-r-2 border-[var(--color-border)]"
            : "bg-[var(--color-card)] border border-[var(--color-border)]",
          isPending && "opacity-50",
          isFailed && "opacity-40"
        )}
      >
        {message.content}
      </div>

      {/* Meta row: device + time + copy — below the bubble */}
      <div className={cn(
        "flex items-center gap-1.5 mt-1",
        isOwn ? "flex-row-reverse" : "flex-row"
      )}>
        <span className="text-[11px] text-[var(--color-muted-foreground)] font-mono">
          {message.device_name}
        </span>
        <span className="text-[11px] text-[var(--color-muted-foreground)] opacity-50">
          {formatTime(message.created_at)}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          onClick={handleCopy}
          title="Copiar"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
        </Button>

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
