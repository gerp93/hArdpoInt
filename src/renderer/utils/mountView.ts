import type { DashboardMount } from '../../shared/types';

export type StatusFilter = 'all' | 'up' | 'down' | 'unknown';
export type SortKey = 'added' | 'name-asc' | 'name-desc' | 'up-first' | 'down-first';

export interface MountView {
  filter: StatusFilter;
  sort: SortKey;
  query: string;
}

export const DEFAULT_VIEW: MountView = { filter: 'all', sort: 'added', query: '' };

export const SORT_LABELS: Record<SortKey, string> = {
  added: 'Added order',
  'name-asc': 'Name A–Z',
  'name-desc': 'Name Z–A',
  'up-first': 'Up first',
  'down-first': 'Down first',
};

const STORAGE_KEY = 'hardpoint-mount-view';

export type MountState = 'up' | 'down' | 'unknown';

export function mountState(mount: DashboardMount): MountState {
  return mount.reachable === true ? 'up' : mount.reachable === false ? 'down' : 'unknown';
}

function matchesQuery(mount: DashboardMount, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [mount.name, mount.id, mount.hostUrl, mount.launch.cwd].some(
    (field) => typeof field === 'string' && field.toLowerCase().includes(q)
  );
}

const byName = (a: DashboardMount, b: DashboardMount) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

const RANK_UP_FIRST: Record<MountState, number> = { up: 0, unknown: 1, down: 2 };
const RANK_DOWN_FIRST: Record<MountState, number> = { down: 0, unknown: 1, up: 2 };

/** Mounts matching the search text, before the status filter (used for the chip counts). */
export function searchMounts(mounts: DashboardMount[], query: string): DashboardMount[] {
  return mounts.filter((m) => matchesQuery(m, query));
}

export function countByState(mounts: DashboardMount[]): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = { all: mounts.length, up: 0, down: 0, unknown: 0 };
  for (const m of mounts) counts[mountState(m)]++;
  return counts;
}

/** Search + status filter + sort. Sorting is stable, so ties keep the added order. */
export function applyMountView(mounts: DashboardMount[], view: MountView): DashboardMount[] {
  const shown = searchMounts(mounts, view.query).filter(
    (m) => view.filter === 'all' || mountState(m) === view.filter
  );
  switch (view.sort) {
    case 'name-asc':
      return [...shown].sort(byName);
    case 'name-desc':
      return [...shown].sort((a, b) => byName(b, a));
    case 'up-first':
      return [...shown].sort((a, b) => RANK_UP_FIRST[mountState(a)] - RANK_UP_FIRST[mountState(b)] || byName(a, b));
    case 'down-first':
      return [...shown].sort(
        (a, b) => RANK_DOWN_FIRST[mountState(a)] - RANK_DOWN_FIRST[mountState(b)] || byName(a, b)
      );
    default:
      return shown;
  }
}

export function isDefaultView(view: MountView): boolean {
  return view.filter === DEFAULT_VIEW.filter && view.sort === DEFAULT_VIEW.sort && view.query === '';
}

export function loadView(): MountView {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<MountView> | null;
    if (!raw) return DEFAULT_VIEW;
    return {
      filter: ['all', 'up', 'down', 'unknown'].includes(raw.filter ?? '') ? (raw.filter as StatusFilter) : 'all',
      sort: raw.sort && raw.sort in SORT_LABELS ? raw.sort : 'added',
      query: typeof raw.query === 'string' ? raw.query : '',
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

export function saveView(view: MountView): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(view));
  } catch {
    /* storage unavailable */
  }
}
