export const M = {
  cell: 0.5,
  floors: [{ id: 0, name: '1층', height: 3 }, { id: 1, name: '2층', height: 3 }],
  rooms: [
    { id: 'A', name: 'A', floor: 0, rect: [0, 0, 4, 4], floorTex: 'wood', wallTex: 'plaster', light: { color: 0xffffff, intensity: 1 } },
    { id: 'B', name: 'B', floor: 0, rect: [4, 0, 8, 4], floorTex: 'wood', wallTex: 'plaster', light: { color: 0xffffff, intensity: 1 } },
  ],
  doors: [{ a: 'A', b: 'B', x: 4, z: 2, width: 1 }],
  stairs: [],
  passages: [],
  solids: [],
};
