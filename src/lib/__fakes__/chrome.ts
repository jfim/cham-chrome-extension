type StoreArea = Record<string, unknown>;

function makeStorageArea() {
  let store: StoreArea = {};
  return {
    async get(keys?: string | string[] | StoreArea | null): Promise<StoreArea> {
      if (keys == null) return { ...store };
      if (typeof keys === 'string') return { [keys]: store[keys] };
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.map((k) => [k, store[k]]));
      }
      const out: StoreArea = {};
      for (const [k, fallback] of Object.entries(keys)) {
        out[k] = k in store ? store[k] : fallback;
      }
      return out;
    },
    async set(items: StoreArea): Promise<void> {
      store = { ...store, ...items };
    },
    async remove(keys: string | string[]): Promise<void> {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) delete store[k];
    },
    async clear(): Promise<void> {
      store = {};
    },
    _reset(): void {
      store = {};
    },
  };
}

const alarms = new Map<string, { name: string; periodInMinutes?: number; when?: number }>();

function makeAlarms() {
  return {
    async create(name: string, info: { periodInMinutes?: number; when?: number }) {
      alarms.set(name, { name, ...info });
    },
    async getAll() {
      return Array.from(alarms.values());
    },
    async clear(name: string) {
      return alarms.delete(name);
    },
    onAlarm: { addListener: (_fn: unknown) => {} },
    _reset() {
      alarms.clear();
    },
  };
}

const sync = makeStorageArea();
const local = makeStorageArea();
const alarmsApi = makeAlarms();

export function installChromeFake(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).chrome = {
    storage: { sync, local },
    alarms: alarmsApi,
    runtime: {
      onInstalled: { addListener: (_fn: unknown) => {} },
      sendMessage: async (_msg: unknown) => undefined,
      onMessage: { addListener: (_fn: unknown) => {} },
    },
    notifications: {
      create: async (_id: string, _opts: unknown) => 'noop',
    },
    webNavigation: {
      onCompleted: { addListener: (_fn: unknown) => {} },
    },
  };
}

export function resetChromeFake(): void {
  sync._reset();
  local._reset();
  alarmsApi._reset();
}
