import { useState, useEffect } from "react";
import { Plus, House, BookOpen } from "lucide-react";
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

type HomeSection = "briefing" | "todos" | "feed";

const HOME_PAGES: { id: HomeSection; title: string }[] = [
  { id: "briefing", title: "Briefing" },
  { id: "todos", title: "To-dos" },
  { id: "feed", title: "Atividade Recente" },
];

interface SidebarProps {
  open: boolean;
  notebooks: NotebookWithPages[];
  activePageId: string | null;
  onSelectPage: (id: string) => void;
  onNewNotebook: (title: string) => void;
  onNewPage: (notebookId: string) => void;
  onRenameNotebook: (id: string, title: string) => void;
  onRenamePage: (id: string, title: string) => void;
  serverOnline: boolean;
  syncing: boolean;
  deviceName: string;
  onRenameDevice: (name: string) => void;
  unreadIds: ReadonlySet<string>;
  onGoHome: () => void;
  homeSection: HomeSection;
  onHomeSectionChange: (section: HomeSection) => void;
}

const TOTAL_WIDTH = 240;
const NB_COL_WIDTH = 80;

export function Sidebar({
  open,
  notebooks,
  activePageId,
  onSelectPage,
  onNewNotebook,
  onNewPage,
  onRenameNotebook,
  onRenamePage,
  serverOnline,
  syncing,
  deviceName,
  onRenameDevice,
  unreadIds,
  onGoHome,
  homeSection,
  onHomeSectionChange,
}: SidebarProps) {
  const [homeModeActive, setHomeModeActive] = useState(activePageId === null);
  const [activeNotebookId, setActiveNotebookId] = useState<string | null>(null);
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [editPageValue, setEditPageValue] = useState("");
  const [editingNotebookId, setEditingNotebookId] = useState<string | null>(null);
  const [editNotebookValue, setEditNotebookValue] = useState("");
  const [creatingNotebook, setCreatingNotebook] = useState(false);
  const [newNotebookValue, setNewNotebookValue] = useState("");
  const [editingDevice, setEditingDevice] = useState(false);
  const [deviceValue, setDeviceValue] = useState("");

  // Sync active notebook with active page (navigation from outside)
  useEffect(() => {
    if (!activePageId) return;
    setHomeModeActive(false);
    for (const nb of notebooks) {
      if (nb.pages.some((p) => p.id === activePageId)) {
        setActiveNotebookId(nb.id);
        break;
      }
    }
  }, [activePageId, notebooks]);

  // Default to first notebook when none selected
  useEffect(() => {
    if (activeNotebookId === null && notebooks.length > 0) {
      setActiveNotebookId(notebooks[0].id);
    }
  }, [notebooks, activeNotebookId]);

  const activeNotebook = notebooks.find((nb) => nb.id === activeNotebookId) ?? null;

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
      style={{ width: open ? TOTAL_WIDTH : 0 }}
    >
      <div className="sidebar-nav flex h-full" style={{ width: TOTAL_WIDTH }}>

        {/* ── Column 1: Notebooks ─────────────────────────────────────────── */}
        <div
          className="flex flex-col border-r border-[var(--color-border)] shrink-0"
          style={{ width: NB_COL_WIDTH }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-center border-b border-[var(--color-border)] pb-2"
            style={{ paddingTop: "max(0.625rem, env(safe-area-inset-top))" }}
          >
            <Button
              size="icon"
              variant="ghost"
              onClick={() => { setCreatingNotebook(true); setNewNotebookValue(""); }}
              title="Novo notebook"
              className="h-6 w-6"
            >
              <Plus size={13} />
            </Button>
          </div>

          {/* Home */}
          <button
            className={cn(
              "flex flex-col items-center gap-0.5 px-1 py-2.5 w-full transition-colors border-b border-[var(--color-border)]",
              homeModeActive
                ? "bg-[var(--color-muted)] text-[var(--color-foreground)]"
                : "text-[var(--color-foreground)]/50 hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
            )}
            onClick={() => { setHomeModeActive(true); onGoHome(); }}
          >
            <House size={15} />
            <span className="text-[9px] font-medium mt-0.5">Home</span>
          </button>

          {/* Notebook list */}
          <ScrollArea className="flex-1">
            <div className="py-1">
              {notebooks.map((nb) => (
                <div key={nb.id}>
                  {editingNotebookId === nb.id ? (
                    <div className="px-1 py-1">
                      <Input
                        autoFocus
                        value={editNotebookValue}
                        onChange={(e) => setEditNotebookValue(e.target.value)}
                        onBlur={() => commitNotebookEdit(nb.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitNotebookEdit(nb.id);
                          if (e.key === "Escape") setEditingNotebookId(null);
                        }}
                        className="h-5 px-1 py-0 text-[10px]"
                      />
                    </div>
                  ) : (
                    <button
                      className={cn(
                        "relative flex flex-col items-center gap-0.5 px-1 py-2 w-full transition-colors",
                        !homeModeActive && activeNotebookId === nb.id
                          ? "bg-[var(--color-muted)] text-[var(--color-foreground)]"
                          : "text-[var(--color-foreground)]/50 hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                      )}
                      onClick={() => { setHomeModeActive(false); setActiveNotebookId(nb.id); }}
                      onDoubleClick={() => {
                        setEditingNotebookId(nb.id);
                        setEditNotebookValue(nb.title);
                      }}
                      title={nb.title}
                    >
                      <BookOpen size={13} className="shrink-0" />
                      <span className="text-[9px] leading-tight text-center line-clamp-2 break-all w-full px-0.5">
                        {nb.title}
                      </span>
                      {nb.pages.some((p) => unreadIds.has(p.id)) && activeNotebookId !== nb.id && (
                        <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-[var(--color-primary)]" />
                      )}
                    </button>
                  )}
                </div>
              ))}

              {creatingNotebook && (
                <div className="px-1 py-1">
                  <Input
                    autoFocus
                    value={newNotebookValue}
                    onChange={(e) => setNewNotebookValue(e.target.value)}
                    onBlur={commitNewNotebook}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitNewNotebook();
                      if (e.key === "Escape") { setCreatingNotebook(false); setNewNotebookValue(""); }
                    }}
                    placeholder="nome…"
                    className="h-5 px-1 py-0 text-[10px]"
                  />
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Footer: device + count */}
          <div
            className="border-t border-[var(--color-border)] px-1 py-1.5 flex flex-col items-center gap-0.5"
            style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
          >
            {syncing ? (
              <span className="flex items-center gap-1 text-[9px] text-amber-500/80">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                sync…
              </span>
            ) : serverOnline ? (
              <span className="flex items-center gap-1 text-[9px] text-green-500/70">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />
                online
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[9px] text-red-500/70">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
                offline
              </span>
            )}
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
                className="h-5 px-1 py-0 text-[9px] w-full"
              />
            ) : (
              <button
                className="text-[9px] text-[var(--color-muted-foreground)] truncate w-full text-center hover:text-[var(--color-foreground)] transition-colors"
                onClick={() => { setDeviceValue(deviceName); setEditingDevice(true); }}
                title={`${deviceName} — clique para renomear`}
              >
                {deviceName}
              </button>
            )}
          </div>
        </div>

        {/* ── Column 2: Pages ─────────────────────────────────────────────── */}
        <div className="flex flex-col flex-1 min-w-0">
          {/* Header */}
          <div
            className="flex items-center gap-1 px-2 pb-2 border-b border-[var(--color-border)]"
            style={{ paddingTop: "max(0.625rem, env(safe-area-inset-top))" }}
          >
            {homeModeActive ? (
              <span className="text-[11px] font-medium truncate flex-1 min-w-0">Home</span>
            ) : activeNotebook ? (
              <>
                <span className="text-[11px] font-medium truncate flex-1 min-w-0">
                  {activeNotebook.title}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5 shrink-0"
                  onClick={() => onNewPage(activeNotebook.id)}
                  title="Nova page"
                >
                  <Plus size={11} />
                </Button>
              </>
            ) : (
              <span className="text-[11px] text-[var(--color-muted-foreground)] opacity-40 flex-1">—</span>
            )}
          </div>

          {/* Pages */}
          <ScrollArea className="flex-1">
            <div className="py-0.5">
              {homeModeActive ? (
                /* Static Home pages */
                HOME_PAGES.map((hp) => (
                  <button
                    key={hp.id}
                    className={cn(
                      "w-full flex items-center px-2 py-2 border-l-2 transition-colors text-left",
                      homeSection === hp.id
                        ? "border-l-[var(--color-primary)] bg-[var(--color-muted)] text-[var(--color-foreground)]"
                        : "border-l-transparent text-[var(--color-foreground)]/60 hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                    )}
                    onClick={() => onHomeSectionChange(hp.id)}
                  >
                    <span className="text-[12px] truncate leading-tight">{hp.title}</span>
                  </button>
                ))
              ) : (
                <>
                  {activeNotebook?.pages.map((page: Page) => (
                    <div
                      key={page.id}
                      className={cn(
                        "group flex cursor-pointer items-center gap-1.5 px-2 py-1.5 border-l-2 transition-colors",
                        activePageId === page.id
                          ? "border-l-[var(--color-primary)] bg-[var(--color-muted)] text-[var(--color-foreground)]"
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
                          className="h-5 px-1 py-0 text-[11px] flex-1"
                        />
                      ) : (
                        <>
                          <div className="flex flex-col flex-1 min-w-0">
                            <span className="text-[12px] truncate leading-tight">{page.title}</span>
                            <span className="text-[10px] font-mono opacity-40 leading-tight">
                              {formatRelativeTime(page.updated_at)}
                            </span>
                          </div>
                          {unreadIds.has(page.id) && (
                            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-primary)] shrink-0" />
                          )}
                        </>
                      )}
                    </div>
                  ))}

                  {activeNotebook && activeNotebook.pages.length === 0 && (
                    <p className="px-2 py-4 text-[11px] text-[var(--color-muted-foreground)] opacity-50 text-center">
                      sem pages
                    </p>
                  )}

                  {!activeNotebook && notebooks.length === 0 && !creatingNotebook && (
                    <p className="px-2 py-4 text-center text-[11px] text-[var(--color-muted-foreground)]">
                      nenhum notebook
                      <br />
                      <span className="opacity-60">+ para criar</span>
                    </p>
                  )}
                </>
              )}
            </div>
          </ScrollArea>
        </div>

      </div>
    </div>
  );
}
