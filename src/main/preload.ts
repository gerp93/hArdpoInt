import { contextBridge, ipcRenderer } from 'electron';
import type { HardpointApi, ManagedService } from '../shared/types';

const hardpoint: HardpointApi = {
  getStatus: () => ipcRenderer.invoke('hardpoint:getStatus'),
  ollamaStart: () => ipcRenderer.invoke('hardpoint:ollamaStart'),
  ollamaStop: () => ipcRenderer.invoke('hardpoint:ollamaStop'),
  ollamaUnload: (model?: string) => ipcRenderer.invoke('hardpoint:ollamaUnload', model),
  chatterboxStart: () => ipcRenderer.invoke('hardpoint:chatterboxStart'),
  chatterboxStop: () => ipcRenderer.invoke('hardpoint:chatterboxStop'),
  chooseOllamaDir: () => ipcRenderer.invoke('hardpoint:chooseOllamaDir'),
  chooseChatterboxDir: () => ipcRenderer.invoke('hardpoint:chooseChatterboxDir'),
  chooseServiceDir: () => ipcRenderer.invoke('hardpoint:chooseServiceDir'),
  runServiceAction: (serviceId: string, actionId: string) =>
    ipcRenderer.invoke('hardpoint:runServiceAction', serviceId, actionId),
  listServices: () => ipcRenderer.invoke('hardpoint:listServices'),
  listPresets: () => ipcRenderer.invoke('hardpoint:listPresets'),
  scanServices: () => ipcRenderer.invoke('hardpoint:scanServices'),
  addFromPreset: (presetId, overrides) =>
    ipcRenderer.invoke('hardpoint:addFromPreset', presetId, overrides),
  saveService: (service: ManagedService) => ipcRenderer.invoke('hardpoint:saveService', service),
  deleteService: (serviceId: string) => ipcRenderer.invoke('hardpoint:deleteService', serviceId),
  clearCommandLog: () => ipcRenderer.invoke('hardpoint:clearCommandLog'),
  getAppVersion: () => ipcRenderer.invoke('hardpoint:getAppVersion'),
  checkForUpdates: () => ipcRenderer.invoke('hardpoint:checkForUpdates'),
};

contextBridge.exposeInMainWorld('hardpoint', hardpoint);
