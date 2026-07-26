import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  dialog,
  Notification,
  shell,
  ipcMain,
  session,
  systemPreferences,
  protocol,
  net,
} from "electron";
import * as path from "path";
import { autoUpdater } from "electron-updater";
import AutoLaunch from "auto-launch";

// ── Constants ──────────────────────────────────────────────────────────
const IS_DEV = process.env.NODE_ENV === "development" || !app.isPackaged;
const APP_NAME = "HSMC Wallet";
const DEV_SERVER_URL = "http://localhost:3000";
const APP_PROTOCOL = "hsmc-app";

// ── SPA Protocol Handler ───────────────────────────────────────────────
// Registers a custom "hsmc-app://" protocol that serves files from the
// Vite dist directory with SPA fallback (all routes → index.html).
function registerAppProtocol(): void {
  const distDir = getDistPath();

  protocol.handle(APP_PROTOCOL, (request) => {
    const url = new URL(request.url);
    let filePath = path.join(distDir, url.pathname === "/" ? "index.html" : url.pathname);

    // Normalize path separators for the platform
    filePath = path.normalize(filePath);

    // Security: ensure the resolved path is within distDir
    if (!filePath.startsWith(path.normalize(distDir) + path.sep)) {
      return new Response("Forbidden", { status: 403 });
    }

    return net
      .fetch("file://" + filePath)
      .then((response) => {
        if (response.status === 404 || response.status === 0) {
          // SPA fallback: serve index.html for any non-file route
          return net.fetch("file://" + path.join(distDir, "index.html"));
        }
        return response;
      })
      .catch(() => {
        // SPA fallback on error
        return net.fetch("file://" + path.join(distDir, "index.html"));
      });
  });
}

// ── Path Helpers ────────────────────────────────────────────────────────
// In development (electron . from desktop/), __dirname = desktop/dist-electron/
// In packaged app, __dirname = resources/app/dist-electron/
function getProjectRoot(): string {
  if (app.isPackaged) {
    // Packaged: resources/ = __dirname/../../
    // Project files are in resources/app/ = __dirname/../
    return path.join(__dirname, "..");
  }
  // Development: desktop/dist-electron/ → project root = ../../ 
  return path.join(__dirname, "..", "..");
}

function getPublicPath(filename: string): string {
  return path.join(getProjectRoot(), "public", filename);
}

function getDistPath(filename?: string): string {
  const dist = path.join(getProjectRoot(), "dist");
  return filename ? path.join(dist, filename) : dist;
}

// ── State ──────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
const autoLauncher = new AutoLaunch({ name: APP_NAME });

