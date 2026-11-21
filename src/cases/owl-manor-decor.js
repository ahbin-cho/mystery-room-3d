// 「하얀 부엉이 저택」 꾸미기 배치 (스펙 4.2 밀도 · 4.4 맵). 순수 데이터.
// rooms[roomId] = [[prop, x, z, rot, opt], ...]  — props.js 규칙: (x, z) = 회전 후 발자국의 최소 모서리(m),
//   rot 0/1/2/3 = 정면이 +z/+x/-z/-x (북/서/남/동 벽에 등을 댐). opt.y = 바닥에서 띄울 높이(탁자 위 소품).
//   opt.solid: false → 충돌 없음 (증거 위치·문·계단 끝을 막지 않도록), [x0,z0,x1,z1] → 충돌 영역 직접 지정.
// MAP.solids는 이 배치에서 자동 계산된다 (props.js solidsFromDecor).

const conservatory = [
  ['fountain', 4, 4, 0, { stain: [0, 0], solid: [4.5, 4.5, 6.5, 6.5] }], // 피 얼룩 모서리 = (4, 4)
  ['drag_marks', 1.5, 1.5, 0, { w: 2.5, d: 2.5 }], // 분수대 → 통로 입구로 끌린 자국
  ['hidden_door', 0.5, 0.75, 1, { w: 1.5 }], // 화분대 뒤 벽 틈 (비밀 통로 입구)
  ['planter', 0.5, 3.25, 1, { w: 2 }],
  ['plant_pot', 1.25, 2.25, 0, { kind: 'fern' }], // 이 화분 앞에 진주 귀걸이
  ['plant_pot', 1.25, 5.75, 0, { kind: 'flower' }], // 이 화분 앞에 손목시계
  ['rosebush', 5.5, 0.5, 0, { w: 2, d: 0.75, thread: 1.0 }], // 빨간 실 (6.5, 1.25)
  ['rosebush', 6.75, 1.75, 3, { w: 2, d: 0.75 }],
  ['rosebush', 5.5, 6.75, 2, { w: 1.5, d: 0.75 }],
  ['potting_table', 2.5, 0.5, 0, { w: 2 }],
  ['bench', 0.5, 7.0, 2, { w: 1.5 }],
  ['bench', 7.0, 4.75, 3, { w: 1.5 }],
  ['plant_pot', 7.0, 7.0, 0, { kind: 'palm' }],
  ['plant_pot', 2.25, 7.0, 0, { kind: 'palm' }],
  ['plant_pot', 5.0, 7.0, 0, { kind: 'tree' }],
  ['plant_pot', 2.0, 0.5, 0, { kind: 'fern' }],
  ['watering_can', 3.5, 6.75, 0],
  ['lamp_floor', 0.5, 6.25, 0],
  ['vines', 1.0, 0.5, 0, { w: 4 }],
  ['vines', 7.375, 4.0, 3, { w: 3 }],
  ['vines', 0.5, 5.25, 1, { w: 1.5 }],
];

const kitchen = [
  ['counter', 8.5, 0.5, 0, { w: 1.5 }],
  ['stove', 10.0, 0.5, 0],
  ['sink', 11.0, 0.5, 0],
  ['counter', 12.0, 0.5, 0, { w: 1.5, items: [['bread', 0.25, 0.25], ['veg', 0.75, 0.375], ['jar', 1.25, 0.125], ['cup', 1.0, 0.125]] }],
  ['pot_rack', 8.5, 5.5, 1, { w: 1.5 }],
  ['fridge', 12.75, 3.75, 3],
  ['crate', 13.0, 4.75, 0, { fill: 'veg' }],
  ['table', 10.0, 3.0, 0, { w: 1.5, d: 1, items: [['bread', 0.25, 0.25], ['veg', 0.75, 0.5], ['jar', 1.125, 0.25], ['cup', 0.5, 0.75], ['board', 0.875, 0.75]] }],
  ['chair', 10.5, 2.5, 0, { seat: 'wood_light' }],
  ['chair', 10.5, 4.0, 2, { seat: 'wood_light' }],
  ['chair', 9.5, 3.25, 1, { seat: 'wood_light' }],
  ['barrel', 8.5, 1.5, 0],
  ['sack', 8.5, 2.375, 0],
  ['wall_shelf', 8.5, 1.25, 1, { w: 1.5, plates: true }],
  ['wall_shelf', 10.75, 7.25, 2, { w: 1.5, items: ['jar', 'jar', 'bottle', 'jar', 'cup'] }],
  ['broom', 10.75, 7.25, 0],
  ['crate', 11.25, 7.0, 0, { fill: 'apples' }],
  ['sack', 11.75, 7.0, 0],
  ['lantern', 10.625, 3.375, 0, { hang: true }],
  ['rug', 9.5, 5.0, 0, { w: 2, d: 1, key: 'carpet_blue' }],
];

