import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Conversation } from "../types";

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d`;
}

interface SidebarProps {
  open: boolean;
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  connectedCount: number;
  deviceName: string;
  onRenameDevice: (name: string) => void;
  unreadIds: ReadonlySet<string>;
}

export function Sidebar({
  open,
  conversations,
  activeId,
  onSelect,
  onNew,
  onRename,
  connectedCount,
  unreadIds,
  deviceName,
  onRenameDevice,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editingDevice, setEditingDevice] = useState(false);
  const [deviceValue, setDeviceValue] = useState("");

  const startEdit = (conv: Conversation) => {
    setEditingId(conv.id);
    setEditValue(conv.title);
  };

  const commitEdit = (id: string) => {
    if (editValue.trim()) onRename(id, editValue.trim());
    setEditingId(null);
  };

  const startDeviceEdit = () => {
    setDeviceValue(deviceName);
    setEditingDevice(true);
  };

  const commitDeviceEdit = () => {
    if (deviceValue.trim()) onRenameDevice(deviceValue.trim());
    setEditingDevice(false);
  };

  return (
    <div
      className="flex flex-col border-r border-[var(--color-border)] bg-[var(--color-card)] overflow-hidden transition-all duration-200 ease-in-out shrink-0"
      style={{ width: open ? 220 : 0 }}
    >
      {/* Inner wrapper keeps content at fixed width so it doesn't wrap during animation */}
      <div className="flex flex-col h-full" style={{ width: 220 }}>
        {/* Header — padding-top absorbs iOS status bar in standalone mode */}
        <div
          className="flex items-center justify-between px-3 pb-2.5 border-b border-[var(--color-border)]"
          style={{ paddingTop: "max(0.625rem, env(safe-area-inset-top))" }}
        >
          <span className="text-xs font-mono font-semibold tracking-widest uppercase text-[var(--color-muted-foreground)] whitespace-nowrap">
            ACL Notes
          </span>
          <Button
            size="icon"
            variant="ghost"
            onClick={onNew}
            title="Nova conversa"
            className="h-6 w-6 shrink-0"
          >
            <Plus size={13} />
          </Button>
        </div>

        {/* Status row */}
        <div className="px-3 py-1.5 border-b border-[var(--color-border)]">
          <span className="text-[11px] font-mono text-[var(--color-muted-foreground)] whitespace-nowrap">
            {connectedCount} node{connectedCount !== 1 ? "s" : ""} online
          </span>
        </div>

        {/* Conversation list */}
        <ScrollArea className="flex-1">
          <div className="py-1">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={cn(
                  "group flex cursor-pointer items-center justify-between px-3 py-1.5 text-xs font-mono transition-colors border-l-2",
                  activeId === conv.id
                    ? "border-l-[var(--color-foreground)] bg-[var(--color-muted)] text-[var(--color-foreground)]"
                    : "border-l-transparent text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                )}
                onClick={() => onSelect(conv.id)}
                onDoubleClick={() => startEdit(conv)}
              >
                {editingId === conv.id ? (
                  <Input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => commitEdit(conv.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit(conv.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-5 px-1 py-0 text-[11px]"
                  />
                ) : (
                  <>
                    <span className="truncate flex-1 leading-tight">{conv.title}</span>
                    <span className="ml-2 shrink-0 flex items-center gap-1.5">
                    {unreadIds.has(conv.id) && (
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />
                    )}
                    <span className="text-[11px] opacity-50">
                      {formatRelativeTime(conv.updated_at)}
                    </span>
                    </span>
                  </>
                )}
              </div>
            ))}

            {conversations.length === 0 && (
              <p className="px-3 py-4 text-center text-[11px] font-mono text-[var(--color-muted-foreground)]">
                nenhum nó
                <br />
                <span className="opacity-60">+ para criar</span>
              </p>
            )}
          </div>
        </ScrollArea>

        {/* Device identity — padding-bottom absorbs iOS home indicator */}
        <div
          className="border-t border-[var(--color-border)] px-3 pt-2"
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >
          <p className="text-[10px] font-mono text-[var(--color-muted-foreground)] mb-1 opacity-60">
            este dispositivo
          </p>
          {editingDevice ? (
            <Input
              autoFocus
              value={deviceValue}
              onChange={(e) => setDeviceValue(e.target.value)}
              onBlur={commitDeviceEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitDeviceEdit();
                if (e.key === "Escape") setEditingDevice(false);
              }}
              className="h-6 px-1.5 py-0 text-[11px]"
            />
          ) : (
            <button
              className="w-full text-left text-[11px] font-mono text-[var(--color-foreground)] hover:text-[var(--color-muted-foreground)] transition-colors truncate"
              onClick={startDeviceEdit}
              title="Clique para renomear"
            >
              {deviceName}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
