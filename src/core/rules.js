// Pure game-rules reducer: no DOM, no three.js. The host runs applyAction for every action.
import { roomAt } from './map.js';

const HOST = 'host';
const ITEM_PHASES = ['investigate1', 'midtalk', 'investigate2', 'finaltalk'];

const phaseIndex = (caseData, id) => caseData.PHASES.findIndex(p => p.id === id);
const roomName = (caseData, roomId) => caseData.MAP.rooms.find(r => r.id === roomId)?.name ?? roomId;
const caseRoles = caseData => Object.keys(caseData.ROLES).filter(r => r !== 'helper');
const toast = text => ({ type: 'toast', text });
// Server-side reach: the client arrives within 1.6 m (walk.js ARRIVE); 2.0 m leaves room for lag.
export const REACH = 2.0;
const TOO_FAR = '너무 멀어요';
const near = (p, x, z) => (p.x - x) ** 2 + (p.z - z) ** 2 <= REACH * REACH;

export function createState(caseData) {
  const first = caseData.PHASES[0];
  return {
    phase: first.id,
    phaseEndsAt: null,
    players: {},
    order: [],
    items: {},
    passageKnown: {},
    passageShared: false,
    votes: {},
    floorsOpen: [...(first.floors ?? [0])],
  };
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function assignRoles(pids, caseData, rng = Math.random) {
  const out = {};
  const roles = caseRoles(caseData);
  const culprit = caseData.culprit ?? caseData.CULPRIT;
  const order = pids;
  const pool = shuffle(roles, rng);
  const n = Math.min(order.length, roles.length);
  let chosen = pool.slice(0, n);
  if (order.length >= 2 && culprit && !chosen.includes(culprit)) {
    chosen[chosen.length - 1] = culprit;
  }
  chosen = shuffle(chosen, rng);
  order.forEach((pid, i) => { out[pid] = i < n ? chosen[i] : 'helper'; });
  return out;
}

export function canUsePassage(S, caseData, pid) {
  const p = S.players[pid];
  if (!p) return false;
  return !!(caseData.ROLES[p.role]?.knowsPassage || S.passageKnown[pid] || S.passageShared);
}

export function visibleItem(S, pid, itemId) {
  const it = S.items[itemId];
  if (!it || !it.holder) return 'present';
  if (it.shared) return 'shared';
  return it.holder === pid ? 'mine' : 'gone';
}

export function tally(S, caseData) {
  const counts = {};
  let voters = 0;
  for (const [pid, target] of Object.entries(S.votes)) {
    if (!S.players[pid]?.online) continue;
    counts[target] = (counts[target] ?? 0) + 1;
    voters++;
  }
  const max = Math.max(0, ...Object.values(counts));
  const top = max > 0 ? Object.keys(counts).filter(k => counts[k] === max) : [];
  const culprit = caseData.culprit ?? caseData.CULPRIT;
  return { counts, top, caught: top.length === 1 && top[0] === culprit, voters };
}

function hallSpots(caseData, n) {
  const r = caseData.MAP.rooms.find(x => x.id === 'hall').rect;
  const cx = (r[0] + r[2]) / 2, cz = (r[1] + r[3]) / 2 - 1;
  return Array.from({ length: n }, (_, i) => ({ x: cx + (i - (n - 1) / 2), z: cz }));
}

function enterPhase(S, caseData, id, now, events) {
  const ph = caseData.PHASES.find(p => p.id === id);
  S.phase = id;
  S.phaseEndsAt = ph.ms ? now + ph.ms : null;
  S.floorsOpen = [...(ph.floors ?? [0, 1])];
  events.push({ type: 'phase', phase: id });
  if (id === 'intro') {
    const pids = S.order.filter(p => S.players[p]);
    const roles = assignRoles(pids, caseData, S.rng);
    const spots = hallSpots(caseData, pids.length);
    pids.forEach((pid, i) => {
      const p = S.players[pid];
      p.role = roles[pid];
      p.floor = 0; p.x = spots[i].x; p.z = spots[i].z;
      events.push({ type: 'teleport', pid, floor: 0, x: p.x, z: p.z });
    });
  }
}

function floorOfRoom(caseData, roomId) {
  return caseData.MAP.rooms.find(r => r.id === roomId)?.floor;
}

function teleportTo(S, pid, end, caseData, events) {
  const p = S.players[pid];
  p.floor = floorOfRoom(caseData, end.room); p.x = end.x; p.z = end.z;
  events.push({ type: 'teleport', pid, floor: p.floor, x: p.x, z: p.z });
}

export function applyAction(S0, caseData, action, fromPid, now, rng = Math.random) {
  const S = structuredClone(S0);
  S.rng = rng; // transient, removed before return
  const events = [];
  const priv = {};
  const reject = text => { (priv[fromPid] ??= []).push(toast(text)); };
  const p = S.players[fromPid];
  const inItemPhase = ITEM_PHASES.includes(S.phase);

  switch (action?.t) {
    case 'join': {
      if (p) { p.online = true; break; }
      const used = new Set(Object.values(S.players).map(x => x.role).filter(Boolean));
      let role = null;
      if (S.phase !== 'lobby') role = caseRoles(caseData).find(r => !used.has(r)) ?? 'helper';
      const spot = hallSpots(caseData, 1)[0];
      S.players[fromPid] = { name: action.name ?? fromPid, role, online: true, floor: 0, x: spot.x, z: spot.z, ry: 0, mv: 0 };
      S.order.push(fromPid);
      break;
    }
    case 'leave': {
      if (!p) break;
      if (S.phase === 'lobby') {
        delete S.players[fromPid];
        S.order = S.order.filter(x => x !== fromPid);
      } else p.online = false;
      break;
    }
    case 'pos': {
      // floor is server-owned (changed only by the stairs/passage teleport); a client's floor is ignored
      if (!p || !Number.isFinite(action.x) || !Number.isFinite(action.z)) break;
      p.x = action.x; p.z = action.z;
      if (Number.isFinite(action.ry)) p.ry = action.ry;
      p.mv = Number.isFinite(action.mv) ? Math.min(1, Math.max(0, action.mv)) : 0;
      break;
    }
    case 'next': {
      if (fromPid !== HOST) break;
      const i = phaseIndex(caseData, S.phase);
      if (i < 0 || i >= caseData.PHASES.length - 1) break;
      enterPhase(S, caseData, caseData.PHASES[i + 1].id, now, events);
      break;
    }
    case 'pick': {
      if (!p || !inItemPhase) break;
      const item = caseData.ITEMS.find(i => i.id === action.id);
      if (!item || item.kind !== 'portable') break;
      if (S.items[item.id]?.holder) break;
      const [ix, , iz] = item.pos;
      if (p.floor !== floorOfRoom(caseData, item.room) || roomAt(caseData.MAP, p.floor, p.x, p.z) !== item.room
          || !near(p, ix, iz)) { reject(TOO_FAR); break; }
      S.items[item.id] = { holder: fromPid, shared: false };
      events.push(toast(`👜 누군가 ${roomName(caseData, item.room)}에서 증거를 챙겼다…`));
      break;
    }
    case 'share': {
      if (!p || !inItemPhase) break;
      const it = S.items[action.id];
      if (it && it.holder === fromPid) it.shared = true;
      break;
    }
    case 'discoverPassage': {
      if (!p || !inItemPhase) break;
      S.passageKnown[fromPid] = true;
      break;
    }
    case 'sharePassage': {
      if (!p || !inItemPhase) break;
      if (!canUsePassage(S, caseData, fromPid)) { reject('비밀 통로를 아는 사람만 알릴 수 있어요'); break; }
      S.passageShared = true;
      events.push(toast('🕳️ 누군가 비밀 통로의 존재를 알렸다!'));
      break;
    }
    case 'vote': {
      if (!p || S.phase !== 'vote') break;
      if (typeof action.target !== 'string' || !Object.hasOwn(caseData.ROLES, action.target)) break;
      S.votes[fromPid] = action.target;
      break;
    }
    case 'useStairs': {
      if (!p) break;
      const st = caseData.MAP.stairs.find(s => s.id === action.id);
      if (!st) break;
      const fromA = floorOfRoom(caseData, st.a.room) === p.floor;
      const [here, dest] = fromA ? [st.a, st.b] : [st.b, st.a];
      if (!S.floorsOpen.includes(floorOfRoom(caseData, dest.room))) { reject('2층은 조사 2부터 열려요'); break; }
      if (floorOfRoom(caseData, here.room) !== p.floor || !near(p, here.x, here.z)) { reject(TOO_FAR); break; }
      teleportTo(S, fromPid, dest, caseData, events);
      break;
    }
    case 'usePassage': {
      if (!p) break;
      if (!canUsePassage(S, caseData, fromPid)) { reject('아직 이용할 수 있는 통로가 없어요'); break; }
      const ps = caseData.MAP.passages[0];
      const at = e => floorOfRoom(caseData, e.room) === p.floor && near(p, e.x, e.z);
      const dest = at(ps.a) ? ps.b : at(ps.b) ? ps.a : null; // stand at one end, come out at the other
      if (!dest) { reject(TOO_FAR); break; }
      teleportTo(S, fromPid, dest, caseData, events);
      break;
    }
    default:
      return { S: S0, events: [] };
  }

  delete S.rng;
  const out = { S, events };
  if (Object.keys(priv).length) out.private = priv;
  return out;
}
