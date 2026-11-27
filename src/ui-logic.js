// Pure UI logic for src/ui.js (no DOM, no three.js) so it can be unit-tested in Node.
// Derives what the HUD, bag, notebook and evidence cards show from the host's state S.
import { visibleItem, tally } from './core/rules.js';

// The safe's code is the debutbook's first-print year (its description says "1998년 초판").
export const SAFE_CODE = '1998';

const ITEM_PHASES = ['investigate1', 'midtalk', 'investigate2', 'finaltalk'];
const LOOK_PHASES = [...ITEM_PHASES, 'vote', 'reveal'];

const PHASE_LABELS = {
  lobby: '대기실', intro: '사건 소개', investigate1: '조사 1', midtalk: '중간 토론',
  investigate2: '조사 2', finaltalk: '최종 토론', vote: '투표', reveal: '진상 공개',
};
const HOST_NEXT = {
  lobby: '게임 시작', intro: '조사 시작', investigate1: '중간 토론으로', midtalk: '조사 2 시작',
  investigate2: '최종 토론으로', finaltalk: '투표 시작', vote: '결과 공개',
};
const CONTAINERS = { bag: '가방', planter: '화분', safe: '금고', shelf: '책장', drawer: '서랍', wardrobe: '옷장' };

export const phaseLabel = id => PHASE_LABELS[id] ?? id;
export const hostNextLabel = id => HOST_NEXT[id] ?? null;
export const containerName = c => CONTAINERS[c] ?? c;
// Evidence can be looked at from the first investigation on (lobby / intro: not yet).
export const canInvestigate = phase => LOOK_PHASES.includes(phase);
export const canPickPhase = phase => ITEM_PHASES.includes(phase);

export function formatRemaining(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000)); // 0.4 s left still reads 0:01
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Accepts spaces and full-width digits (some phone keyboards).
export function checkSafeCode(input) {
  if (typeof input !== 'string') return false;
  const digits = input.trim().replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  return digits === SAFE_CODE;
}

const itemById = (caseData, id) => caseData.ITEMS.find(i => i.id === id);

// Items in my bag (held by me), in case order.
export function bagItems(S, caseData, pid) {
  return caseData.ITEMS
    .filter(it => S.items[it.id]?.holder === pid)
    .map(item => ({ item, shared: !!S.items[item.id].shared }));
}

// Notebook 증거 tab: evidence anyone made public + fixed evidence I examined myself.
export function evidenceList(S, caseData, pid, examined) {
  const out = [];
  for (const item of caseData.ITEMS) {
    const st = S.items[item.id];
    if (st?.holder && st.shared) {
      out.push({ item, status: 'shared', holderName: S.players[st.holder]?.name ?? '', mine: st.holder === pid });
    } else if (item.kind === 'fixed' && examined.has(item.id)) {
      out.push({ item, status: 'fixed' });
    }
  }
  return out;
}

// What interacting with an item does first: 'search' (hidden in a container), 'code' (the safe),
// 'open' (show its card). Reveals are per player and local (revealed = this player's Set).
export function searchStep(caseData, id, revealed) {
  const it = itemById(caseData, id);
  if (!it) return null;
  if (!it.container || revealed.has(id)) return 'open';
  return it.container === 'safe' ? 'code' : 'search';
}

// Items one search finds: same room and container within SEARCH_R of the searched item, in case
// order (guestA's bag holds the manuscript AND the pills; the study shelf holds both books).
// The safe is opened by its code, never by a group search.
export const SEARCH_R = 1.6;
export function searchGroup(caseData, id) {
  const it = itemById(caseData, id);
  if (!it) return [];
  if (!it.container || it.container === 'safe') return [id];
  return caseData.ITEMS.filter(o => o.room === it.room && o.container === it.container
    && Math.hypot(o.pos[0] - it.pos[0], o.pos[2] - it.pos[2]) <= SEARCH_R + 1e-9).map(o => o.id);
}

// Should main draw world.itemVisuals[id]? Held items (even shared ones) are in someone's bag,
// and container items stay hidden until this player searched there.
export function worldItemVisible(S, caseData, id, revealed) {
  const it = itemById(caseData, id);
  if (!it) return false;
  if (S.items[id]?.holder) return false;
  return !it.container || revealed.has(id);
}

// Card state for one item, from my point of view.
//   mode: 'fixed' | 'loose' (portable, on the floor) | 'mine' | 'shared' (someone else's, public) | 'gone'
export function cardFor(S, caseData, pid, id) {
  const it = itemById(caseData, id);
  if (!it) return null;
  const base = { canPick: false, canShare: false, shared: false, mine: false };
  if (it.kind === 'fixed') return { mode: 'fixed', ...base };
  const v = visibleItem(S, pid, id);
  const st = S.items[id];
  if (v === 'present') return { mode: 'loose', ...base, canPick: canPickPhase(S.phase) };
  if (st.holder === pid) return { mode: 'mine', ...base, mine: true, shared: !!st.shared, canShare: !st.shared && canPickPhase(S.phase) };
  if (v === 'shared') return { mode: 'shared', ...base, shared: true };
  return { mode: 'gone', ...base };
}

// Reveal headline from my role's point of view. A tie (or no votes) means nobody is convicted.
// Uses the result the host froze on entering reveal (S.result); recomputes only if it is missing.
export function voteVerdict(S, caseData, myRole) {
  const t = S.result ?? tally(S, caseData);
  const culprit = caseData.culprit;
  const iAmCulprit = myRole === culprit;
  const tie = t.top.length > 1;
  const noVotes = t.voters === 0;
  const headline = t.caught
    ? (iAmCulprit ? '😱 들켰다… 범인 패배!' : '🎉 범인 검거 성공!')
    : (iAmCulprit ? '😈 완전 범죄 성공!' : '💨 범인이 빠져나갔다…');
  return { ...t, tie, noVotes, headline, culprit };
}