const cellar = [
  ['wine_rack', 15.5, 0.5, 0, { w: 1.5 }],
  ['wine_rack', 17.0, 0.5, 0, { w: 1.5 }],
  ['wine_rack', 18.0, 1.0, 3, { w: 1.5 }],
  ['wine_rack', 18.0, 2.75, 3, { w: 1.25 }],
  ['wine_rack', 16.0, 4.0, 2, { w: 1.5 }], // 이 선반 아래에 흰 장갑
  ['wine_rack', 17.5, 4.0, 2, { w: 1.0 }],
  ['barrel', 14.5, 0.5, 0],
  ['barrel', 14.5, 3.75, 0],
  ['barrel', 15.25, 3.75, 0, { key: 'wood_dark' }],
  ['barrel', 15.75, 2.0, 0, { top: [['candle', 0.125, 0.25], ['bottle', 0.375, 0.375]] }],
  ['crate', 17.5, 1.25, 0, { fill: 'bottles' }],
  ['bottle', 16.625, 2.875, 0],
  ['puddle', 17.375, 2.875, 0, { w: 0.5, d: 0.375 }],
  ['cobweb', 14.5, 0.5, 0],
  ['cobweb', 18.0, 4.375, 2],
  ['lantern', 16.5, 2.5, 0, { hang: true }],
];

const butler = [
  ['bed', 15.5, 5.5, 1, { w: 1, d: 2, blanket: 'carpet_wine' }],
  ['nightstand', 15.0, 5.5, 0, { glasses: true }],
  ['desk', 17.75, 5.5, 3, { w: 1.25, d: 0.75, drawer: true, solid: false }], // 서랍 속 와인 장부
  ['lamp_desk', 18.125, 5.625, 0, { y: 0.75 }],
  ['books_stack', 18.125, 6.375, 0, { y: 0.75, n: 2 }],
  ['table', 16.5, 8.25, 0, { w: 1, d: 0.75, solid: false, items: [['cup', 0.125, 0.125], ['candle', 0.75, 0.125]] }], // 해고 메모
  ['chair', 17.5, 8.375, 3],
  ['display_case', 18.0, 7.5, 3, { w: 1, fill: 'silver' }],
  ['coat_rack', 18.0, 9.0, 0, { coats: ['black', 'white'], hat: 'black' }],
  ['rug', 15.0, 7.0, 0, { w: 2, d: 1.5, key: 'carpet_wine' }],
  ['painting', 16.0, 5.5, 0, { art: 'sea', y0: 1.25 }],
  ['crate', 14.5, 8.0, 0, { fill: 'bottles' }], // 빼돌린 와인
  ['crate', 14.5, 7.5, 0],
  ['umbrella_stand', 16.75, 9.0, 0],
  ['wall_shelf', 14.5, 7.75, 1, { w: 1.5, items: ['jar', 'bottle', 'cup', 'jar'] }],
  ['shoes', 15.0, 8.5, 0, { mud: false }],
];

