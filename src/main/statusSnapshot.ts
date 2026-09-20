import type { DashboardStatus } from '../shared/types';
import {
  getChatterboxHostForStatus,
  getChatterboxLaunchDirForStatus,
  isReachable as isChatterboxReachable,
  readDeviceHint,
} from './chatterbox';
import { getGpuSnapshot } from './gpu';
import { resolveOllamaLaunchDir } from './launch';
import {
  getOllamaHostForStatus,
  isReachable as isOllamaReachable,
  listLoaded,
} from './ollama';

export async function buildDashboardStatus(): Promise<DashboardStatus> {
  const [gpu, ollamaReachable, chatterboxReachable, loadedModels] = await Promise.all([
    getGpuSnapshot(),
    isOllamaReachable(),
    isChatterboxReachable(),
    isOllamaReachable().then((ok) => (ok ? listLoaded() : Promise.resolve([]))),
  ]);

  const ollamaLaunchDir = resolveOllamaLaunchDir();
  const chatterboxLaunchDir = getChatterboxLaunchDirForStatus();

  return {
    gpu,
    ollama: {
      reachable: ollamaReachable,
      host: getOllamaHostForStatus(),
      launchDir: ollamaLaunchDir,
      loadedModels,
    },
    chatterbox: {
      reachable: chatterboxReachable,
      host: getChatterboxHostForStatus(),
      launchDir: chatterboxLaunchDir,
      deviceHint: readDeviceHint(chatterboxLaunchDir),
    },
  };
}
