import { app, BrowserWindow, Menu, shell, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';
import { startApiServer, stopApiServer } from './apiServer';
import { buildDashboardStatus } from './statusSnapshot';
import {
  chooseChatterboxLaunchDir,
  chooseOllamaLaunchDir,
  startChatterbox,
  startOllama,
  stopChatterbox,
  stopOllama,
} from './launch';
import { unloadAll, unloadModel } from './ollama';

app.setName(app.isPackaged ? 'hardpoint' : 'hardpoint-dev');

const DEV_SERVER_URL = 'http://localhost:5174';
const REPO_URL = 'https://github.com/gerp93/hArdpoInt';
const ISSUES_URL = `${REPO_URL}/issues`;

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!app.isPackaged) {
    void mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';

  const viewMenu: Electron.MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  };

  const helpMenu: Electron.MenuItemConstructorOptions = {
    label: 'Help',
    role: 'help',
    submenu: [
      {
        label: 'GitHub Repository',
        click: () => void shell.openExternal(REPO_URL),
      },
      {
        label: 'Report an Issue',
        click: () => void shell.openExternal(ISSUES_URL),
      },
      { type: 'separator' },
      {
        label: `Version ${app.getVersion()}`,
        enabled: false,
      },
    ],
  };

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    viewMenu,
    helpMenu,
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc(): void {
  ipcMain.handle('hardpoint:getStatus', () => buildDashboardStatus());
  ipcMain.handle('hardpoint:ollamaStart', () => startOllama());
  ipcMain.handle('hardpoint:ollamaStop', () => stopOllama());
  ipcMain.handle('hardpoint:ollamaUnload', (_event, model?: string) =>
    model?.trim() ? unloadModel(model.trim()) : unloadAll()
  );
  ipcMain.handle('hardpoint:chatterboxStart', () => startChatterbox());
  ipcMain.handle('hardpoint:chatterboxStop', () => stopChatterbox());
  ipcMain.handle('hardpoint:chooseOllamaDir', () => chooseOllamaLaunchDir(mainWindow));
  ipcMain.handle('hardpoint:chooseChatterboxDir', () => chooseChatterboxLaunchDir(mainWindow));
}

function setupAutoUpdater(): void {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (err) => console.error('Auto-update error:', err));
  autoUpdater.checkForUpdates().catch((err) => console.error('Update check failed:', err));
}

app.whenReady().then(() => {
  buildMenu();
  registerIpc();
  startApiServer();
  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopApiServer();
});
