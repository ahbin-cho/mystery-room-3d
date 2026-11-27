import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CASE } from '../src/cases/owl-manor.js';
import { createState } from '../src/core/rules.js';
import {
  SAFE_CODE, checkSafeCode, bagItems, evidenceList, searchStep, worldItemVisible, cardFor,
  canInvestigate, phaseLabel, hostNextLabel, formatRemaining, voteVerdict, containerName, searchGroup,
} from '../src/ui-logic.js';

function state(phase = 'investigate1') {
  const S = createState(CASE);
  S.phase = phase;
  S.players = {
    host: { name: '가', role: 'yujin', online: true, floor: 0, x: 0, z: 0 },
    p2: { name: '나', role: 'sera', online: true, floor: 0, x: 0, z: 0 },
    p3: { name: '다', role: 'helper', online: true, floor: 0, x: 0, z: 0 },
  };
  S.order = ['host', 'p2', 'p3'];
  return S;
}

test('safe code: 1998 opens, anything else does not; spaces and full-width digits tolerated', () => {
  assert.equal(SAFE_CODE, '1998');
  assert.equal(checkSafeCode('1998'), true);
  assert.equal(checkSafeCode(' 1998 '), true);
  assert.equal(checkSafeCode('１９９８'), true);
  assert.equal(checkSafeCode('1989'), false);
  assert.equal(checkSafeCode(''), false);
  assert.equal(checkSafeCode('19980'), false);
  assert.equal(checkSafeCode(null), false);
});

test('debutbook description carries the safe code', () => {
  assert.match(CASE.ITEMS.find(i => i.id === 'debutbook').desc, new RegExp(SAFE_CODE));
});

test('bagItems: only items I hold, in case order, shared flag kept', () => {
  const S = state();
  S.items.earring = { holder: 'host', shared: false };
  S.items.whiskey = { holder: 'host', shared: true };
  S.items.glove = { holder: 'p2', shared: false };
  const bag = bagItems(S, CASE, 'host');
  assert.deepEqual(bag.map(b => b.item.id), ['whiskey', 'earring']);
  assert.deepEqual(bag.map(b => b.shared), [true, false]);
  assert.deepEqual(bagItems(S, CASE, 'p3'), []);
});

test('evidenceList: shared evidence (anyone) + fixed evidence I examined, case order, no duplicates', () => {
  const S = state();
  S.items.glove = { holder: 'p2', shared: true };
  S.items.earring = { holder: 'host', shared: false }; // mine but private: lives in the bag, not here
  const examined = new Set(['body', 'fountain', 'watch']); // watch is portable: examining it is not enough
  const list = evidenceList(S, CASE, 'host', examined);
  assert.deepEqual(list.map(e => e.item.id), ['body', 'fountain', 'glove']);
  assert.deepEqual(list.map(e => e.status), ['fixed', 'fixed', 'shared']);
  assert.equal(list.find(e => e.item.id === 'glove').holderName, '나');
});

test('searchStep: containers need a search (safe needs the code) until revealed for this player', () => {
  const revealed = new Set();
  assert.equal(searchStep(CASE, 'body', revealed), 'open');
  assert.equal(searchStep(CASE, 'whiskey', revealed), 'open');
  assert.equal(searchStep(CASE, 'earring', revealed), 'search');
  assert.equal(searchStep(CASE, 'oddbook', revealed), 'search');
  assert.equal(searchStep(CASE, 'safe', revealed), 'code');
  revealed.add('earring').add('safe');
  assert.equal(searchStep(CASE, 'earring', revealed), 'open');
  assert.equal(searchStep(CASE, 'safe', revealed), 'open');
  assert.equal(searchStep(CASE, 'nope', revealed), null);
});

test('worldItemVisible: held items vanish for everyone; hidden containers only after my reveal', () => {
  const S = state();
  const revealed = new Set();
  assert.equal(worldItemVisible(S, CASE, 'whiskey', revealed), true);
  assert.equal(worldItemVisible(S, CASE, 'earring', revealed), false); // in a planter, not searched
  revealed.add('earring');
  assert.equal(worldItemVisible(S, CASE, 'earring', revealed), true);
  S.items.earring = { holder: 'p2', shared: false };
  assert.equal(worldItemVisible(S, CASE, 'earring', revealed), false);
  S.items.whiskey = { holder: 'host', shared: true }; // shared but still in someone's bag
  assert.equal(worldItemVisible(S, CASE, 'whiskey', revealed), false);
});

