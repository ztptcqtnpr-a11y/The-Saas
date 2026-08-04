// Offline-first queue for staff-facing apps (waiter, kitchen, barista).
// Every write action (create_order, update_order_status, checkin, checkout)
// is written to IndexedDB immediately, then attempted against staff-api.
// If the network call fails, the action stays queued and is retried whenever
// the browser's online event fires or a periodic retry interval elapses.
//
// Reads (get_menu, get_orders, lookup_customer) are NOT queued -- they need a
// live answer and simply fail with a clear error if offline, since serving
// stale menu/order data silently would be worse than an explicit "offline" state.

const DB_NAME = "restaurant_offline_queue";
const DB_VERSION = 1;
const STORE_NAME = "pending_actions";

type QueuedAction = {
  id: string; // client-generated UUID, doubles as idempotency key
  token: string;
  pin: string;
  action: string;
  payload: Record<string, unknown>;
  createdAt: number;
  attempts: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveAction(action: QueuedAction): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(action);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function removeAction(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllActions(): Promise<QueuedAction[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result as QueuedAction[]);
    req.onerror = () => reject(req.error);
  });
}

function genId(): string {
  return crypto.randomUUID();
}

const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/staff-api";

async function attemptSend(action: QueuedAction): Promise<boolean> {
  try {
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: action.action,
        token: action.token,
        pin: action.pin,
        clientGeneratedId: action.id, // lets server dedupe if this action was already synced
        ...action.payload,
      }),
    });
    return res.ok;
  } catch {
    return false; // network error, still offline
  }
}

let flushInFlight = false;

// Attempt to send every queued action. Called on 'online' event, on an
// interval, and after every new queued write (in case connectivity is
// actually fine and the previous failure was transient).
export async function flushQueue(onFlushed?: (action: QueuedAction, success: boolean) => void): Promise<void> {
  if (flushInFlight) return;
  flushInFlight = true;
  try {
    const actions = await getAllActions();
    // Send in creation order so e.g. checkin happens before the orders it produced.
    actions.sort((a, b) => a.createdAt - b.createdAt);
    for (const action of actions) {
      const success = await attemptSend(action);
      if (success) {
        await removeAction(action.id);
      }
      onFlushed?.(action, success);
      if (!success) {
        // Stop on first failure -- likely still offline, no point hammering
        // the rest of the queue with certain failures.
        break;
      }
    }
  } finally {
    flushInFlight = false;
  }
}

// Queue a write action. Returns immediately (optimistic) -- caller should
// update local UI state right away rather than waiting for sync confirmation.
export async function queueAction(token: string, pin: string, action: string, payload: Record<string, unknown> = {}): Promise<string> {
  const queued: QueuedAction = {
    id: genId(),
    token,
    pin,
    action,
    payload,
    createdAt: Date.now(),
    attempts: 0,
  };
  await saveAction(queued);
  // Try immediately in case we're actually online -- don't wait for the
  // 'online' event, which won't fire if the browser never went offline.
  flushQueue();
  return queued.id;
}

export async function getPendingCount(): Promise<number> {
  const actions = await getAllActions();
  return actions.length;
}

export function setupAutoFlush(intervalMs = 15000) {
  if (typeof window === "undefined") return () => {};
  const onOnline = () => flushQueue();
  window.addEventListener("online", onOnline);
  const interval = setInterval(() => flushQueue(), intervalMs);
  return () => {
    window.removeEventListener("online", onOnline);
    clearInterval(interval);
  };
}