const dining = [
  ['rug', 2.0, 9.5, 0, { w: 6, d: 3, key: 'carpet_wine' }],
  ['dining_table', 2.5, 10.25, 0, { w: 5, solid: [2.5, 10.5, 7.5, 11.5] }],
  ...[3.0, 4.25, 5.5, 6.75].map(x => ['chair', x, 9.75, 0]),
  ...[3.0, 4.25, 5.5, 6.75].map(x => ['chair', x, 11.75, 2]),
  ['chair', 2.0, 10.75, 1],
  ['chair', 7.5, 10.75, 3],
  ...[3.0, 4.25, 5.5, 6.75].map(x => ['plate_set', x, 10.25, 0, { y: 0.75 }]),
  ...[3.0, 4.25, 5.5, 6.75].map(x => ['plate_set', x, 11.25, 2, { y: 0.75 }]),
  ['plate_set', 2.5, 10.75, 1, { y: 0.75 }],
  ['plate_set', 7.0, 10.75, 3, { y: 0.75, food: 'none' }],
  ['candelabra', 3.5, 10.75, 0, { y: 0.75 }],
  ['candelabra', 6.125, 10.75, 0, { y: 0.75 }],
  ['cake', 4.75, 10.75, 0, { y: 0.75 }],
  ['bottle', 5.5, 10.875, 0, { y: 0.75, glass: true }],
  ['bottle', 3.125, 11.0, 0, { y: 0.75 }],
  ['dresser', 0.5, 10.0, 1, { w: 2, china: true }],
  ['dresser', 10.0, 9.0, 3, { w: 1.5, items: [['vase', 0.125, 0.25], ['candle', 0.75, 0.25], ['candle', 1.125, 0.25]] }],
  ['display_case', 6.0, 8.5, 0, { w: 1.5, fill: 'china' }],
  ['grand_clock', 0.5, 8.5, 0],
  ['painting', 1.5, 13.375, 2, { art: 'flowers' }],
  ['painting', 4.25, 13.375, 2, { art: 'landscape' }],
  ['painting', 7.0, 13.375, 2, { art: 'owl' }],
  ['garland', 0.5, 13.375, 2, { w: 10, y0: 2.875 }],
  ['garland', 5.0, 8.5, 0, { w: 3.5, y0: 2.875 }],
  ['chandelier', 3.0, 10.5, 0],
  ['chandelier', 6.0, 10.5, 0],
  ['plant_pot', 10.0, 13.0, 0, { kind: 'palm' }],
  ['plant_pot', 0.5, 13.0, 0, { kind: 'bush' }],
  ['gift', 0.5, 12.25, 0, { key: 'red' }],
  ['gift', 1.0, 12.5, 0, { key: 'carpet_blue', big: true }],
  ['balloons', 8.0, 9.0, 0],
  ['balloons', 8.25, 12.75, 0, { keys: ['gold', 'red', 'pearl'] }],
];

const hall = [
  ['staircase', 14.5, 15.5, 0, { solid: [14.5, 15.5, 16.5, 18.0] }], // 계단 발치 = (15.5, 18.5)
  ['front_door', 12.0, 19.25, 2],
  ['rug', 12.25, 18.75, 0, { w: 1.5, d: 0.5, key: 'carpet_blue' }],
  ['rug', 12.5, 11.5, 0, { w: 1.5, d: 4, key: 'carpet_blue', fringe: 'gold' }],
  ['grand_clock', 11.5, 14.0, 1],
  ['table', 11.5, 14.75, 1, { w: 1, d: 0.5, solid: false }],
  ['vase', 11.625, 15.125, 0, { y: 0.75 }],
  ['mirror', 11.5, 14.75, 1, { w: 1.0, y0: 1.25 }],
  ['coat_rack', 11.5, 19.0, 0, { coats: ['leather', 'red'], hat: 'black', scarf: 'carpet_blue' }],
  ['umbrella_stand', 14.0, 19.0, 0],
  ['bench', 11.5, 18.0, 1, { w: 1, cushion: 'carpet_wine' }],
  ['owl_statue', 12.75, 10.5, 0],
  ['plant_pot', 11.5, 10.5, 0, { kind: 'palm' }],
  ['plant_pot', 14.0, 10.5, 0, { kind: 'fern' }],
  ['suitcase', 13.75, 15.75, 1],
  ['suitcase', 13.75, 15.75, 1, { y: 0.375, key: 'red' }],
  ['chandelier', 12.75, 13.0, 0],
  ['painting', 16.375, 11.0, 3, { art: 'portrait', cw: 0.75 }],
  ['police_tape', 16.9375, 13.0, 1, { w: 2, cross: true, posts: false }], // 서재 문을 가로지른 폴리스 라인
  ['lamp_floor', 11.5, 13.25, 0],
  ['plant_pot', 16.0, 12.25, 0, { kind: 'bush' }],
];