test('cardFor: fixed / pick / mine / shared / gone, pick only in item phases', () => {
  const S = state();
  assert.deepEqual(cardFor(S, CASE, 'host', 'body'), { mode: 'fixed', canPick: false, canShare: false, shared: false, mine: false });
  assert.equal(cardFor(S, CASE, 'host', 'whiskey').mode, 'loose');
  assert.equal(cardFor(S, CASE, 'host', 'whiskey').canPick, true);
  S.phase = 'vote';
  assert.equal(cardFor(S, CASE, 'host', 'whiskey').canPick, false);
  S.phase = 'investigate2';
  S.items.whiskey = { holder: 'host', shared: false };
  assert.deepEqual(cardFor(S, CASE, 'host', 'whiskey'), { mode: 'mine', canPick: false, canShare: true, shared: false, mine: true });
  assert.equal(cardFor(S, CASE, 'p2', 'whiskey').mode, 'gone');
  S.items.whiskey.shared = true;
  assert.deepEqual(cardFor(S, CASE, 'host', 'whiskey'), { mode: 'mine', canPick: false, canShare: false, shared: true, mine: true });
  assert.equal(cardFor(S, CASE, 'p2', 'whiskey').mode, 'shared');
  assert.equal(cardFor(S, CASE, 'p2', 'nope'), null);
});

test('phase helpers', () => {
  assert.equal(canInvestigate('lobby'), false);
  assert.equal(canInvestigate('intro'), false);
  for (const p of ['investigate1', 'midtalk', 'investigate2', 'finaltalk', 'vote', 'reveal']) assert.equal(canInvestigate(p), true);
  for (const p of CASE.PHASES) assert.equal(typeof phaseLabel(p.id), 'string');
  assert.equal(phaseLabel('investigate1'), '조사 1');
  assert.equal(hostNextLabel('lobby'), '게임 시작');
  assert.equal(hostNextLabel('finaltalk'), '투표 시작');
  assert.equal(hostNextLabel('vote'), '결과 공개');
  assert.equal(hostNextLabel('reveal'), null);
  assert.equal(formatRemaining(0), '0:00');
  assert.equal(formatRemaining(61_500), '1:02');
  assert.equal(formatRemaining(-5), '0:00');
  assert.equal(formatRemaining(720_000), '12:00');
  assert.equal(containerName('planter'), '화분');
  assert.equal(containerName('safe'), '금고');
});

test('voteVerdict: single top = culprit caught, tie = culprit slipped away, votes of players gone offline still count', () => {
  const S = state('reveal');
  S.votes = { host: 'sera', p2: 'yujin', p3: 'sera' };
  let v = voteVerdict(S, CASE, 'yujin');
  assert.equal(v.caught, true);
  assert.equal(v.headline, '🎉 범인 검거 성공!');
  assert.equal(voteVerdict(S, CASE, 'sera').headline, '😱 들켰다… 범인 패배!');
  S.votes = { host: 'sera', p2: 'yujin' };
  v = voteVerdict(S, CASE, 'yujin');
  assert.equal(v.caught, false);
  assert.equal(v.tie, true);
  assert.equal(v.headline, '💨 범인이 빠져나갔다…');
  assert.equal(voteVerdict(S, CASE, 'sera').headline, '😈 완전 범죄 성공!');
  S.votes = { host: 'sera', p2: 'yujin', p3: 'yujin' };
  S.players.p3.online = false;
  v = voteVerdict(S, CASE, 'yujin');
  assert.equal(v.tie, false);
  assert.deepEqual(v.counts, { sera: 1, yujin: 2 });
  S.votes = {};
  v = voteVerdict(S, CASE, 'yujin');
  assert.equal(v.caught, false);
  assert.equal(v.headline, '💨 범인이 빠져나갔다…');
});

test('searchGroup: one search finds every item in the same container nearby (bag, shelf), safe/planters stay apart', () => {
  assert.deepEqual(searchGroup(CASE, 'manuscript'), ['manuscript', 'pills']);
  assert.deepEqual(searchGroup(CASE, 'pills'), ['manuscript', 'pills']);
  assert.deepEqual(searchGroup(CASE, 'oddbook'), ['debutbook', 'oddbook']);
  assert.deepEqual(searchGroup(CASE, 'debutbook'), ['debutbook', 'oddbook']);
  assert.deepEqual(searchGroup(CASE, 'watch'), ['watch']);     // the two planters are 2.7 m apart
  assert.deepEqual(searchGroup(CASE, 'earring'), ['earring']);
  assert.deepEqual(searchGroup(CASE, 'safe'), ['safe']);
  assert.deepEqual(searchGroup(CASE, 'whiskey'), ['whiskey']); // not in a container
  assert.deepEqual(searchGroup(CASE, 'nope'), []);
});

test('voteVerdict: no votes is not a split vote', () => {
  const S = state('reveal');
  S.votes = {};
  const v = voteVerdict(S, CASE, 'yujin');
  assert.equal(v.tie, false);
  assert.equal(v.noVotes, true);
  S.votes = { host: 'sera', p2: 'yujin' };
  assert.equal(voteVerdict(S, CASE, 'yujin').noVotes, false);
});

test('voteVerdict renders the frozen S.result, not a fresh tally', () => {
  const S = state('reveal');
  S.votes = { host: 'yujin', p2: 'yujin', p3: 'sera' };
  S.result = { counts: { sera: 2, yujin: 1 }, top: ['sera'], caught: true, voters: 3 };
  const v = voteVerdict(S, CASE, 'yujin');
  assert.equal(v.caught, true);
  assert.deepEqual(v.counts, { sera: 2, yujin: 1 });
  assert.equal(v.headline, '🎉 범인 검거 성공!');
});
