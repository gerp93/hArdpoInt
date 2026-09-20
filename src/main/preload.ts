import { contextBridge, ipcRenderer } from 'electron';
import type { HardpointApi } from '../shared/types';

const hardpoint: HardpointApi = {
  getStatus: () => ipcRenderer.invoke('hardpoint:getStatus'),
  ollamaStart: () => ipcRenderer.invoke('hardpoint:ollamaStart'),
  ollamaStop: () => ipcRenderer.invoke('hardpoint:ollamaStop'),
  ollamaUnload: (model?: string) => ipcRenderer.invoke('hardpoint:ollamaUnload', model),
  chatterboxStart: () => ipcRenderer.invoke('hardpoint:chatterboxStart'),
  chatterboxStop: () => ipcRenderer.invoke('hardpoint:chatterboxStop'),
  chooseOllamaDir: () => ipcRenderer.invoke('hardpoint:chooseOllamaDir'),
  chooseChatterboxDir: () => ipcRenderer.invoke('hardpoint:chooseChatterboxDir'),
};

contextBridge.exposeInMainWorld('hardpoint', hardpoint);
