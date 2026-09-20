import type { HardpointApi } from '../shared/types';

declare global {
  interface Window {
    hardpoint: HardpointApi;
  }
}

export {};
