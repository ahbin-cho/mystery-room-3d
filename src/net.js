// PeerJS networking: one player's browser is the authoritative host, the others join it (star).
// PeerJS 1.5.4 is the global `Peer` (script tag in the page shell).
//
//   createRoom(name, caseData, handlers) -> Promise<Net>
//   joinRoom(name, code, caseData, handlers) -> Promise<Net>
//   handlers = { onState(S, rem), onEvent(ev), onPoses(map), onDisconnected(reason), onReconnecting?(try) }
//   Net = { isHost, code, pid, send(action), close() }
//
// onState gets S with phaseEndsAt in THIS device's clock (clients rewrite it from rem), so
// `S.phaseEndsAt - Date.now()` works the same on host and clients. rem: ms left, or null.
// onEvent gets the public events plus this player's private ones. onPoses gets
// { pid: { floor, x, z, ry, mv } } at 10 Hz. send({t:'pos', ...}) may be called every frame:
// it is applied locally (host) or sent at 10 Hz (client); a client flushes its pending pos before any
// other action. Other actions are dropped while a client is reconnecting.
//
// Wire protocol (json):
//   client → host: {t:'join', pid, key, name} first, then game actions (protocol.cleanAction), {t:'leave'}
//   host → client: {t:'state', S, rem}, {t:'events', events}, {t:'poses', poses},
//                  {t:'refused'} (wrong key for that pid), {t:'replaced'} (same pid joined elsewhere),
//                  {t:'bye'} (host closed the room)

import { createState, applyAction } from './core/rules.js';
import {
  HOST_PID, genCode, peerIdFor, normalizeCode, uuid, cleanName, parseJoin, cleanAction,
  routeEvents, posesOf, phaseRemaining, isPhaseOver, stateChanged,
} from './core/protocol.js';

const CONN_OPTS = { reliable: true, serialization: 'json' };
const POSE_MS = 100;     // 10 Hz poses (host → all) and pos (client → host)
const TICK_MS = 1000;    // host phase timer
const RETRY_MS = 3000;   // client reconnect interval
const RETRY_MAX = 10;
const JOIN_TIMEOUT_MS = 12000;
const CREATE_TRIES = 3;  // new codes to try when the id is taken

const err = (type, message) => Object.assign(new Error(message), { type });

// Stored ids survive reloads; storage can throw (private mode, blocked), so fall back to memory.
const memIds = {};
function storedId(name) {
  try {
    let v = localStorage.getItem(name);
    if (!v) { v = uuid(); localStorage.setItem(name, v); }
    return v;
  } catch {
    return (memIds[name] ??= uuid());
  }
}

function onPageHide(fn) {
  if (typeof addEventListener !== 'function') return () => {};
  addEventListener('pagehide', fn);
  return () => removeEventListener('pagehide', fn);
}

// ---------------------------------------------------------------- host

function openHostPeer() {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const attempt = () => {
      const code = genCode();
      const peer = new Peer(peerIdFor(code), { debug: 1 });
      const onError = e => {
        peer.off('open', onOpen);
        peer.off('error', onError);
        peer.destroy();
        if (e.type === 'unavailable-id' && ++tries < CREATE_TRIES) attempt();
        else reject(err(e.type, `방을 만들지 못했어요. 인터넷 연결을 확인해 주세요. (${e.type})`));
      };
      const onOpen = () => { peer.off('error', onError); resolve({ peer, code }); };
      peer.on('open', onOpen);
      peer.on('error', onError);
    };
    attempt();
  });
}

