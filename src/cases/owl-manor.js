// 사건 데이터: 「하얀 부엉이 저택 사건」 (스펙 4.2 · 4.4 · 4.6 · 4.7)
// 순수 데이터. 좌표 단위는 m, 0.5m 격자. pos = [x, 바닥에서의 높이, z].
import { DECOR } from './owl-manor-decor.js';
import { solidsFromDecor } from '../props.js';

const light = (color, intensity) => ({ color, intensity });

const MAP = {
  cell: 0.5,
  floors: [{ id: 0, name: '1층', height: 3 }, { id: 1, name: '2층', height: 3 }],
  rooms: [
    // ── 1층 (x 0~23, z 0~20) ──
    { id: 'conservatory', name: '온실', floor: 0, rect: [0, 0, 8, 8], floorTex: 'tile_green', wallTex: 'glass', light: light(0xbfe3ff, 0.8) },
    { id: 'kitchen', name: '주방', floor: 0, rect: [8, 0, 14, 8], floorTex: 'tile_white', wallTex: 'brick', light: light(0xfff1d6, 1.0) },
    { id: 'cellar', name: '와인셀러', floor: 0, rect: [14, 0, 19, 5], floorTex: 'stone', wallTex: 'stone', light: light(0xffb36b, 0.6) },
    { id: 'butler', name: '집사실', floor: 0, rect: [14, 5, 19, 10], floorTex: 'plank_floor', wallTex: 'wallpaper_green', light: light(0xffd9a0, 0.8) },
    { id: 'dining', name: '식당', floor: 0, rect: [0, 8, 11, 14], floorTex: 'wood_dark', wallTex: 'wallpaper_cream', light: light(0xffd28a, 1.1) },
    { id: 'hall', name: '현관 홀', floor: 0, rect: [11, 10, 17, 20], floorTex: 'carpet_wine', wallTex: 'wallpaper_cream', light: light(0xffe0a8, 1.2) },
    { id: 'living', name: '거실', floor: 0, rect: [0, 14, 11, 20], floorTex: 'wood_light', wallTex: 'wallpaper_green', light: light(0xffa95e, 1.1) },
    { id: 'study', name: '서재', floor: 0, rect: [17, 10, 23, 18], floorTex: 'wood_dark', wallTex: 'book_red', light: light(0xffd27a, 0.45) },
    // ── 2층 ──
    { id: 'attic', name: '다락방', floor: 1, rect: [12, 0, 18, 6], floorTex: 'plank_floor', wallTex: 'wood_dark', light: light(0xd8c8a8, 0.5) },
    { id: 'guestB', name: '객실 B', floor: 1, rect: [6, 8, 12, 14], floorTex: 'carpet_wine', wallTex: 'wallpaper_cream', light: light(0xffd9b0, 0.9) },
    { id: 'guestA', name: '객실 A', floor: 1, rect: [6, 14, 12, 20], floorTex: 'carpet_blue', wallTex: 'wallpaper_cream', light: light(0xffd9b0, 0.9) },
    { id: 'corridor', name: '복도', floor: 1, rect: [12, 6, 16, 20], floorTex: 'carpet_wine', wallTex: 'wallpaper_green', light: light(0xffe0a8, 0.9) },
    { id: 'master', name: '주인 침실', floor: 1, rect: [16, 10, 23, 18], floorTex: 'carpet_wine', wallTex: 'wallpaper_green', light: light(0xffc890, 0.9) },
  ],
  doors: [
    { a: 'hall', b: 'living', x: 11, z: 17, width: 2 },
    { a: 'hall', b: 'dining', x: 11, z: 12, width: 2 },
    { a: 'hall', b: 'study', x: 17, z: 14, width: 2 },
    { a: 'hall', b: 'butler', x: 15.5, z: 10, width: 2 },
    { a: 'dining', b: 'kitchen', x: 9.5, z: 8, width: 2 },
    { a: 'dining', b: 'conservatory', x: 4, z: 8, width: 2 },
    { a: 'kitchen', b: 'cellar', x: 14, z: 2.5, width: 2 },
    { a: 'kitchen', b: 'butler', x: 14, z: 6.5, width: 2 },
    { a: 'corridor', b: 'master', x: 16, z: 14, width: 2 },
    { a: 'corridor', b: 'guestA', x: 12, z: 17, width: 2 },
    { a: 'corridor', b: 'guestB', x: 12, z: 11, width: 2 },
    { a: 'corridor', b: 'attic', x: 14, z: 6, width: 2 },
  ],
  stairs: [
    { id: 'main', a: { room: 'hall', x: 15.5, z: 18.5 }, b: { room: 'corridor', x: 14, z: 18.5 } },
  ],
  passages: [
    // 서재 책장 뒤 ↔ 온실 화분대 뒤. 처음엔 숨겨져 있음(발견 규칙은 게임 로직 담당).
    { id: 'secret', a: { room: 'study', x: 22, z: 11.5 }, b: { room: 'conservatory', x: 1.5, z: 1.5 } },
  ],
  solids: [], // 아래에서 가구 배치(DECOR)로 채움
};
// 가구가 차지하는 칸 = 충돌 영역. 0.5m 격자 안쪽으로 맞춰 문·증거·계단 끝을 막지 않는다 (tests/reach.test.js).
MAP.solids = solidsFromDecor(DECOR.rooms, MAP.rooms);

