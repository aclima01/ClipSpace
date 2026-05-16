import koffi from "koffi";
import { BrowserWindow, screen } from "electron";

const ABM_NEW      = 0x00000000;
const ABM_REMOVE   = 0x00000001;
const ABM_QUERYPOS = 0x00000002;
const ABM_SETPOS   = 0x00000003;
const ABE_RIGHT    = 2;

// Structs defined once at module level
const RECT = koffi.struct("RECT", {
  left:   "int32",
  top:    "int32",
  right:  "int32",
  bottom: "int32",
});

// APPBARDATA layout on x64 Windows (48 bytes):
//   cbSize (4) + padding (4) + hWnd (8) + uCallbackMessage (4) + uEdge (4) + rc (16) + lParam (8)
const APPBARDATA = koffi.struct("APPBARDATA", {
  cbSize:           "uint32",
  hWnd:             "uint64",  // HWND — pointer-sized handle
  uCallbackMessage: "uint32",
  uEdge:            "uint32",
  rc:               RECT,
  lParam:           "int64",
});

// Loaded lazily on first dock() call
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _SHAppBarMessage:   any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _RegisterWindowMsg: any = null;

function loadWin32() {
  if (_SHAppBarMessage) return;
  const shell32 = koffi.load("Shell32.dll");
  const user32  = koffi.load("User32.dll");
  _SHAppBarMessage   = shell32.func("SHAppBarMessage",      "uint64", ["uint32", koffi.inout(koffi.pointer(APPBARDATA))]);
  _RegisterWindowMsg = user32.func("RegisterWindowMessageW", "uint32", ["str16"]);
}

export class AppBar {
  private win:    BrowserWindow;
  private hwnd:   number;
  private msgId:  number = 0;
  private docked  = false;

  constructor(win: BrowserWindow) {
    this.win  = win;
    const buf = win.getNativeWindowHandle();
    // getNativeWindowHandle() returns a Buffer containing the HWND
    this.hwnd = process.arch === "x64"
      ? Number(buf.readBigUInt64LE())
      : buf.readUInt32LE();
  }

  dock() {
    try {
      loadWin32();
      this.msgId = _RegisterWindowMsg("ClipSpace_AppBar_CB");
      _SHAppBarMessage(ABM_NEW, this.buildData());
      this.docked = true;
      this.updatePosition();
    } catch (e) {
      console.error("[AppBar] dock failed:", e);
    }
  }

  updatePosition() {
    if (!this.docked) return;
    try {
      const { bounds } = screen.getPrimaryDisplay();
      const winWidth   = this.win.getBounds().width;

      const abd = this.buildData({
        rc: { left: bounds.x, top: bounds.y, right: bounds.x + bounds.width, bottom: bounds.y + bounds.height },
      });

      // Let Windows trim the rect to avoid overlapping the taskbar
      _SHAppBarMessage(ABM_QUERYPOS, abd);

      // For a right-side appbar, pin the right edge and adjust left by desired width
      abd.rc.left = abd.rc.right - winWidth;

      _SHAppBarMessage(ABM_SETPOS, abd);

      this.win.setBounds({
        x:      abd.rc.left,
        y:      abd.rc.top,
        width:  abd.rc.right  - abd.rc.left,
        height: abd.rc.bottom - abd.rc.top,
      });
    } catch (e) {
      console.error("[AppBar] updatePosition failed:", e);
    }
  }

  undock() {
    if (!this.docked) return;
    try {
      _SHAppBarMessage(ABM_REMOVE, this.buildData());
    } catch (e) {
      console.error("[AppBar] undock failed:", e);
    }
    this.docked = false;
  }

  private buildData(overrides: { rc?: { left: number; top: number; right: number; bottom: number } } = {}) {
    return {
      cbSize:           koffi.sizeof(APPBARDATA),
      hWnd:             this.hwnd,
      uCallbackMessage: this.msgId,
      uEdge:            ABE_RIGHT,
      rc:               overrides.rc ?? { left: 0, top: 0, right: 0, bottom: 0 },
      lParam:           0,
    };
  }
}