const living = [
  ['fireplace', 4.5, 18.75, 2, { solid: false }],
  ['photo_frame', 5.25, 19.0, 2, { y: 1.5 }], // 단체 사진 (5.5, 1.5, 19.2)
  ['rug', 3.5, 16.5, 0, { w: 4, d: 2, key: 'carpet_blue', fringe: 'linen' }],
  ['sofa', 4.25, 15.0, 0, { w: 2.5, key: 'carpet_wine' }],
  ['armchair', 2.5, 16.75, 1, { key: 'leather' }],
  ['armchair', 7.5, 16.75, 3, { key: 'leather' }],
  ['table', 4.75, 16.75, 0, { w: 1.5, d: 0.75, h: 0.5, solid: false }],
  ['tea_set', 5.25, 16.875, 0, { y: 0.5 }],
  ['piano', 0.75, 14.5, 0, { solid: [1.0, 14.5, 2.0, 16.0] }],
  ['bookshelf', 0.5, 17.25, 1, { w: 1.5, topper: 'plant' }],
  ['xmas_tree', 9.5, 14.5, 0],
  ['gift', 9.0, 15.0, 0, { key: 'red' }],
  ['gift', 9.5, 15.5, 0, { key: 'carpet_blue', big: true }],
  ['gift', 10.0, 15.5, 0, { key: 'book_green' }],
  ['lamp_floor', 3.75, 15.0, 0],
  ['lamp_floor', 6.75, 15.0, 0],
  ['table', 2.5, 18.0, 0, { w: 0.5, d: 0.5, solid: false }],
  ['radio', 2.5, 18.125, 0, { y: 0.75 }],
  ['globe', 8.75, 14.5, 0],
  ['painting', 4.875, 14.5, 0, { art: 'winter', y0: 1.5 }],
  ['painting', 7.5, 14.5, 0, { art: 'sea', y0: 1.5 }],
  ['cat', 6.75, 18.0, 0],
  ['plant_pot', 10.0, 19.0, 0, { kind: 'palm' }],
  ['plant_pot', 3.5, 19.0, 0, { kind: 'flower' }],
  ['books_stack', 3.25, 18.625, 0, { n: 4 }],
  ['chandelier', 5.0, 16.5, 0],
  ['vase', 2.625, 18.125, 0, { y: 0.75, bloom: 'gold' }],
];