const ROLES = {
  yujin: {
    name: '차유진', job: '편집자', gender: 'male',
    look: { skin: '#f1c9a5', hair: 'short', hairColor: '#3a2a1e', top: '#7b4a2a', bottom: '#3b3b46', accessories: ['glasses', 'coat'] },
    public: '한겨울 선생의 담당 편집자. 이십 년 가까이 선생의 책을 만들어 왔지만, 얼마 전 "이번 책은 다른 출판사에서 내겠다"는 통보를 받았다.',
    secret: '밤 10시 30분, 원고를 손에 넣으려고 선생의 위스키 잔에 수면제를 탔다. 11시에는 서재 금고(비밀번호 1998)를 열어 마지막 원고를 훔쳐 나왔다. 수면제 병과 원고 뭉치는 지금 객실 A 가방 안에 있고, 서재 책상에는 내가 쓴 위스키 잔이 그대로 남아 있다.',
    knows: '11시 정각에 서재에 들어갔을 때 책상이 비어 있었다. 선생은 서재에 없었다. 가장 결정적인 사실이지만, 이걸 말하면 내가 그 시간에 서재에 있었다는 걸 털어놓는 셈이다.',
    goal: '진범을 찾아라. 단, 수면제와 원고 도둑질이 들키면 당신이 범인으로 몰린다. 언제, 무엇을 털어놓을지 잘 고를 것.',
    npc: '(차유진의 진술서) "저는 선생님과 출판 문제로 이야기를 좀 나눴을 뿐입니다. 11시쯤 서재에 잠깐 들렀는데… 솔직히 말씀드리면, 그때 서재 책상은 비어 있었어요. 선생님이 안 계셨습니다."',
    knowsPassage: false,
  },
  hanbyul: {
    name: '한별', job: '조카', gender: 'female',
    look: { skin: '#f6d2b8', hair: 'short', hairColor: '#2b1d16', top: '#b8323a', bottom: '#2f3a55', accessories: ['hoodie', 'silver_ring_earrings'] },
    public: '한겨울 선생의 유일한 친척이자 상속인. 어릴 때부터 삼촌 집을 드나들어 저택이 익숙하다.',
    secret: '밤 10시 50분부터 11시 25분까지 주인 침실에서 유언장을 뒤졌다. 서랍에서 찾은 유언장 초안에는 "한별 몫 축소"라고 적혀 있었고, 놀라서 뒷걸음질 치다 꽃병을 깨뜨렸다. 깨진 꽃병은 그대로 두고 나왔다.',
    knows: '11시 20분쯤, 침실(서재 바로 위)에서 벽 안쪽으로 무언가 무거운 것을 질질 끄는 소리를 들었다. 그 시간에 침실에 있었다는 걸 밝혀야 하는 게 문제다.',
    goal: '진범을 찾아라. 유언장을 뒤진 사실이 알려지면 상속을 노린 범인으로 의심받는다.',
    npc: '(한별의 진술서) "그 시간엔 2층에 있었어요. 어디였냐고요? …삼촌 침실이요. 11시 20분쯤이었나, 벽 속에서 뭔가 끄는 소리가 났어요. 쥐가 내는 소리라기엔 너무 무거웠어요."',
    knowsPassage: false,
  },
  doyun: {
    name: '도윤', job: '집사', gender: 'male',
    look: { skin: '#e8bf9a', hair: 'neat', hairColor: '#6e6e6e', top: '#16161a', bottom: '#16161a', accessories: ['butler_suit', 'white_gloves'] },
    public: '이 저택에서 20년을 일한 집사. 저택 구조를 잘 안다.',
    secret: '수년 동안 와인셀러의 와인을 몰래 빼돌려 팔아 왔고, 집사실 서랍의 장부에 그 기록이 남아 있다. 오늘 낮에 선생에게 해고 통보 메모를 받았다. 흰 장갑 한 짝은 와인셀러에서 잃어버렸다. 서재 책장과 온실을 잇는 비밀 통로가 있다는 것도 알고 있다.',
    knows: '11시 5분, 주방 창문 너머로 긴 머리 여성이 온실 쪽으로 걸어가는 뒷모습을 봤다. 얼굴은 보지 못했다.',
    goal: '진범을 찾아라. 횡령과 해고 사실이 드러나면 복수를 노린 범인으로 몰린다. 비밀 통로를 안다는 것도 양날의 검이다.',
    npc: '(도윤의 진술서) "11시 5분쯤 주방에서 뒷정리를 하다가, 창밖으로 긴 머리 여자분이 온실 쪽으로 가시는 걸 봤습니다. 뒷모습뿐이라 누구신지는 모르겠습니다."',
    knowsPassage: true,
  },
  sera: {
    name: '세라', job: '건축가 · 전 부인', gender: 'female',
    look: { skin: '#f3d6c2', hair: 'long', hairColor: '#1c1412', top: '#efe6da', bottom: '#4a2d3a', accessories: ['pearl_earrings', 'red_shawl'] },
    public: '건축가. 20년 전 한겨울과 이혼했다.',
    secret: '당신이 범인이다. 11시 5분, 졸린 얼굴의 한겨울이 온실로 불러내 "소설에 네 뺑소니를 썼다"고 했다. 말다툼 끝에 11시 10분 그를 밀쳤고, 비틀거리던 그는 분수대 모서리에 머리를 부딪혀 숨졌다. 11시 15분부터 25분 사이, 직접 설계하며 만든 비밀 통로로 시신을 서재로 옮겼다. 수면제를 탄 누군가에게 혐의가 가도록. 그 와중에 진주 귀걸이 한 짝을 잃어버렸고, 빨간 숄은 젖은 채 객실 B 옷장에 숨겨 두었다. 금고에서 사라진 마지막 원고에는 당신의 뺑소니를 다룬 장이 들어 있다.',
    knows: '거짓 알리바이: "11시부터 객실에서 쉬고 있었다." 선생이 저녁 내내 졸려 보였다는 것, 그리고 누군가 서재 금고를 열었다는 것을 이용해 의심을 유진에게 돌려라.',
    goal: '끝까지 들키지 마라. 투표에서 다른 사람이 범인으로 지목되면 당신의 승리.',
    npc: '(세라의 진술서) "11시부터는 객실에서 쉬고 있었어요. 그 사람과는 20년 전에 끝난 사이예요. 오늘도 거의 말을 섞지 않았고요."',
    knowsPassage: true,
  },
  helper: {
    name: '조수 탐정', job: '탐정 조수', gender: 'male',
    look: { skin: '#eac4a0', hair: 'short', hairColor: '#4a3524', top: '#a98a5c', bottom: '#4a4038', accessories: ['trench_coat', 'hat'] },
    public: '폭설에 길이 막혀 저택에 머물게 된 탐정 조수. 파티 손님 누구와도 얽힌 일이 없다.',
    secret: '숨길 것은 없다. 당신은 이 사건의 유일한 제3자다.',
    knows: '당신은 그날 밤 아무것도 보지 못했다. 대신 누구보다 자유롭게 증거를 모으고 질문할 수 있다.',
    goal: '증거를 모으고 사람들의 말 사이의 모순을 찾아 진범을 지목하라.',
    npc: '(조수 탐정의 메모) "현장은 늘 거짓말을 한다. 피, 흙, 시간. 세 가지를 맞춰 볼 것."',
    knowsPassage: false,
  },
};

