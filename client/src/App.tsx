import { useEffect, useState, useCallback, useRef } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatArea } from "./components/ChatArea";
import { HomeView } from "./components/HomeView";
import { SearchOverlay } from "./components/SearchOverlay";
import { TooltipProvider } from "./components/ui/tooltip";
import { useServerStatus } from "./hooks/useServerStatus";
import { saveCache, loadCache, loadQueue, removeFromQueue } from "./lib/offlineCache";
import type { NotebookWithPages, Page } from "./types";

const STORAGE_KEY = "clipspace:deviceName";

function generateDeviceName(): string {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `node-${suffix}`;
}

function loadDeviceName(): string {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) return saved;
  const name = generateDeviceName();
  localStorage.setItem(STORAGE_KEY, name);
  return name;
}

function generatePageTitle(notebook: NotebookWithPages): string {
  const prefix = notebook.title.replace(/[^a-z0-9]/gi, "").slice(0, 3).toLowerCase().padEnd(3, "x");
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const pattern = `${prefix}-${today}-`;
  const count = notebook.pages.filter((p) => p.title.startsWith(pattern)).length;
  return `${pattern}${String(count + 1).padStart(3, "0")}`;
}

export default function App() {
  const [notebooks, setNotebooks] = useState<NotebookWithPages[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string>(loadDeviceName);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 640);
  const [unreadIds, setUnreadIds] = useState<ReadonlySet<string>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [targetMessageId, setTargetMessageId] = useState<string | null>(null);
  const [homeRefresh, setHomeRefresh] = useState(0);
  const [chatRefresh, setChatRefresh] = useState(0);
  const [homeStats, setHomeStats] = useState<{ messagesToday: number; openTodos: number; totalPages: number; totalNotebooks: number } | null>(null);
  const [homeSection, setHomeSection] = useState<"briefing" | "todos" | "feed">("briefing");

  const activePageIdRef = useRef(activePageId);
  useEffect(() => { activePageIdRef.current = activePageId; }, [activePageId]);

  // Ctrl+K to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Initial load — with cache fallback for offline startup
  useEffect(() => {
    fetch("/api/notebooks")
      .then((r) => r.json())
      .then(async (data: NotebookWithPages[]) => {
        setNotebooks(data);
        await saveCache("notebooks", data);
      })
      .catch(async () => {
        const cached = await loadCache<NotebookWithPages[]>("notebooks");
        if (cached) setNotebooks(cached);
      });
  }, []);

  // ── Offline sync ───────────────────────────────────────────────────────────

  const handleReconnect = useCallback(async () => {
    const queue = await loadQueue();
    for (const op of queue) {
      try {
        const res = await fetch(`/api/pages/${op.pageId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: op.content, deviceName: op.deviceName }),
        });
        if (res.ok || res.status < 500) await removeFromQueue(op.id);
      } catch { /* network error — keep in queue */ }
    }
    try {
      const data: NotebookWithPages[] = await fetch("/api/notebooks").then((r) => r.json());
      setNotebooks(data);
      await saveCache("notebooks", data);
    } catch { /* ignore */ }
    setChatRefresh((n) => n + 1);
    setHomeRefresh((n) => n + 1);
  }, []);

  const { serverOnline, syncing } = useServerStatus({ onReconnect: handleReconnect });

  // ── Helpers ────────────────────────────────────────────────────────────────

  const findPage = useCallback(
    (pageId: string): Page | null => {
      for (const nb of notebooks) {
        const page = nb.pages.find((p) => p.id === pageId);
        if (page) return page;
      }
      return null;
    },
    [notebooks]
  );

  // ── Device ─────────────────────────────────────────────────────────────────

  const handleRenameDevice = (name: string) => {
    localStorage.setItem(STORAGE_KEY, name);
    setDeviceName(name);
  };

  // ── Notebook actions ───────────────────────────────────────────────────────

  const handleNewNotebook = async (title: string) => {
    await fetch("/api/notebooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    // State update via WS notebook_created
  };

  const handleRenameNotebook = async (id: string, title: string) => {
    await fetch(`/api/notebooks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
  };

  // ── Page actions ───────────────────────────────────────────────────────────

  const handleNewPage = async (notebookId: string) => {
    const notebook = notebooks.find((nb) => nb.id === notebookId);
    const title = notebook ? generatePageTitle(notebook) : new Date().toISOString().slice(0, 10);
    const res = await fetch(`/api/notebooks/${notebookId}/pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const page: Page = await res.json();
    setActivePageId(page.id);
  };

  const handleRenamePage = async (id: string, title: string) => {
    await fetch(`/api/pages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
  };

  const handleSelectPage = (id: string) => {
    setActivePageId(id);
    setUnreadIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (window.innerWidth < 640) setSidebarOpen(false);
  };

  // ── WS event handlers (passed to ChatArea) ─────────────────────────────────

  const handleConnectedCount = useCallback((_count: number) => {}, []);

  const bringPageToTop = useCallback((pageId: string, notebookId: string, updatedAt: string) => {
    setNotebooks((prev) =>
      prev.map((nb) => {
        if (nb.id !== notebookId) return nb;
        const idx = nb.pages.findIndex((p) => p.id === pageId);
        if (idx <= 0) return { ...nb, updated_at: updatedAt };
        const updated = { ...nb.pages[idx], updated_at: updatedAt };
        return {
          ...nb,
          updated_at: updatedAt,
          pages: [updated, ...nb.pages.slice(0, idx), ...nb.pages.slice(idx + 1)],
        };
      }).sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    );
  }, []);

  const handlePageTouched = useCallback(
    (pageId: string, notebookId: string, updatedAt: string) => {
      bringPageToTop(pageId, notebookId, updatedAt);
      setHomeRefresh((n) => n + 1);
      if (pageId !== activePageIdRef.current) {
        setUnreadIds((prev) => {
          if (prev.has(pageId)) return prev;
          const next = new Set(prev);
          next.add(pageId);
          return next;
        });
      }
    },
    [bringPageToTop]
  );

  const handleMessageConfirmed = useCallback(
    (pageId: string, notebookId: string) => {
      bringPageToTop(pageId, notebookId, new Date().toISOString());
    },
    [bringPageToTop]
  );

  const handlePageRenamed = useCallback((pageId: string, _notebookId: string, title: string) => {
    setNotebooks((prev) =>
      prev.map((nb) => ({
        ...nb,
        pages: nb.pages.map((p) => (p.id === pageId ? { ...p, title } : p)),
      }))
    );
  }, []);

  const handleNotebookRenamed = useCallback((notebookId: string, title: string) => {
    setNotebooks((prev) =>
      prev.map((nb) => (nb.id === notebookId ? { ...nb, title } : nb))
    );
  }, []);

  const handlePageCreated = useCallback((page: Page) => {
    setNotebooks((prev) =>
      prev.map((nb) => {
        if (nb.id !== page.notebook_id) return nb;
        if (nb.pages.some((p) => p.id === page.id)) return nb;
        return { ...nb, pages: [page, ...nb.pages] };
      })
    );
  }, []);

  const handleNotebookCreated = useCallback(
    (notebook: { id: string; title: string; created_at: string; updated_at: string }) => {
      setNotebooks((prev) => {
        if (prev.some((nb) => nb.id === notebook.id)) return prev;
        return [{ ...notebook, pages: [] }, ...prev];
      });
    },
    []
  );

  const handleMessagesCleared = useCallback((_pageId: string) => {}, []);

  const handlePageDeleted = useCallback(
    (pageId: string, _notebookId: string) => {
      setNotebooks((prev) =>
        prev.map((nb) => ({ ...nb, pages: nb.pages.filter((p) => p.id !== pageId) }))
      );
      if (activePageIdRef.current === pageId) setActivePageId(null);
      setUnreadIds((prev) => {
        if (!prev.has(pageId)) return prev;
        const next = new Set(prev);
        next.delete(pageId);
        return next;
      });
    },
    []
  );

  const handleNotebookDeleted = useCallback((notebookId: string) => {
    setNotebooks((prev) => {
      const nb = prev.find((n) => n.id === notebookId);
      if (nb?.pages.some((p) => p.id === activePageIdRef.current)) {
        setActivePageId(null);
      }
      return prev.filter((n) => n.id !== notebookId);
    });
  }, []);

  const handleCreatePageFromSummary = useCallback(async (content: string) => {
    if (!activePageId) return;
    const currentPage = findPage(activePageId);
    if (!currentPage) return;
    const notebook = notebooks.find((nb) => nb.id === currentPage.notebook_id);
    if (!notebook) return;
    const title = generatePageTitle(notebook);
    const res = await fetch(`/api/notebooks/${notebook.id}/pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const newPage: Page = await res.json();
    await fetch(`/api/pages/${newPage.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, deviceName: "AI ✦" }),
    });
    setActivePageId(newPage.id);
  }, [activePageId, findPage, notebooks]);

  const handleNavigateToTask = useCallback(async (taskId: string) => {
    const res = await fetch(`/api/tasks/${taskId}`);
    if (!res.ok) return;
    const { pageId, messageId } = await res.json() as { pageId: string; messageId: string };
    handleSelectPage(pageId);
    setTargetMessageId(messageId);
  }, [handleSelectPage]);

  const noop = useCallback(() => {}, []);

  const activePage = activePageId ? findPage(activePageId) : null;

  return (
    <TooltipProvider>
      <div className="flex overflow-hidden bg-[var(--color-background)]" style={{ height: "100dvh" }}>
        {searchOpen && (
          <SearchOverlay
            onSelectPage={(pageId) => handleSelectPage(pageId)}
            onSelectMessage={(pageId, msgId) => {
              handleSelectPage(pageId);
              setTargetMessageId(msgId);
            }}
            onClose={() => setSearchOpen(false)}
          />
        )}
        <Sidebar
          open={sidebarOpen}
          notebooks={notebooks}
          activePageId={activePageId}
          onSelectPage={handleSelectPage}
          onNewNotebook={handleNewNotebook}
          onNewPage={handleNewPage}
          onRenameNotebook={handleRenameNotebook}
          onRenamePage={handleRenamePage}
          serverOnline={serverOnline}
          syncing={syncing}
          deviceName={deviceName}
          onRenameDevice={handleRenameDevice}
          unreadIds={unreadIds}
          onGoHome={() => setActivePageId(null)}
          homeSection={homeSection}
          onHomeSectionChange={setHomeSection}
        />
        {activePageId === null ? (
          <HomeView
            refreshTrigger={homeRefresh}
            onNavigate={(pageId, msgId) => {
              handleSelectPage(pageId);
              setTargetMessageId(msgId);
            }}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
            sidebarOpen={sidebarOpen}
            serverOnline={serverOnline}
            syncing={syncing}
            onStatsUpdated={setHomeStats}
            activeSection={homeSection}
          />
        ) : (
          <ChatArea
            page={activePage}
            deviceName={deviceName}
            onConnectedCount={handleConnectedCount}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
            sidebarOpen={sidebarOpen}
            homeStats={homeStats}
            serverOnline={serverOnline}
            syncing={syncing}
            refreshTrigger={chatRefresh}
            targetMessageId={targetMessageId}
            onTargetReached={() => setTargetMessageId(null)}
            onOpenSearch={() => setSearchOpen(true)}
            onMessageConfirmed={handleMessageConfirmed}
            onPageTouched={handlePageTouched}
            onPageCreated={handlePageCreated}
            onNotebookCreated={handleNotebookCreated}
            onPageRenamed={handlePageRenamed}
            onNotebookRenamed={handleNotebookRenamed}
            onMessageDeleted={noop}
            onMessagesCleared={handleMessagesCleared}
            onPageDeleted={handlePageDeleted}
            onNotebookDeleted={handleNotebookDeleted}
            onCreatePageFromSummary={handleCreatePageFromSummary}
            onNavigateToTask={handleNavigateToTask}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