const study = [
  ['bookshelf', 17.5, 10.5, 0, { w: 1.5 }],
  ['bookshelf', 19.0, 10.5, 0, { w: 2.5, debut: 1.5, solid: [19, 10.5, 20, 11] }], // 데뷔작 (20.5, 1.2, 10.8)
  ['bookshelf', 21.5, 10.5, 0, { w: 1, odd: 0.5, door: 'secret', solid: false }], // 어긋난 책 (22, 1.2, 10.8) = 비밀 문
  ['desk', 18.0, 11.5, 2, { w: 2, papers: true, ink: true, solid: [19.5, 11.5, 20, 12.5] }], // 위스키 잔 (19, 0.8, 12)
  ['typewriter', 18.25, 11.875, 2, { y: 0.75 }],
  ['lamp_desk', 19.625, 11.625, 0, { y: 0.75 }],
  ['bottle', 19.25, 11.75, 0, { y: 0.75 }], // 위스키 병
  ['chair', 18.75, 11.0, 0],
  ['rug', 18.5, 13.5, 0, { w: 3, d: 3.5, key: 'carpet_wine' }],
  ['chalk_outline', 19.5, 14.25, 0],
  ['body', 19.75, 14.25, 0], // 시신 (20, 0, 15.5)
  ['shoes', 20.25, 16.25, 0], // 신발 (20.5, 0, 16.5)
  ['police_tape', 19.0, 13.75, 0, { w: 2.5 }],
  ['police_tape', 19.0, 17.125, 0, { w: 2.5 }],
  ['police_tape', 19.0, 13.875, 1, { w: 3.25, posts: false }],
  ['police_tape', 21.375, 13.875, 1, { w: 3.25, posts: false }],
  ['evidence_tent', 19.25, 15.0, 0],
  ['evidence_tent', 20.875, 16.375, 0],
  ['evidence_tent', 18.75, 12.625, 0],
  ['safe', 22.0, 16.25, 3], // 빈 금고 (22, 0.5, 16.5)
  ['armchair', 21.5, 12.75, 3, { key: 'leather' }],
  ['lamp_floor', 22.0, 14.0, 0],
  ['grand_clock', 17.5, 15.25, 1],
  ['globe', 17.5, 16.75, 0],
  ['painting', 22.375, 14.75, 3, { art: 'owl' }],
  ['books_stack', 21.0, 12.0, 0, { n: 4 }],
  ['books_stack', 18.125, 13.25, 0, { n: 2 }],
  ['papers', 20.5, 12.75, 0, { w: 1, d: 0.75 }],
];

const attic = [
  ['pinned_paper', 14.5, 0.5, 0, { w: 1, key: 'blueprint', y0: 0.875, h: 0.75 }], // 옛 설계도 (15, 1.2, 0.8)
  ['drafting_table', 15.75, 0.5, 0],
  ['trunk', 12.5, 0.5, 0, { lantern: true }],
  ['trunk', 17.0, 2.0, 3],
  ['sheet_furniture', 16.25, 3.75, 0, { w: 1, d: 1, h: 1.25 }],
  ['sheet_furniture', 12.5, 2.0, 0, { w: 0.75, d: 1.5, h: 2 }],
  ['rocking_horse', 12.5, 4.0, 1],
  ['crate', 17.0, 0.5, 0],
  ['crate', 17.0, 1.0, 0, { fill: 'apples' }],
  ['crate', 17.0, 0.5, 0, { y: 0.5 }],
  ['cobweb', 12.5, 0.5, 0],
  ['cobweb', 17.0, 0.5, 0],
  ['cobweb', 17.375, 4.5, 3],
  ['painting', 15.5, 5.375, 2, { art: 'portrait', cw: 0.75, y0: 0.125 }],
  ['suitcase', 15.75, 4.625, 0, { key: 'red' }],
  ['books_stack', 15.75, 3.25, 0, { n: 5 }],
  ['telescope', 16.0, 2.25, 0],
  ['lantern', 14.5, 2.75, 0, { hang: true }],
  ['sack', 12.5, 1.0, 0],
  ['rug', 13.5, 2.5, 0, { w: 2, d: 2, key: 'carpet_blue', fringe: 'linen' }],
  ['chair', 16.0, 1.25, 2, { seat: 'linen' }],
  ['bird_cage', 13.25, 0.5, 0],
];

const guestB = [
  ['wardrobe', 6.5, 8.5, 0, { w: 1.5, open: 'left', clothes: 'pearl', solid: false }], // 젖은 숄 (7, 0.8, 9)
  ['bed', 6.5, 10.5, 1, { w: 2, d: 2.5, blanket: 'pearl' }],
  ['nightstand', 6.5, 10.0, 0, { book: true }],
  ['nightstand', 6.5, 12.5, 0, { lamp: false }],
  ['vase', 6.625, 12.625, 0, { y: 0.5, bloom: 'pearl' }],
  ['dresser', 9.0, 8.5, 0, { w: 1.5, mirror: true, items: [['perfume', 0.25, 0.25], ['jewel', 0.75, 0.25], ['perfume', 1.125, 0.125]] }],
  ['suitcase', 11.0, 12.75, 1, { key: 'red' }],
  ['armchair', 9.75, 12.5, 2, { key: 'carpet_blue', cushion: 'linen' }],
  ['rug', 9.0, 9.5, 0, { w: 2, d: 2.5, key: 'carpet_blue' }],
  ['lamp_floor', 11.0, 8.5, 0],
  ['painting', 7.0, 13.375, 2, { art: 'flowers' }],
  ['coat_rack', 11.0, 9.25, 0, { coats: ['pearl', 'carpet_wine'] }],
  ['shoes', 9.25, 11.75, 0, { key: 'red', mud: false }],
  ['plant_pot', 8.5, 13.0, 0, { kind: 'flower' }],
  ['books_stack', 10.25, 11.875, 0, { n: 3 }],
];

