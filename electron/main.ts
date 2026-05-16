import { app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut, screen } from "electron";
import path from "path";
import { AppBar } from "./appbar";

const SERVER_URL    = "https://localhost:3001";
const DEFAULT_WIDTH = 320;
const SHORTCUT      = "Ctrl+Shift+Space";

let win:    BrowserWindow | null = null;
let tray:   Tray          | null = null;
let appBar: AppBar        | null = null;
let isDocked = true;

// When launched at login via setLoginItemSettings, args include --hidden
const startHidden = process.argv.includes("--hidden");

// ── Icon ──────────────────────────────────────────────────────────────────────
// Place a 64x64 icon.png next to this file (electron/icon.png).
// Tip: convert client/public/icon.svg with any SVG→PNG tool.
function loadIcon(): Electron.NativeImage {
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, "..", "icon.png"));
    if (!img.isEmpty()) return img;
  } catch { /* fall through */ }
  return nativeImage.createEmpty();
}

// ── Tray menu ─────────────────────────────────────────────────────────────────
function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: "Abrir ClipSpace", click: () => win?.show() },
    { type: "separator" },
    {
      label:   "Modo Dock",
      type:    "checkbox",
      checked: isDocked,
      click:   toggleDock,
    },
    { type: "separator" },
    {
      label: "Sair",
      click: () => { appBar?.undock(); app.exit(0); },
    },
  ]);
}

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  const { height } = screen.getPrimaryDisplay().workArea;

  win = new BrowserWindow({
    width:       DEFAULT_WIDTH,
    height,
    frame:       false,   // ClipSpace has its own header
    resizable:   true,    // user can drag the left edge to resize
    skipTaskbar: true,    // lives in the tray, not the taskbar
    show:        false,   // shown after dock is applied (avoids flash)
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
    },
  });

  win.loadURL(SERVER_URL);

  win.once("ready-to-show", () => {
    if (isDocked) {
      appBar = new AppBar(win!);
      appBar.dock();
    }
    if (!startHidden) win!.show();
  });

  // Close button sends to tray instead of quitting
  win.on("close", (e) => {
    e.preventDefault();
    win?.hide();
  });

  // Debounced AppBar update on resize (user dragging the window edge)
  let resizeTimer: ReturnType<typeof setTimeout>;
  win.on("resize", () => {
    if (!isDocked || !appBar) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => appBar?.updatePosition(), 150);
  });
}

// ── Tray ──────────────────────────────────────────────────────────────────────
function createTray() {
  tray = new Tray(loadIcon());
  tray.setToolTip("ClipSpace");
  tray.setContextMenu(buildTrayMenu());

  // Single click on tray icon toggles visibility
  tray.on("click", () => {
    if (win?.isVisible()) win.hide();
    else win?.show();
  });
}

// ── Dock toggle ───────────────────────────────────────────────────────────────
function toggleDock() {
  isDocked = !isDocked;

  if (isDocked && win) {
    appBar = new AppBar(win);
    appBar.dock();
  } else {
    appBar?.undock();
    appBar = null;
    // Float the window near the right edge so it doesn't jump far
    const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
    win?.setBounds({
      x:      x + width - DEFAULT_WIDTH - 20,
      y:      y + 20,
      width:  DEFAULT_WIDTH,
      height: height - 40,
    });
    win?.show();
  }

  tray?.setContextMenu(buildTrayMenu());
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Register as a Windows startup item; on launch it passes --hidden
  app.setLoginItemSettings({ openAtLogin: true, args: ["--hidden"] });

  createWindow();
  createTray();

  // Global shortcut to show/hide from anywhere
  const ok = globalShortcut.register(SHORTCUT, () => {
    if (win?.isVisible()) win.hide();
    else win?.show();
  });
  if (!ok) console.warn(`[ClipSpace] Could not register shortcut ${SHORTCUT}`);
});

app.on("before-quit", () => {
  appBar?.undock();
});

// Prevent the app from quitting when all windows are closed (lives in tray)
app.on("window-all-closed", () => { /* noop */ });
