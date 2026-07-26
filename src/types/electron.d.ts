/**
 * Type declarations for the HSMC Desktop Wallet Electron bridge.
 *
 * In the Electron desktop app, the preload script exposes `window.hsmcDesktop`.
 * In the web browser, `window.hsmcDesktop` is undefined — guard with:
 *   const isDesktop = typeof window !== "undefined" && window.hsmcDesktop;
 */

interface HsmcDesktopAPI {
  getPlatform(): Promise<string>;
  getAppInfo(): Promise<{
    version: string;
    name: string;
    platform: string;
    arch: string;
    electronVersion: string;
    nodeVersion: string;
    isPackaged: boolean;
    userDataPath: string;
  }>;
  openFileDialog(options?: Record<string, unknown>): Promise<{
    canceled: boolean;
    filePaths?: string[];
  }>;
  saveFileDialog(options?: Record<string, unknown>): Promise<{
    canceled: boolean;
    filePath?: string;
  }>;
  exportWalletToFile(
    data: string,
    suggestedName?: string
  ): Promise<{
    success: boolean;
    filePath?: string;
    canceled?: boolean;
    error?: string;
  }>;
  importWalletFromFile(): Promise<{
    success: boolean;
    content?: string;
    filePath?: string;
    canceled?: boolean;
    error?: string;
  }>;
  showNotification(
    title: string,
    body: string
  ): Promise<{ success: boolean; error?: string }>;
  isAutoStartEnabled(): Promise<boolean>;
  setAutoStartEnabled(
    enabled: boolean
  ): Promise<{ success: boolean; error?: string }>;
  checkForUpdates(): Promise<{ success: boolean; error?: string }>;
  onUpdateAvailable(callback: (info: unknown) => void): () => void;
  onUpdateDownloadProgress(
    callback: (progress: {
      percent: number;
      bytesPerSecond: number;
      total: number;
      transferred: number;
    }) => void
  ): () => void;
  onUpdateDownloaded(callback: (info: unknown) => void): () => void;
  onUpdateError(callback: (error: string) => void): () => void;
}

interface Window {
  hsmcDesktop?: HsmcDesktopAPI;
}