const guestA = [
  ['bed', 6.5, 15.0, 1, { w: 2, d: 2.5, blanket: 'red', messy: true }],
  ['nightstand', 6.5, 14.5, 0, { glasses: true }],
  ['nightstand', 6.5, 17.0, 0, { cup: true, lamp: false }],
  ['bag', 7.25, 18.25, 0], // 원고 (7.5, 0.3, 18.5) · 수면제 (8, 0.3, 18.5)
  ['desk', 9.0, 14.5, 0, { w: 2, papers: true, books: true }],
  ['chair', 9.75, 15.5, 2],
  ['typewriter', 9.5, 14.625, 0, { y: 0.75 }],
  ['lamp_desk', 10.625, 14.625, 0, { y: 0.75 }],
  ['wardrobe', 9.5, 18.75, 2, { w: 1.5 }],
  ['coat_rack', 11.0, 19.0, 0, { coats: ['leather', 'linen'], hat: 'wood_dark' }],
  ['rug', 9.0, 16.0, 0, { w: 2, d: 2, key: 'carpet_wine' }],
  ['lamp_floor', 6.5, 19.0, 0],
  ['books_stack', 8.5, 18.875, 0, { n: 3 }],
  ['papers', 7.0, 17.625, 0, { w: 1.5, d: 0.5 }],
  ['painting', 7.25, 14.5, 0, { art: 'sea', y0: 1.5 }],
  ['plant_pot', 11.0, 14.5, 0, { kind: 'fern' }],
  ['suitcase', 8.75, 17.75, 3, { open: true }],
];

const corridor = [
  ['rug', 13.5, 7.0, 0, { w: 1, d: 11.5, key: 'carpet_blue' }],
  ['stairwell', 13.0, 18.5, 0, { w: 2, d: 1 }], // 계단 꼭대기 = (14, 18.5)
  ['grand_clock', 15.0, 6.5, 0],
  ['armor', 12.5, 6.5, 0],
  ['painting', 12.5, 7.25, 1, { art: 'portrait', cw: 0.75 }],
  ['painting', 12.5, 13.0, 1, { art: 'landscape' }],
  ['table', 12.5, 13.5, 1, { w: 1, d: 0.5, solid: false }],
  ['vase', 12.625, 13.875, 0, { y: 0.75 }],
  ['painting', 15.375, 8.0, 3, { art: 'winter' }],
  ['painting', 15.375, 10.5, 3, { art: 'owl' }],
  ['painting', 15.375, 16.0, 3, { art: 'flowers' }],
  ['bench', 15.0, 9.5, 3, { w: 1.5, cushion: 'carpet_wine' }],
  ['plant_pot', 12.5, 15.25, 0, { kind: 'palm' }],
  ['plant_pot', 15.0, 12.25, 0, { kind: 'fern' }],
  ['plant_pot', 12.5, 9.25, 0, { kind: 'bush' }],
  ['sconce', 12.5, 8.75, 1],
  ['sconce', 15.25, 12.0, 3],
  ['sconce', 12.5, 18.0, 1],
  ['sconce', 15.25, 15.5, 3],
  ['display_case', 15.0, 17.5, 3, { w: 1, fill: 'trophy' }],
];