const ITEMS = [
  // ── 서재 ──
  { id: 'body', name: '시신', room: 'study', kind: 'fixed', container: null, pos: [20, 0, 15.5],
    desc: '한겨울 선생이 책상 옆 바닥에 쓰러져 있다. 머리 뒤에 깊은 상처가 있는데, 이상하게도 주변 바닥과 카펫에는 피가 거의 묻어 있지 않다.', points: [] },
  { id: 'shoes', name: '시신의 신발', room: 'study', kind: 'fixed', container: null, pos: [20.5, 0, 16.5],
    desc: '반짝이게 닦인 구두인데 밑창에만 축축한 검은 흙과 짓이겨진 분홍 꽃잎이 끼어 있다. 서재 카펫 위에서는 묻을 수 없는 것들이다.', points: [] },
  { id: 'whiskey', name: '위스키 잔', room: 'study', kind: 'portable', container: null, pos: [19, 0.8, 12],
    desc: '책상 위에 반쯤 남은 위스키 잔. 바닥에 하얀 가루가 녹다 만 듯 가라앉아 있다. 누군가 술에 무언가를 탔다.', points: ['yujin'] },
  { id: 'safe', name: '빈 금고', room: 'study', kind: 'fixed', container: 'safe', pos: [22, 0.5, 16.5],
    desc: '벽에 붙은 네 자리 비밀번호 금고. 문을 열어 보니 안은 텅 비었다. 선생이 "마지막 원고는 금고에 있다"고 말했었는데. 번호를 아는 사람, 혹은 알아낸 사람이 가져갔다.', points: ['yujin'] },
  { id: 'debutbook', name: '데뷔작 「부엉이는 밤에 운다」', room: 'study', kind: 'fixed', container: 'shelf', pos: [20.5, 1.2, 10.8],
    desc: '책장 한가운데 꽂힌 한겨울의 데뷔작. 판권면에 "1998년 초판 1쇄"라고 적혀 있다. 선생은 중요한 숫자를 늘 이 해에서 따왔다고 한다.', points: [] },
  { id: 'oddbook', name: '어긋난 책', room: 'study', kind: 'fixed', container: 'shelf', pos: [22, 1.2, 10.8],
    desc: '구석 책장에 혼자 비스듬히 튀어나온 책 한 권. 당겨 보니 딸깍 소리와 함께 책장이 안쪽으로 밀려나고, 차가운 바람이 새어 나오는 좁은 통로가 드러난다.', points: [] },
  // ── 온실 ──
  { id: 'fountain', name: '분수대 모서리', room: 'conservatory', kind: 'fixed', container: null, pos: [4, 0.5, 4],
    desc: '돌로 된 분수대의 뾰족한 모서리. 물에 젖은 천으로 급히 닦아낸 듯한 흐릿한 붉은 얼룩이 결을 따라 남아 있다. 핏자국이다.', points: [] },
  { id: 'rosethread', name: '장미 덤불의 빨간 실', room: 'conservatory', kind: 'fixed', container: null, pos: [6.5, 0.6, 1.5],
    desc: '장미 가시에 빨간 털실 몇 가닥이 걸려 있다. 숄이나 니트처럼 털로 짠 빨간 옷에서 뜯겨 나간 것 같다.', points: ['sera', 'hanbyul'] },
  { id: 'watch', name: '깨진 손목시계', room: 'conservatory', kind: 'portable', container: 'planter', pos: [1.5, 0, 5.5],
    desc: '화분 밑에 끼어 있던 남자 손목시계. 유리가 깨졌고 바늘은 11시 10분에 멈춰 있다. 뒷면에 "한겨울"이라고 새겨져 있다.', points: [] },
  { id: 'dragmarks', name: '끌린 자국', room: 'conservatory', kind: 'fixed', container: null, pos: [2.5, 0, 2.5],
    desc: '분수대 쪽에서 화분대 뒤 벽까지 초록 타일 바닥에 길게 두 줄로 끌린 자국. 무거운 무언가를 뒤꿈치째 끌고 간 흔적이고, 화분대 뒤 벽 틈으로 이어진다.', points: [] },
  { id: 'earring', name: '진주 귀걸이 한 짝', room: 'conservatory', kind: 'portable', container: 'planter', pos: [1.5, 0, 2.8],
    desc: '통로 입구 옆 화분 밑에 떨어진 진주 귀걸이 한 짝. 고리가 벌어진 걸 보니 무언가에 걸려 빠진 듯하다. 오늘 밤 귀걸이를 한 사람은 둘뿐이었다.', points: ['sera', 'hanbyul'] },
  // ── 거실 ──
  { id: 'photo', name: '파티 단체 사진', room: 'living', kind: 'fixed', container: null, pos: [5.5, 1.5, 19.2],
    desc: '오늘 저녁 벽난로 앞에서 찍은 단체 사진 액자. 한겨울을 가운데 두고 네 사람이 나란히 섰다. 한별의 귀에는 은색 링, 세라의 귀에는 진주 귀걸이가 반짝이고, 세라는 빨간 숄을, 한별은 빨간 후드티를 입고 있다.', points: ['sera', 'hanbyul'] },
  // ── 다락방 ──
  { id: 'blueprint', name: '옛 설계도', room: 'attic', kind: 'fixed', container: null, pos: [15, 1.2, 0.8],
    desc: '벽에 압정으로 붙은 누렇게 바랜 저택 설계도. 서재 책장과 온실 화분대 사이에 점선으로 그린 좁은 통로가 표시되어 있다. 오른쪽 아래 설계자 서명은 "세라". 귀퉁이에 집사 도윤의 필체로 "통로 청소 매달 첫째 주"라는 메모도 있다.', points: ['sera', 'doyun'] },
  // ── 객실 A (유진) ──
  { id: 'manuscript', name: "원고 '뺑소니' 장", room: 'guestA', kind: 'portable', container: 'bag', pos: [7.5, 0.3, 18.5],
    desc: "유진의 가방 속 원고 뭉치. 금고에서 사라진 마지막 원고다. 접힌 장의 제목은 '뺑소니'. 20년 전 눈 오는 밤, 젊은 여성 건축가가 사람을 치고 달아났다는 이야기가 실명만 바꾼 채 적혀 있다.", points: ['yujin', 'sera'] },
  { id: 'pills', name: '수면제 병', room: 'guestA', kind: 'portable', container: 'bag', pos: [8, 0.3, 18.5],
    desc: '유진의 가방 안쪽 주머니에서 나온 수면제 병. 처방전 이름은 차유진. 몇 알이 비어 있다.', points: ['yujin'] },
  // ── 객실 B (세라) ──
  { id: 'shawl', name: '젖은 빨간 숄', room: 'guestB', kind: 'portable', container: 'wardrobe', pos: [7, 0.8, 9],
    desc: '옷장 깊숙이 구겨 넣은 빨간 털 숄. 끝자락이 흠뻑 젖어 있고 실이 몇 가닥 뜯겨 나갔다. 젖은 자리에서 온실 흙 냄새가 난다.', points: ['sera'] },
  // ── 주인 침실 ──
  { id: 'will', name: '유언장 초안', room: 'master', kind: 'portable', container: 'drawer', pos: [21.5, 0.8, 11],
    desc: '서랍 속 유언장 초안. 붉은 펜으로 "한별 몫 축소"라고 고쳐 쓴 자국이 있고, 누군가 급히 펼쳐 본 듯 구겨져 있다.', points: ['hanbyul'] },
  { id: 'vase', name: '깨진 꽃병', room: 'master', kind: 'fixed', container: null, pos: [19, 0, 16.5],
    desc: '서랍장 앞에 산산조각 난 도자기 꽃병. 물이 아직 마르지 않았다. 누군가 이 방을 뒤지다 깨뜨린 것 같다.', points: ['hanbyul'] },
  // ── 집사실 ──
  { id: 'ledger', name: '와인 장부', room: 'butler', kind: 'portable', container: 'drawer', pos: [18, 0.8, 6],
    desc: '서랍 속 낡은 와인 장부. 셀러의 재고 숫자와 장부 숫자가 몇 년째 어긋나 있고, 판매처로 보이는 낯선 이름들이 연필로 적혀 있다.', points: ['doyun'] },
  { id: 'firing', name: '해고 메모', room: 'butler', kind: 'portable', container: null, pos: [17, 0.8, 8.5],
    desc: '한겨울의 필체로 쓴 짧은 메모. "도윤, 20년 고마웠네. 하지만 셀러 일은 더 덮어 줄 수 없어. 연말까지 짐을 정리하게."', points: ['doyun'] },
  // ── 와인셀러 ──
  { id: 'glove', name: '흰 장갑 한 짝', room: 'cellar', kind: 'portable', container: null, pos: [17, 0, 3.5],
    desc: '와인 선반 아래 떨어진 흰 면장갑 한 짝. 손등에 짙은 붉은 얼룩이 배어 있다. 피일까, 와인일까.', points: ['doyun'] },
];

