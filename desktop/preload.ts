import { contextBridge, ipcRenderer } from "electron";

/**
 * HSMC Desktop Wallet — Preload Script
 *
 * Exposes a secure `window.hsmcDesktop` API to the renderer process via
 * contextBridge. All IPC calls go through whitelisted channels only — the
 * renderer never has direct access to Node.js or Electron internals.
 */

export interface AppInfo {
  version: string;
  name: string;
  platform: string;
  arch: string;
  electronVersion: string;
  nodeVersion: string;
  isPackaged: boolean;
  userDataPath: string;
}

export interface FileDialogResult {
  canceled: boolean;
  filePaths?: string[];
  filePath?: string;
}

export interface ExportResult {
  success: boolean;
  filePath?: string;
  canceled?: boolean;
  error?: string;
}

export interface ReadFileResult {
  success: boolean;
  content?: string;
  filePath?: string;
  canceled?: boolean;
  error?: string;
}

export interface UpdateProgress {
  percent: number;
  bytesPerSecond: number;
  total: number;
  transferred: number;
}

const hsmcDesktop = {
  // ── Platform ────────────────────────────────────────────────────────
  /** Get the current OS platform (win32, darwin, linux) */
  getPlatform: (): Promise<string> => ipcRenderer.invoke("platform:get"),

  // ── App Info ────────────────────────────────────────────────────────
  /** Get application metadata (version, platform, paths) */
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke("app:getInfo"),

  // ── File Dialogs ────────────────────────────────────────────────────
  /** Open native file picker dialog */
  openFileDialog: (
    options?: Record<string, unknown>
  ): Promise<FileDialogResult> =>
    ipcRenderer.invoke("dialog:openFile", options || {}),

  /** Open native save file dialog */
  saveFileDialog: (
    options?: Record<string, unknown>
  ): Promise<FileDialogResult> =>
    ipcRenderer.invoke("dialog:saveFile", options || {}),

  // ── Wallet Export / Import ──────────────────────────────────────────
  /**
   * Export wallet data to a file on disk.
   * Opens a save dialog, then writes the provided data.
   */
  exportWalletToFile: (
    data: string,
    suggestedName?: string
  ): Promise<ExportResult> =>
    ipcRenderer.invoke("wallet:exportToFile", data, suggestedName),

  /**
   * Import wallet data from a file on disk.
   * Opens an open dialog, then reads the selected file.
   */
  importWalletFromFile: (): Promise<ReadFileResult> =>
    ipcRenderer.invoke("wallet:readFile"),

  // ── Notifications ───────────────────────────────────────────────────
  /** Show a native OS notification */
  showNotification: (title: string, body: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("notify:show", title, body),

  // ── Auto-start ──────────────────────────────────────────────────────
  /** Check if auto-launch on system start is enabled */
  isAutoStartEnabled: (): Promise<boolean> =>
    ipcRenderer.invoke("autostart:isEnabled"),

  /** Enable or disable auto-launch on system start */
  setAutoStartEnabled: (
    enabled: boolean
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("autostart:setEnabled", enabled),

  // ── Updates ─────────────────────────────────────────────────────────
  /** Manually check for updates */
  checkForUpdates: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("update:check"),

  /**
   * Listen for update events from the main process.
   * Returns an unsubscribe function.
   */
  onUpdateAvailable: (callback: (info: unknown) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: unknown) =>
      callback(info);
    ipcRenderer.on("update-available", handler);
    return () => ipcRenderer.removeListener("update-available", handler);
  },

  onUpdateDownloadProgress: (
    callback: (progress: UpdateProgress) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: UpdateProgress
    ) => callback(progress);
    ipcRenderer.on("update-download-progress", handler);
    return () =>
      ipcRenderer.removeListener("update-download-progress", handler);
  },

  onUpdateDownloaded: (callback: (info: unknown) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, info: unknown) =>
      callback(info);
    ipcRenderer.on("update-downloaded", handler);
    return () => ipcRenderer.removeListener("update-downloaded", handler);
  },

  onUpdateError: (callback: (error: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: string) =>
      callback(error);
    ipcRenderer.on("update-error", handler);
    return () => ipcRenderer.removeListener("update-error", handler);
  },
};

// ── Expose to renderer ──────────────────────────────────────────────────
contextBridge.exposeInMainWorld("hsmcDesktop", hsmcDesktop);

// ── Type augmentation for renderer (consumed via global types) ─────────
export type HsmcDesktopAPI = typeof hsmcDesktop;
