import { app, BrowserWindow, Menu, shell, ipcMain, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';
import { startApiServer, stopApiServer } from './apiServer';
import { killActiveGpuProcess } from './gpu';
import { buildDashboardStatus } from './statusSnapshot';
import { chooseMountDir } from './launch';
import { clearCommandLog } from './commandLog';
import {
  addFromTemplate,
  deleteMount,
  listMounts,
  listMountTemplates,
  runMountAction,
  saveMount,
} from './services';
import { scanLocalhostServices } from './scan';
import type { Mount, UpdateCheckResult } from '../shared/types';

app.setName(app.isPackaged ? 'hardpoint' : 'hardpoint-dev');

const DEV_SERVER_URL = 'http://localhost:5174';
const REPO_URL = 'https://github.com/gerp93/hArdpoInt';
const ISSUES_URL = `${REPO_URL}/issues`;

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    icon: path.join(__dirname, '../../../assets/icon.png'),
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
        label: 'Check for Updates…',
        click: () => {
          void checkForUpdatesNow().then((result) => {
            if (!mainWindow) return;
            if (result.status === 'available') {
              void dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Update available',
                message: `Hardpoint ${result.version} is available.`,
                detail: 'It will download in the background and install when you restart.',
              });
            } else if (result.status === 'not-available') {
              void dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Up to date',
                message: `You're running Hardpoint ${app.getVersion()}.`,
              });
            } else if (result.status === 'unsupported') {
              void dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Updates',
                message: 'Update checks are only available in a packaged build.',
              });
            } else {
              void dialog.showMessageBox(mainWindow, {
                type: 'error',
                title: 'Update check failed',
                message: result.message ?? 'Unknown error',
              });
            }
          });
        },
      },
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
  ipcMain.handle('hardpoint:chooseMountDir', () => chooseMountDir(mainWindow));
  ipcMain.handle('hardpoint:runMountAction', (_event, mountId: string, action) =>
    runMountAction(mountId, action)
  );
  ipcMain.handle('hardpoint:listMounts', () => listMounts());
  ipcMain.handle('hardpoint:listMountTemplates', () => listMountTemplates());
  ipcMain.handle('hardpoint:scanServices', () => scanLocalhostServices());
  ipcMain.handle(
    'hardpoint:addFromTemplate',
    (_event, templateId: string, overrides?: Partial<Pick<Mount, 'name' | 'hostUrl'>>) =>
      addFromTemplate(templateId, overrides)
  );
  ipcMain.handle('hardpoint:saveMount', (_event, mount: Mount) => saveMount(mount));
  ipcMain.handle('hardpoint:deleteMount', (_event, mountId: string) => deleteMount(mountId));
  ipcMain.handle('hardpoint:clearCommandLog', () => {
    clearCommandLog();
    return { status: 'ok' as const };
  });
  ipcMain.handle('hardpoint:killGpuProcess', (_event, pid: number) => killActiveGpuProcess(pid));
  ipcMain.handle('hardpoint:getAppVersion', () => app.getVersion());
  ipcMain.handle('hardpoint:checkForUpdates', () => checkForUpdatesNow());
}

/** Silent background check on launch; prompts when a download finishes. */
function setupAutoUpdater(): void {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', (info) => {
    const win = mainWindow;
    if (!win) return;
    void dialog
      .showMessageBox(win, {
        type: 'info',
        title: 'Update ready',
        message: `Hardpoint ${info.version} has been downloaded.`,
        detail: 'Restart now to install it, or it will install automatically the next time you quit.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-update error:', err);
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.error('Failed to check for updates:', err);
  });
}

function checkForUpdatesNow(): Promise<UpdateCheckResult> {
  if (!app.isPackaged) {
    return Promise.resolve({ status: 'unsupported' });
  }

  return new Promise((resolve) => {
    const cleanup = () => {
      autoUpdater.removeListener('update-available', onAvailable);
      autoUpdater.removeListener('update-not-available', onNotAvailable);
      autoUpdater.removeListener('error', onError);
    };
    const onAvailable = (info: { version: string }) => {
      cleanup();
      resolve({ status: 'available', version: info.version });
    };
    const onNotAvailable = () => {
      cleanup();
      resolve({ status: 'not-available' });
    };
    const onError = (err: Error) => {
      cleanup();
      const message = err?.message ?? String(err);
      resolve({
        status: 'error',
        message: message.includes('Cannot find latest')
          ? 'A new version may still be uploading — try again in a few minutes.'
          : message,
      });
    };

    autoUpdater.once('update-available', onAvailable);
    autoUpdater.once('update-not-available', onNotAvailable);
    autoUpdater.once('error', onError);
    autoUpdater.checkForUpdates().catch(onError);
  });
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