export async function createRoom(name, caseData, handlers = {}) {
  const { peer, code } = await openHostPeer();
  const pidOf = new Map();  // conn → pid
  const connOf = new Map(); // pid → conn
  const keyOf = new Map();  // pid → device secret from its first join
  let S = createState(caseData);
  let lastPoses = '';
  let closed = false;

  const sendTo = (conn, msg) => { if (conn.open) { try { conn.send(msg); } catch { /* closing */ } } };

  function broadcastState(only) {
    const rem = phaseRemaining(S, Date.now());
    const msg = { t: 'state', S, rem };
    if (only) { sendTo(only, msg); return; }
    for (const c of pidOf.keys()) sendTo(c, msg);
    handlers.onState?.(S, rem);
  }

  function deliver(events, priv) {
    const routed = routeEvents(events, priv, [HOST_PID, ...connOf.keys()]);
    for (const [pid, list] of Object.entries(routed)) {
      if (pid === HOST_PID) for (const ev of list) handlers.onEvent?.(ev);
      else sendTo(connOf.get(pid), { t: 'events', events: list });
    }
  }

  // Every action, the host's own included, goes through here. pos only updates S (poses carry it).
  function apply(action, pid) {
    const before = S;
    const r = applyAction(S, caseData, action, pid, Date.now());
    S = r.S;
    if (action.t === 'pos') return;
    if (stateChanged(before, S)) broadcastState();
    deliver(r.events, r.private);
  }

  function unbind(conn) {
    const pid = pidOf.get(conn);
    pidOf.delete(conn);
    if (pid !== undefined && connOf.get(pid) === conn) { connOf.delete(pid); return pid; }
    return undefined;
  }

  function onJoin(conn, j) {
    const prev = pidOf.get(conn);
    if (prev !== undefined && prev !== j.pid) return; // one pid per connection
    if (keyOf.has(j.pid) && keyOf.get(j.pid) !== j.key) {
      sendTo(conn, { t: 'refused' });
      setTimeout(() => conn.close(), 200);
      return;
    }
    keyOf.set(j.pid, j.key);
    const old = connOf.get(j.pid);
    if (old && old !== conn) { // same device came back before its old connection timed out
      pidOf.delete(old);
      sendTo(old, { t: 'replaced' });
      setTimeout(() => old.close(), 200);
    }
    pidOf.set(conn, j.pid);
    connOf.set(j.pid, conn);
    const before = S;
    apply({ t: 'join', name: j.name }, j.pid);
    if (!stateChanged(before, S)) broadcastState(conn); // rejoin while still online: S did not change
    lastPoses = ''; // resend poses on the next 10 Hz tick
  }

  function onData(conn, msg) {
    if (closed) return;
    if (msg?.t === 'join') { const j = parseJoin(msg); if (j) onJoin(conn, j); return; }
    const pid = pidOf.get(conn);
    if (pid === undefined) return; // not joined yet
    if (msg?.t === 'leave') { if (unbind(conn) !== undefined) apply({ t: 'leave' }, pid); conn.close(); return; }
    const action = cleanAction(msg);
    if (action) apply(action, pid);
  }

  function onConnClosed(conn) {
    const pid = unbind(conn);
    if (pid !== undefined && !closed) apply({ t: 'leave' }, pid);
  }

  peer.on('connection', conn => {
    conn.on('data', msg => onData(conn, msg));
    conn.on('close', () => onConnClosed(conn));
    conn.on('error', () => onConnClosed(conn));
  });
  peer.on('disconnected', () => { if (!closed) { try { peer.reconnect(); } catch { /* destroyed */ } } });
  peer.on('error', e => { if (!closed) console.warn('[net] host peer error', e.type); });

  const poseTimer = setInterval(() => {
    const poses = posesOf(S);
    const json = JSON.stringify(poses);
    if (json === lastPoses) return;
    lastPoses = json;
    for (const c of pidOf.keys()) sendTo(c, { t: 'poses', poses });
    handlers.onPoses?.(poses);
  }, POSE_MS);

  const tickTimer = setInterval(() => {
    if (isPhaseOver(S, Date.now())) apply({ t: 'next' }, HOST_PID);
  }, TICK_MS);

  function close() {
    if (closed) return;
    closed = true;
    clearInterval(poseTimer);
    clearInterval(tickTimer);
    offPageHide();
    for (const c of pidOf.keys()) sendTo(c, { t: 'bye' });
    setTimeout(() => { try { peer.destroy(); } catch { /* already */ } }, 200);
  }
  const offPageHide = onPageHide(close);

  const net = {
    isHost: true,
    code,
    pid: HOST_PID,
    send(action) {
      if (closed || !action || typeof action.t !== 'string') return;
      apply(action, HOST_PID);
    },
    close,
  };
  apply({ t: 'join', name: cleanName(name) }, HOST_PID);
  return net;
}

// ---------------------------------------------------------------- client