const master = [
  ['desk', 20.75, 10.5, 0, { w: 1.5, d: 0.75, drawer: true, papers: true, solid: false }], // 유언장 (21.5, 0.8, 11)
  ['chair', 21.25, 11.25, 2],
  ['dresser', 18.25, 17.0, 2, { w: 1.5, items: [['jewel', 0.25, 0.25], ['candle', 1.0, 0.25]] }],
  ['broken_vase', 18.5, 16.0, 0], // 깨진 꽃병 (19, 0, 16.5)
  ['bed', 20.0, 13.0, 3, { w: 2, d: 2.5, blanket: 'carpet_blue', canopy: 'carpet_wine' }],
  ['nightstand', 22.0, 12.5, 0],
  ['nightstand', 22.0, 15.0, 0, { lamp: false, book: true }],
  ['fireplace', 17.5, 10.5, 0, { clock: true, candles: false }],
  ['armchair', 17.25, 11.75, 2, { key: 'leather' }],
  ['armchair', 18.75, 11.75, 2, { key: 'carpet_blue' }],
  ['wardrobe', 16.5, 15.75, 1, { w: 1.5 }],
  ['sofa', 20.25, 16.5, 2, { w: 2.25, key: 'carpet_blue' }],
  ['rug', 18.0, 13.0, 0, { w: 2, d: 2, key: 'carpet_blue', fringe: 'gold' }],
  ['lamp_floor', 16.5, 10.5, 0],
  ['painting', 22.375, 13.5, 3, { art: 'portrait', cw: 0.75, y0: 1.5 }],
  ['plant_pot', 19.75, 17.0, 0, { kind: 'flower' }],
  ['chandelier', 19.0, 13.5, 0],
  ['shoes', 19.25, 15.125, 0, { key: 'pearl', mud: false }],
  ['mirror', 16.5, 11.5, 1, { w: 0.75, y0: 1.0, h: 1.25 }],
];

export const DECOR = {
  rooms: { conservatory, kitchen, cellar, butler, dining, hall, living, study, attic, guestB, guestA, corridor, master },
  // 저택 바깥(눈밭): 두 층 모두 지면(y = -0.25)에 그린다.
  outside: [
    ['pine_tree', -3.5, 2, 0], ['pine_tree', -3, 10, 0, { scale: 1.3 }], ['pine_tree', -3.5, 17, 0],
    ['pine_tree', 25, 3, 0, { scale: 1.2 }], ['pine_tree', 24.5, 12, 0], ['pine_tree', 25.5, 19, 0, { scale: 1.4 }],
    ['pine_tree', 2, 22.5, 0], ['pine_tree', 19, 22.5, 0, { scale: 1.2 }], ['pine_tree', 9, -3.5, 0], ['pine_tree', 20.5, -3, 0],
    ['pine_tree', 20.5, 6.5, 0, { scale: 0.8 }],
    ['snowman', 8.5, 21.5, 0],
    ['lamp_post', 11.25, 20.5, 0], ['lamp_post', 14.25, 20.5, 0],
  ],
  // 벽 속 실내 창: 주방 서쪽 벽 → 온실이 보이는 창 (도윤의 목격 진술)
  wallWindows: [{ room: 'kitchen', edge: 'W', from: 3, to: 5 }],
  noWindows: ['cellar'],
  // 들고 갈 수 있는 증거의 생김새 (아이템 지점에 따로 그려서 줍기·숨기기가 가능하게)
  itemLooks: {
    whiskey: ['whiskey_glass', -0.05], watch: ['pocket_watch', 0], earring: ['earring', 0],
    manuscript: ['manuscript', -0.05], pills: ['pill_bottle', -0.05], shawl: ['shawl', 0],
    will: ['will_paper', -0.05], ledger: ['ledger_book', -0.05], firing: ['memo', -0.05], glove: ['glove', 0],
  },
  curtains: { dining: 'carpet_wine', living: 'red', hall: 'carpet_wine', kitchen: 'linen', butler: 'carpet_blue', study: 'carpet_wine', attic: 'linen', guestA: 'carpet_blue', guestB: 'red', corridor: 'carpet_wine', master: 'carpet_wine' },
};
