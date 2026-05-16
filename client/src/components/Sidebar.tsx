import { useState, useEffect } from "react";
import { Plus, House, ChevronRight, ChevronDown, BookOpen } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { cn } from "@/lib/utils";
import type { NotebookWithPages, Page } from "../types";

function formatRelativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h`;
  return `${Math.floor(diffHour / 24)}d`;
}

interface SidebarProps {
  open: boolean;
  notebooks: NotebookWithPages[];
  activePageId: string | null;
  onSelectPage: (id: string) => void;
  onNewNotebook: (title: string) => void;
  onNewPage: (notebookId: string) => void;
  onRenameNotebook: (id: string, title: string) => void;
  onRenamePage: (id: string, title: string) => void;
  connectedCount: number;
  deviceName: string;
  onRenameDevice: (name: string) => void;
  unreadIds: ReadonlySet<string>;
  onGoHome: () => void;
}

export function Sidebar({
  open,
  notebooks,
  activePageId,
  onSelectPage,
  onNewNotebook,
  onNewPage,
  onRenameNotebook,
  onRenamePage,
  connectedCount,
  deviceName,
  onRenameDevice,
  unreadIds,
  onGoHome,
}: SidebarProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [editPageValue, setEditPageValue] = useState("");
  const [editingNotebookId, setEditingNotebookId] = useState<string | null>(null);
  const [editNotebookValue, setEditNotebookValue] = useState("");
  const [creatingNotebook, setCreatingNotebook] = useState(false);
  const [newNotebookValue, setNewNotebookValue] = useState("");
  const [editingDevice, setEditingDevice] = useState(false);
  const [deviceValue, setDeviceValue] = useState("");

  useEffect(() => {
    if (!activePageId) return;
    for (const nb of notebooks) {
      if (nb.pages.some((p) => p.id === activePageId)) {
        setExpanded((prev) => {
          if (prev.has(nb.id)) return prev;
          const next = new Set(prev);
          next.add(nb.id);
          return next;
        });
        break;
      }
    }
  }, [activePageId, notebooks]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const commitPageEdit = (id: string) => {
    if (editPageValue.trim()) onRenamePage(id, editPageValue.trim());
    setEditingPageId(null);
  };

  const commitNotebookEdit = (id: string) => {
    if (editNotebookValue.trim()) onRenameNotebook(id, editNotebookValue.trim());
    setEditingNotebookId(null);
  };

  const commitNewNotebook = () => {
    const title = newNotebookValue.trim();
    if (title) onNewNotebook(title);
    setCreatingNotebook(false);
    setNewNotebookValue("");
  };

  const commitDeviceEdit = () => {
    if (deviceValue.trim()) onRenameDevice(deviceValue.trim());
    setEditingDevice(false);
  };

  return (
    <div
      className="flex flex-col border-r border-[var(--color-border)] bg-[var(--color-background)] overflow-hidden transition-all duration-200 ease-in-out shrink-0"
      style={{ width: open ? 220 : 0 }}
    >
      <div className="flex flex-col h-full" style={{ width: 220 }}>
        {/* Header */}
        <div
          className="flex items-center justify-between px-3 pb-2.5 border-b border-[var(--color-border)]"
          style={{ paddingTop: "max(0.625rem, env(safe-area-inset-top))" }}
        >
          <span className="flex-1 min-w-0 text-xs font-semibold tracking-widest uppercase text-[var(--color-muted-foreground)] truncate">
            Anotações
          </span>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => {
              setCreatingNotebook(true);
              setNewNotebookValue("");
            }}
            title="Novo notebook"
            className="h-6 w-6 shrink-0"
          >
            <Plus size={13} />
          </Button>
        </div>

        {/* Home item */}
        <div
          className={cn(
            "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[14px] transition-colors border-l-2 border-b border-b-[var(--color-border)]",
            activePageId === null
              ? "border-l-[var(--color-primary)] bg-[var(--color-muted)] text-[var(--color-foreground)] font-medium"
              : "border-l-transparent text-[var(--color-foreground)]/60 hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
          )}
          onClick={onGoHome}
        >
          <House size={13} className="shrink-0" />
          <span>Home</span>
        </div>

        {/* Notebook tree */}
        <ScrollArea className="flex-1">
          <div className="py-1">
            {notebooks.map((nb) => {
              const isExpanded = expanded.has(nb.id);
              return (
                <div key={nb.id}>
                  {/* Notebook row */}
                  <div
                    className="group flex items-center gap-1.5 px-2 py-1.5 text-[14px] text-[var(--color-foreground)]/60 hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors cursor-pointer"
                    onClick={() => toggleExpand(nb.id)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditingNotebookId(nb.id);
                      setEditNotebookValue(nb.title);
                    }}
                  >
                    <span className="shrink-0">
                      {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </span>
                    <BookOpen size={11} className="shrink-0 opacity-50" />

                    {editingNotebookId === nb.id ? (
                      <Input
                        autoFocus
                        value={editNotebookValue}
                        onChange={(e) => setEditNotebookValue(e.target.value)}
                        onBlur={() => commitNotebookEdit(nb.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitNotebookEdit(nb.id);
                          if (e.key === "Escape") setEditingNotebookId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="h-5 px-1 py-0 text-[12px] flex-1 min-w-0"
                      />
                    ) : (
                      <span className="flex-1 min-w-0 truncate leading-tight font-medium">
                        {nb.title}
                      </span>
                    )}

                    {!isExpanded && nb.pages.some((p) => unreadIds.has(p.id)) && (
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-primary)] shrink-0" />
                    )}

                    {editingNotebookId !== nb.id && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            next.add(nb.id);
                            return next;
                          });
                          onNewPage(nb.id);
                        }}
                        title="Nova page"
                        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity h-4 w-4 flex items-center justify-center hover:text-[var(--color-foreground)]"
                      >
                        <Plus size={11} />
                      </button>
                    )}
                  </div>

                  {/* Pages */}
                  {isExpanded && (
                    <div>
                      {nb.pages.map((page: Page) => (
                        <div
                          key={page.id}
                          className={cn(
                            "group flex cursor-pointer items-center justify-between pl-8 pr-3 py-1 text-[13px] transition-colors border-l-2",
                            activePageId === page.id
                              ? "border-l-[var(--color-primary)] bg-[var(--color-muted)] text-[var(--color-foreground)] font-medium"
                              : "border-l-transparent text-[var(--color-foreground)]/60 hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                          )}
                          onClick={() => onSelectPage(page.id)}
                          onDoubleClick={() => {
                            setEditingPageId(page.id);
                            setEditPageValue(page.title);
                          }}
                        >
                          {editingPageId === page.id ? (
                            <Input
                              autoFocus
                              value={editPageValue}
                              onChange={(e) => setEditPageValue(e.target.value)}
                              onBlur={() => commitPageEdit(page.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitPageEdit(page.id);
                                if (e.key === "Escape") setEditingPageId(null);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="h-5 px-1 py-0 text-[11px]"
                            />
                          ) : (
                            <>
                              <span className="truncate flex-1 leading-tight">{page.title}</span>
                              <span className="ml-2 shrink-0 flex items-center gap-1.5">
                                {unreadIds.has(page.id) && (
                                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-primary)] shrink-0" />
                                )}
                                <span className="text-[11px] font-mono opacity-40">
                                  {formatRelativeTime(page.updated_at)}
                                </span>
                              </span>
                            </>
                          )}
                        </div>
                      ))}

                      {nb.pages.length === 0 && (
                        <p className="pl-8 py-1.5 text-[11px] text-[var(--color-muted-foreground)] opacity-50">
                          sem pages
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {creatingNotebook && (
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                <ChevronRight size={12} className="shrink-0 opacity-30" />
                <BookOpen size={11} className="shrink-0 opacity-30" />
                <Input
                  autoFocus
                  value={newNotebookValue}
                  onChange={(e) => setNewNotebookValue(e.target.value)}
                  onBlur={commitNewNotebook}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitNewNotebook();
                    if (e.key === "Escape") {
                      setCreatingNotebook(false);
                      setNewNotebookValue("");
                    }
                  }}
                  placeholder="Nome do notebook…"
                  className="h-5 px-1 py-0 text-[12px] flex-1 min-w-0"
                />
              </div>
            )}

            {notebooks.length === 0 && !creatingNotebook && (
              <p className="px-3 py-4 text-center text-[12px] text-[var(--color-muted-foreground)]">
                nenhum notebook
                <br />
                <span className="opacity-60">+ para criar</span>
              </p>
            )}
          </div>
        </ScrollArea>

        {/* Nodes count */}
        <div className="border-t border-[var(--color-border)] px-3 py-1.5">
          <span className="text-[11px] text-[var(--color-muted-foreground)]">
            {connectedCount} node{connectedCount !== 1 ? "s" : ""} online
          </span>
        </div>

        {/* Device identity */}
        <div
          className="border-t border-[var(--color-border)] px-3 pt-2"
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >
          <p className="text-[10px] text-[var(--color-muted-foreground)] mb-1 opacity-60 uppercase tracking-wide">
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
              className="h-6 px-1.5 py-0 text-[12px]"
            />
          ) : (
            <button
              className="w-full text-left text-[12px] font-medium text-[var(--color-foreground)] hover:text-[var(--color-muted-foreground)] transition-colors truncate"
              onClick={() => { setDeviceValue(deviceName); setEditingDevice(true); }}
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
