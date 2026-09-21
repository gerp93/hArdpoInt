import { contextBridge, ipcRenderer } from 'electron';
import type { HardpointApi, Mount } from '../shared/types';

const hardpoint: HardpointApi = {
  getStatus: () => ipcRenderer.invoke('hardpoint:getStatus'),
  chooseMountDir: () => ipcRenderer.invoke('hardpoint:chooseMountDir'),
  runMountAction: (mountId, action) => ipcRenderer.invoke('hardpoint:runMountAction', mountId, action),
  listMounts: () => ipcRenderer.invoke('hardpoint:listMounts'),
  listMountTemplates: () => ipcRenderer.invoke('hardpoint:listMountTemplates'),
  scanServices: () => ipcRenderer.invoke('hardpoint:scanServices'),
  addFromTemplate: (templateId, overrides) =>
    ipcRenderer.invoke('hardpoint:addFromTemplate', templateId, overrides),
  saveMount: (mount: Mount) => ipcRenderer.invoke('hardpoint:saveMount', mount),
  deleteMount: (mountId: string) => ipcRenderer.invoke('hardpoint:deleteMount', mountId),
  clearCommandLog: () => ipcRenderer.invoke('hardpoint:clearCommandLog'),
  killGpuProcess: (pid: number) => ipcRenderer.invoke('hardpoint:killGpuProcess', pid),
  getAppVersion: () => ipcRenderer.invoke('hardpoint:getAppVersion'),
  checkForUpdates: () => ipcRenderer.invoke('hardpoint:checkForUpdates'),
};

contextBridge.exposeInMainWorld('hardpoint', hardpoint);
