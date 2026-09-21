import { BrowserWindow, dialog } from 'electron';

/** Generic launch-folder picker for mounts. */
export async function chooseMountDir(
  window: BrowserWindow | null
): Promise<{ status: 'ok'; dir: string } | { status: 'cancelled' } | { status: 'error'; message: string }> {
  if (!window) return { status: 'error', message: 'No window to show the folder picker.' };
  const result = await dialog.showOpenDialog(window, {
    title: 'Choose launch folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return { status: 'cancelled' };
  return { status: 'ok', dir: result.filePaths[0] };
}