export function joinRoom(name, code, caseData, handlers = {}) {
  const roomCode = normalizeCode(code);
  if (!roomCode) return Promise.reject(err('bad-code', '방 코드는 4글자예요.'));
  const hostId = peerIdFor(roomCode);
  const pid = storedId('owl-pid');
  const key = storedId('owl-key');
  const joinMsg = { t: 'join', pid, key, name: cleanName(name) };

  return new Promise((resolve, reject) => {
    let peer = null, conn = null;
    let joined = false;  // first state received (the promise has resolved)
    let live = false;    // current connection has a state, i.e. not reconnecting
    let closed = false;
    let retryTimer = null, retries = 0;
    let pendingPos = null;
    let offPageHide = () => {};

    const joinTimer = setTimeout(() => fail(err('timeout', '방을 찾을 수 없어요. 코드를 확인해 주세요.')), JOIN_TIMEOUT_MS);

    function fail(e) { // before the first state
      if (joined || closed) return;
      teardown();
      reject(e);
    }

    function end(reason) { // after the first state
      if (closed) return;
      teardown();
      handlers.onDisconnected?.(reason);
    }

    function teardown() {
      closed = true;
      clearTimeout(joinTimer);
      clearInterval(retryTimer);
      clearInterval(posTimer);
      offPageHide();
      try { conn?.close(); } catch { /* gone */ }
      try { peer?.destroy(); } catch { /* gone */ }
    }

    function onMsg(msg) {
      switch (msg?.t) {
        case 'state': {
          const S = msg.S;
          S.phaseEndsAt = msg.rem == null ? null : Date.now() + msg.rem; // host clock → ours
          live = true;
          if (retryTimer) { clearInterval(retryTimer); retryTimer = null; retries = 0; }
          handlers.onState?.(S, msg.rem);
          if (!joined) {
            joined = true;
            clearTimeout(joinTimer);
            offPageHide = onPageHide(net.close);
            resolve(net);
          }
          break;
        }
        case 'events': for (const ev of msg.events ?? []) handlers.onEvent?.(ev); break;
        case 'poses': handlers.onPoses?.(msg.poses); break;
        case 'refused':
          if (joined) end('refused'); else fail(err('refused', '이 기기로는 들어갈 수 없어요.'));
          break;
        case 'replaced': end('replaced'); break;
        case 'bye':
          if (joined) end('host-left'); else fail(err('host-left', '방이 닫혔어요.'));
          break;
      }
    }

    function connect() {
      const c = peer.connect(hostId, CONN_OPTS);
      conn = c;
      c.on('open', () => { if (c === conn) c.send(joinMsg); });
      c.on('data', msg => { if (c === conn) onMsg(msg); });
      const lost = () => {
        if (c !== conn || closed) return;
        conn = null;
        live = false;
        if (joined) startRetry();
        else fail(err('closed', '연결하지 못했어요.'));
      };
      c.on('close', lost);
      c.on('error', lost);
    }

    function newPeer(onOpen) {
      const p = new Peer({ debug: 1 });
      peer = p;
      p.on('open', () => { if (p === peer && !closed) onOpen(); });
      p.on('error', e => {
        if (p !== peer || closed) return;
        if (!joined) {
          if (e.type === 'peer-unavailable') fail(err(e.type, '방을 찾을 수 없어요. 코드를 확인해 주세요.'));
          else fail(err(e.type, `연결하지 못했어요. (${e.type})`));
        }
        // while reconnecting, the next try handles it
      });
      p.on('disconnected', () => { if (p === peer && !closed && live) { try { p.reconnect(); } catch { /* gone */ } } });
    }

    // Every 3 s, up to 10 tries: fresh connection (and a fresh peer if ours lost the broker), same pid.
    function startRetry() {
      if (closed || retryTimer) return;
      retries = 0;
      retryTimer = setInterval(() => {
        if (live) return;
        if (++retries > RETRY_MAX) { end('lost'); return; }
        handlers.onReconnecting?.(retries);
        if (conn) { const c = conn; conn = null; try { c.close(); } catch { /* gone */ } }
        if (peer && peer.open) connect();
        else { try { peer?.destroy(); } catch { /* gone */ } newPeer(connect); }
      }, RETRY_MS);
    }

    const posTimer = setInterval(() => {
      if (!pendingPos || !live || !conn?.open) return;
      conn.send(pendingPos);
      pendingPos = null;
    }, POSE_MS);

    const net = {
      isHost: false,
      code: roomCode,
      pid,
      send(action) {
        if (closed || !action || typeof action.t !== 'string') return;
        if (action.t === 'pos') { pendingPos = action; return; }
        if (live && conn?.open) {
          // the channel is ordered: flush the latest pos first so the host checks reach at our real spot
          if (pendingPos) { conn.send(pendingPos); pendingPos = null; }
          conn.send(action);
        }
      },
      close() {
        if (closed) return;
        if (live && conn?.open) { try { conn.send({ t: 'leave' }); } catch { /* closing */ } }
        const c = conn, p = peer;
        conn = null; peer = null; // let the leave flush before tearing the channel down
        teardown();
        setTimeout(() => { try { c?.close(); } catch { /* gone */ } try { p?.destroy(); } catch { /* gone */ } }, 200);
      },
    };

    newPeer(connect);
  });
}