// ── Auto-updater ───────────────────────────────────────────────────────
function setupAutoUpdater(): void {
  if (IS_DEV) {
    console.log("[auto-update] Skipped in development mode");
    return;
  }

  autoUpdater.logger = console;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    console.log("[auto-update] Checking for updates…");
  });

  autoUpdater.on("update-available", (info) => {
    console.log("[auto-update] Update available:", info.version);
    mainWindow?.webContents.send("update-available", info);
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[auto-update] No updates available");
  });

  autoUpdater.on("download-progress", (progress) => {
    mainWindow?.webContents.send("update-download-progress", progress);
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log("[auto-update] Update downloaded:", info.version);
    mainWindow?.webContents.send("update-downloaded", info);
    dialog
      .showMessageBox({
        type: "info",
        title: "Update Ready",
        message: `HSMC Wallet ${info.version} has been downloaded. Restart now to install?`,
        buttons: ["Restart Now", "Later"],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  autoUpdater.on("error", (err) => {
    console.error("[auto-update] Error:", err.message);
    mainWindow?.webContents.send("update-error", err.message);
  });

  // Check every 4 hours
  autoUpdater.checkForUpdatesAndNotify();
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 4 * 60 * 60 * 1000);
}

// ── System Tray ────────────────────────────────────────────────────────
function createTray(): void {
  const iconPath = getPublicPath("favicon.png");
  let trayIcon: Electron.NativeImage;

  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) throw new Error("empty");
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
  } catch {
    // Fallback: create a 16x16 purple icon programmatically
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip(APP_NAME);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open HSMC Wallet",
      click: () => {
        showMainWindow();
      },
    },
    { type: "separator" },
    {
      label: "Check for Updates",
      click: () => {
        autoUpdater.checkForUpdatesAndNotify();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on("double-click", () => {
    showMainWindow();
  });
}

// ── Window Management ──────────────────────────────────────────────────
function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    icon: getPublicPath("hsmc-logo.png"),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  // Load content
  if (IS_DEV) {
    mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    // Production: load via custom protocol with SPA routing support
    mainWindow.loadURL(`${APP_PROTOCOL}://app/index.html`);
  }

  // Show window when ready to avoid white flash
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:") || url.startsWith("http:")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Minimize to tray instead of closing
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function showMainWindow(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createMainWindow();
  }
}

// ── IPC Handlers (secure bridge to renderer) ───────────────────────────
function setupIpcHandlers(): void {
  // ── File dialogs ──────────────────────────────────────────────────
  ipcMain.handle("dialog:openFile", async (_event, options) => {
    if (!mainWindow) return { canceled: true, filePaths: [] };
    return dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: options?.filters || [
        { name: "Wallet Files", extensions: ["json", "hsmc", "dat"] },
        { name: "All Files", extensions: ["*"] },
      ],
      ...options,
    });
  });

  ipcMain.handle("dialog:saveFile", async (_event, options) => {
    if (!mainWindow) return { canceled: true, filePath: undefined };
    return dialog.showSaveDialog(mainWindow, {
      filters: options?.filters || [
        { name: "Wallet Backup", extensions: ["hsmc", "json"] },
        { name: "All Files", extensions: ["*"] },
      ],
      defaultPath: options?.defaultPath || "hsmc-wallet-backup",
      ...options,
    });
  });

  // ── Export wallet — save dialog + write file ──────────────────────
  ipcMain.handle(
    "wallet:exportToFile",
    async (_event, data: string, suggestedName: string) => {
      if (!mainWindow) return { success: false, error: "No window" };
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: suggestedName || "hsmc-wallet-backup.hsmc",
        filters: [
          { name: "HSMC Wallet", extensions: ["hsmc"] },
          { name: "JSON", extensions: ["json"] },
        ],
      });
      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }
      try {
        const fs = await import("fs/promises");
        await fs.writeFile(result.filePath, data, "utf-8");
        return { success: true, filePath: result.filePath };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
  );

  // ── Read file (import wallet) ─────────────────────────────────────
  ipcMain.handle("wallet:readFile", async (_event) => {
    if (!mainWindow) return { success: false, error: "No window" };
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [
        { name: "HSMC Wallet", extensions: ["hsmc", "json"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }
    try {
      const fs = await import("fs/promises");
      const content = await fs.readFile(result.filePaths[0], "utf-8");
      return { success: true, content, filePath: result.filePaths[0] };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── System notifications ──────────────────────────────────────────
  ipcMain.handle(
    "notify:show",
    async (_event, title: string, body: string) => {
      if (Notification.isSupported()) {
        new Notification({ title, body }).show();
        return { success: true };
      }
      return { success: false, error: "Notifications not supported" };
    }
  );

  // ── App info ──────────────────────────────────────────────────────
  ipcMain.handle("app:getInfo", async () => {
    return {
      version: app.getVersion(),
      name: app.getName(),
      platform: process.platform,
      arch: process.arch,
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      isPackaged: app.isPackaged,
      userDataPath: app.getPath("userData"),
    };
  });

  // ── Auto-start toggle ─────────────────────────────────────────────
  ipcMain.handle("autostart:isEnabled", async () => {
    try {
      return await autoLauncher.isEnabled();
    } catch {
      return false;
    }
  });

  ipcMain.handle("autostart:setEnabled", async (_event, enabled: boolean) => {
    try {
      if (enabled) {
        await autoLauncher.enable();
      } else {
        await autoLauncher.disable();
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Check for updates manually ────────────────────────────────────
  ipcMain.handle("update:check", async () => {
    try {
      await autoUpdater.checkForUpdatesAndNotify();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Get platform ──────────────────────────────────────────────────
  ipcMain.handle("platform:get", async () => {
    return process.platform;
  });
}

// ── Security: CSP & Permissions ────────────────────────────────────────
function setupSecurity(): void {
  // Set CSP for renderer
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          IS_DEV
            ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:* ws://localhost:*; img-src 'self' data: https:; connect-src 'self' http://localhost:* ws://localhost:* https://*.supabase.co https://*.stripe.com"
            : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.supabase.co https://*.stripe.com",
        ],
      },
    });
  });
}

// ── App Lifecycle ───────────────────────────────────────────────────────
app.whenReady().then(() => {
  if (!IS_DEV) {
    registerAppProtocol();
  }
  setupSecurity();
  setupIpcHandlers();
  setupAutoUpdater();
  createTray();
  createMainWindow();

  app.on("activate", () => {
    // macOS: re-create window when dock icon clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else {
      showMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // On macOS, apps typically stay active until Cmd+Q
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
});

// macOS: prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });
}
