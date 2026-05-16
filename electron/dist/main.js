"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const appbar_1 = require("./appbar");
const SERVER_URL = "https://localhost:3001";
const DEFAULT_WIDTH = 380;
const SHORTCUT = "Ctrl+Shift+Space";
let win = null;
let tray = null;
let appBar = null;
let isDocked = true;
// When launched at login via setLoginItemSettings, args include --hidden
const startHidden = process.argv.includes("--hidden");
// ── Icon ──────────────────────────────────────────────────────────────────────
// Place a 64x64 icon.png next to this file (electron/icon.png).
// Tip: convert client/public/icon.svg with any SVG→PNG tool.
function loadIcon() {
    try {
        const img = electron_1.nativeImage.createFromPath(path_1.default.join(__dirname, "..", "icon.png"));
        if (!img.isEmpty())
            return img;
    }
    catch { /* fall through */ }
    return electron_1.nativeImage.createEmpty();
}
// ── Tray menu ─────────────────────────────────────────────────────────────────
function buildTrayMenu() {
    return electron_1.Menu.buildFromTemplate([
        { label: "Abrir ClipSpace", click: () => win?.show() },
        { type: "separator" },
        {
            label: "Modo Dock",
            type: "checkbox",
            checked: isDocked,
            click: toggleDock,
        },
        { type: "separator" },
        {
            label: "Sair",
            click: () => { appBar?.undock(); electron_1.app.exit(0); },
        },
    ]);
}
// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
    const { height } = electron_1.screen.getPrimaryDisplay().workArea;
    win = new electron_1.BrowserWindow({
        width: DEFAULT_WIDTH,
        height,
        frame: false, // ClipSpace has its own header
        resizable: true, // user can drag the left edge to resize
        skipTaskbar: true, // lives in the tray, not the taskbar
        show: false, // shown after dock is applied (avoids flash)
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    win.loadURL(SERVER_URL);
    win.once("ready-to-show", () => {
        if (isDocked) {
            appBar = new appbar_1.AppBar(win);
            appBar.dock();
        }
        if (!startHidden)
            win.show();
    });
    // Close button sends to tray instead of quitting
    win.on("close", (e) => {
        e.preventDefault();
        win?.hide();
    });
    // Debounced AppBar update on resize (user dragging the window edge)
    let resizeTimer;
    win.on("resize", () => {
        if (!isDocked || !appBar)
            return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => appBar?.updatePosition(), 150);
    });
}
// ── Tray ──────────────────────────────────────────────────────────────────────
function createTray() {
    tray = new electron_1.Tray(loadIcon());
    tray.setToolTip("ClipSpace");
    tray.setContextMenu(buildTrayMenu());
    // Single click on tray icon toggles visibility
    tray.on("click", () => {
        if (win?.isVisible())
            win.hide();
        else
            win?.show();
    });
}
// ── Dock toggle ───────────────────────────────────────────────────────────────
function toggleDock() {
    isDocked = !isDocked;
    if (isDocked && win) {
        appBar = new appbar_1.AppBar(win);
        appBar.dock();
    }
    else {
        appBar?.undock();
        appBar = null;
        // Float the window near the right edge so it doesn't jump far
        const { x, y, width, height } = electron_1.screen.getPrimaryDisplay().workArea;
        win?.setBounds({
            x: x + width - DEFAULT_WIDTH - 20,
            y: y + 20,
            width: DEFAULT_WIDTH,
            height: height - 40,
        });
        win?.show();
    }
    tray?.setContextMenu(buildTrayMenu());
}
// ── App lifecycle ─────────────────────────────────────────────────────────────
electron_1.app.whenReady().then(() => {
    // Register as a Windows startup item; on launch it passes --hidden
    electron_1.app.setLoginItemSettings({ openAtLogin: true, args: ["--hidden"] });
    createWindow();
    createTray();
    // Global shortcut to show/hide from anywhere
    const ok = electron_1.globalShortcut.register(SHORTCUT, () => {
        if (win?.isVisible())
            win.hide();
        else
            win?.show();
    });
    if (!ok)
        console.warn(`[ClipSpace] Could not register shortcut ${SHORTCUT}`);
});
electron_1.app.on("before-quit", () => {
    appBar?.undock();
});
// Prevent the app from quitting when all windows are closed (lives in tray)
electron_1.app.on("window-all-closed", () => { });