const CHAINS = [
  { id: 'moved', conclusion: '서재는 진짜 현장이 아니다. 한겨울은 온실 분수대에서 숨졌고, 누군가 시신을 서재로 옮겼다.',
    fixedPath: ['body', 'shoes', 'fountain'], all: ['body', 'shoes', 'fountain', 'dragmarks', 'watch'] },
  { id: 'passage', conclusion: '시신은 비밀 통로로 옮겨졌다. 그 통로를 처음부터 알던 사람은 설계자 세라와 집사 도윤뿐이다.',
    fixedPath: ['oddbook', 'blueprint'], all: ['oddbook', 'blueprint', 'dragmarks'] },
  { id: 'who', conclusion: '빨간 옷, 귀걸이, 통로를 아는 사람. 셋이 겹치는 사람은 세라뿐이다.',
    fixedPath: ['rosethread', 'photo', 'blueprint'], all: ['rosethread', 'photo', 'blueprint', 'earring', 'shawl', 'manuscript'] },
];

const PHASES = [
  { id: 'lobby', floors: [0] },
  { id: 'intro', floors: [0] },
  { id: 'investigate1', ms: 720000, floors: [0] },
  { id: 'midtalk', ms: 300000, floors: [0] },
  { id: 'investigate2', ms: 600000, floors: [0, 1] },
  { id: 'finaltalk', ms: 480000, floors: [0, 1] },
  { id: 'vote' },
  { id: 'reveal' },
];

