// Pure network-protocol helpers shared by src/net.js: room codes, ids, message checks, event routing.
// No DOM, no PeerJS.

export const PREFIX = 'owl-2611-';
export const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // v1 set: no I, L, O (look like 1 / 0)
export const CODE_LEN = 4;
export const HOST_PID = 'host';

export function genCode(rng = Math.random) {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_CHARS[Math.floor(rng() * CODE_CHARS.length)];
  return s;
}

export const peerIdFor = code => PREFIX + code;

// What a player typed → a code, or null if it cannot be one.
export function normalizeCode(input) {
  const c = String(input ?? '').trim().toUpperCase();
  if (c.length !== CODE_LEN) return null;
  for (const ch of c) if (!CODE_CHARS.includes(ch)) return null;
  return c;
}

// RFC 4122 v4 uuid. crypto.randomUUID only exists on secure origins (https / localhost), and a LAN
// http page is not one, so fall back to getRandomValues, then to rng.
export function uuid(c = globalThis.crypto, rng = Math.random) {
  if (typeof c?.randomUUID === 'function') {
    try { return c.randomUUID(); } catch { /* insecure context */ }
  }
  const b = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(rng() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Hex and dashes only: uuids pass; 'host', '__proto__', 'constructor' (any Object.prototype key) cannot.
const ID_RE = /^[0-9a-fA-F-]{8,64}$/;

export function cleanName(name) {
  return String(name ?? '').trim().slice(0, 12) || '탐정';
}

// A client's join message → { pid, key, name }, or null. `key` is a per-device secret that proves a
// rejoin is the same device: pids are public (they key S.players), so the pid alone cannot.
export function parseJoin(msg) {
  if (!msg || typeof msg !== 'object' || msg.t !== 'join') return null;
  if (typeof msg.pid !== 'string' || !ID_RE.test(msg.pid) || msg.pid === HOST_PID) return null;
  if (typeof msg.key !== 'string' || !ID_RE.test(msg.key)) return null;
  return { pid: msg.pid, key: msg.key, name: cleanName(msg.name) };
}

// A client's game message → a fresh action holding only the fields the reducer reads, or null.
// join / leave / next are not client actions here (join and leave are handled by the connection
// layer; next is host-only).
export function cleanAction(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const str = v => (typeof v === 'string' && v.length <= 64 ? v : null);
  switch (msg.t) {
    case 'pos': return { t: 'pos', x: msg.x, z: msg.z, ry: msg.ry, mv: msg.mv }; // rules checks the numbers
    case 'pick': case 'share': case 'useStairs': {
      const id = str(msg.id);
      return id === null ? null : { t: msg.t, id };
    }
    case 'vote': {
      const target = str(msg.target);
      return target === null ? null : { t: 'vote', target };
    }
    case 'discoverPassage': case 'sharePassage': case 'usePassage':
      return { t: msg.t };
    default: return null;
  }
}

// Who gets which events: every pid in `pids` gets the public events plus its own private ones.
// Returns { pid: event[] } with only non-empty lists.
export function routeEvents(events, priv, pids) {
  const out = {};
  for (const pid of pids) {
    const list = [...events, ...(priv?.[pid] ?? [])];
    if (list.length) out[pid] = list;
  }
  return out;
}

// The 10 Hz pose snapshot: { pid: { floor, x, z, ry, mv } }.
export function posesOf(S) {
  const out = {};
  for (const [pid, p] of Object.entries(S.players)) {
    out[pid] = { floor: p.floor, x: p.x, z: p.z, ry: p.ry, mv: p.mv };
  }
  return out;
}

// Remaining ms of a timed phase, or null for an untimed one.
export const phaseRemaining = (S, now) => (S.phaseEndsAt == null ? null : Math.max(0, S.phaseEndsAt - now));

export const isPhaseOver = (S, now) => S.phaseEndsAt != null && now >= S.phaseEndsAt;

// Did a (non-pos) action really change S? applyAction always clones, so compare contents.
export const stateChanged = (before, after) => before !== after && JSON.stringify(before) !== JSON.stringify(after);
