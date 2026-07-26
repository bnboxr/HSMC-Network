# HSMC Desktop Wallet

Electron desktop application for the HSMC Network — a privacy-first blockchain wallet.

## Quick Start

```bash
# Install dependencies (from desktop/ directory)
npm install

# Development mode (requires Vite dev server running on port 3000)
npm run dev

# Or start Electron with existing dev server
npm run dev:electron

# Build for current platform
npm run dist

# Build for specific platforms
npm run dist:win      # Windows (.exe, .msi)
npm run dist:mac      # macOS (.dmg)
npm run dist:linux    # Linux (.AppImage, .deb)
```

## Architecture

```
desktop/
├── main.ts           # Electron main process — window, tray, auto-update, IPC
├── preload.ts        # Secure bridge (contextBridge) → window.hsmcDesktop
├── tsconfig.json     # TypeScript config for main/preload compilation
├── package.json      # Dependencies + electron-builder config
├── dist-electron/    # Compiled JS output (gitignored)
└── release/          # Packaged installers (gitignored)
```

### How it works

1. **Main process** (`main.ts`): Creates the BrowserWindow, system tray, manages auto-start via `auto-launch`, and handles auto-updates via `electron-updater`.
2. **Preload** (`preload.ts`): Exposes a secure `window.hsmcDesktop` API to the React renderer via `contextBridge`. The renderer never has direct Node.js access.
3. **Renderer**: The existing React + Vite frontend. In development, it loads from `http://localhost:3000`. In production, it loads from the built `dist/` directory through a custom `hsmc-app://` protocol that supports SPA routing.

### Native Features

| Feature | API |
|---------|-----|
| File export/import | `window.hsmcDesktop.exportWalletToFile()` / `.importWalletFromFile()` |
| System notifications | `window.hsmcDesktop.showNotification(title, body)` |
| Auto-start on boot | `window.hsmcDesktop.setAutoStartEnabled(bool)` |
| Auto-update | Listens via `.onUpdateAvailable()`, `.onUpdateDownloaded()` |
| Platform detection | `window.hsmcDesktop.getPlatform()` |