const intro = '폭설로 길이 끊긴 겨울밤, 하얀 부엉이 저택에서 송년 파티가 열렸다. 저녁 9시 30분, 추리소설가 한겨울(62)이 잔을 들고 선언했다. "마지막 소설에, 이 자리에 있는 누군가의 진실을 썼다." 그로부터 두 시간 뒤인 밤 11시 30분, 한겨울은 서재 바닥에서 숨진 채 발견된다. 머리 뒤에 상처. 서재 문은 안에서 잠겨 있지 않았다. 눈이 그칠 때까지 아무도 이 저택을 나갈 수 없다. 범인은 이 안에 있다.';

const truth = '서재는 진짜 현장이 아니었다.\n'
  + '10:30 편집자 차유진이 원고를 훔치려고 한겨울의 위스키에 수면제를 탔다.\n'
  + '11:00 유진이 서재에 들어갔을 때 한겨울은 이미 서재에 없었다. 유진은 금고에서 원고만 훔쳐 나왔다.\n'
  + '11:05 졸음을 참던 한겨울은 전 부인 세라를 온실로 불러 "소설에 네 뺑소니를 썼다"고 말했다. 같은 시각 집사 도윤은 주방 창으로 온실로 향하는 긴 머리 여성을 봤다.\n'
  + '11:10 말다툼 끝에 세라가 그를 밀쳤고, 비틀거리던 한겨울은 분수대 모서리에 머리를 부딪혀 숨졌다. 그의 손목시계도 그 순간 멈췄다.\n'
  + '11:15~11:25 이 저택을 직접 설계한 세라는 비밀 통로로 시신을 끌어 서재로 옮겼다. 수면제를 탄 사람에게 혐의가 가도록. 11:20 바로 위 침실에 있던 한별이 들은 "벽 속 끄는 소리"가 바로 그것이었다.\n'
  + '범인은 전 부인 세라.';

export const CASE = {
  id: 'owl-manor',
  title: '하얀 부엉이 저택 사건',
  culprit: 'sera',
  intro,
  truth,
  MAP,
  ROLES,
  ITEMS,
  CHAINS,
  PHASES,
  DECOR,
};
