import { contextBridge, ipcRenderer } from 'electron';
import type { CommandEvent } from '../shared/commandSchema';
import type { AgentEvent, HardpointApi, Mount } from '../shared/types';

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
  listMcpServers: () => ipcRenderer.invoke('hardpoint:listMcpServers'),
  stopMcpServer: (pid: number) => ipcRenderer.invoke('hardpoint:stopMcpServer', pid),
  addMcpConfigFile: () => ipcRenderer.invoke('hardpoint:addMcpConfigFile'),
  removeMcpConfigFile: (file: string) => ipcRenderer.invoke('hardpoint:removeMcpConfigFile', file),
  commands: {
    list: () => ipcRenderer.invoke('commands:list'),
    save: (command) => ipcRenderer.invoke('commands:save', command),
    delete: (id) => ipcRenderer.invoke('commands:delete', id),
    saveHost: (host) => ipcRenderer.invoke('commands:saveHost', host),
    deleteHost: (id) => ipcRenderer.invoke('commands:deleteHost', id),
    run: (id) => ipcRenderer.invoke('commands:run', id),
    cancel: (runId) => ipcRenderer.invoke('commands:cancel', runId),
    testHost: (hostId) => ipcRenderer.invoke('commands:testHost', hostId),
    clearRun: (id) => ipcRenderer.invoke('commands:clearRun', id),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: CommandEvent) => listener(payload);
      ipcRenderer.on('commands:event', handler);
      return () => ipcRenderer.removeListener('commands:event', handler);
    },
  },
  agent: {
    send: (text) => ipcRenderer.invoke('agent:send', text),
    interrupt: () => ipcRenderer.invoke('agent:interrupt'),
    reset: () => ipcRenderer.invoke('agent:reset'),
    approve: (requestId, allow) => ipcRenderer.invoke('agent:approve', requestId, allow),
    login: () => ipcRenderer.invoke('agent:login'),
    submitLoginCode: (code) => ipcRenderer.invoke('agent:loginCode', code),
    authStatus: () => ipcRenderer.invoke('agent:authStatus'),
    getWorkspace: () => ipcRenderer.invoke('agent:getWorkspace'),
    chooseWorkspace: () => ipcRenderer.invoke('agent:chooseWorkspace'),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: AgentEvent) => listener(payload);
      ipcRenderer.on('agent:event', handler);
      return () => ipcRenderer.removeListener('agent:event', handler);
    },
  },
};

contextBridge.exposeInMainWorld('hardpoint', hardpoint);
