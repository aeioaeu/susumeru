// マップとタイル。1タイル = 1施設。道路もタイル。
export const W = 26, H = 16;
export const key = (x, y) => y * W + x;
export const ux = (k) => k % W;
export const uy = (k) => (k / W) | 0;

export const ROADS = {
  street: { key: "street", label: "街路",   char: "-", capacity: 800,  speed: 1.00, cost: 60,  upkeep: 5,  tier: 1 },
  avenue: { key: "avenue", label: "大通り", char: "=", capacity: 2400, speed: 1.55, cost: 200, upkeep: 15, tier: 2 },
};

export const BUILDINGS = {
  R: { key: "R", label: "住宅", cost: 600,  upkeep: 0,  maxPop: 320, jobs: 0,   shopPull: 0,   freight: 1.0, desirability: 0,    radius: 0 },
  C: { key: "C", label: "商業", cost: 900,  upkeep: 60, maxPop: 0,   jobs: 90,  shopPull: 120, freight: 1.0, desirability: 0,    radius: 0 },
  I: { key: "I", label: "工業", cost: 1400, upkeep: 90, maxPop: 0,   jobs: 170, shopPull: 0,   freight: 1.9, desirability: 0,    radius: 0 },
  P: { key: "P", label: "公園", cost: 400,  upkeep: 70, maxPop: 0,   jobs: 0,   shopPull: 0,   freight: 1.0, desirability: 0.35, radius: 4 },
};

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class Building {
  constructor(type, x, y) {
    this.t = type; this.x = x; this.y = y;
    this.pop = type.maxPop ? 40 : 0;
    this.activity = type.jobs ? 0.35 : 0;
    this.commute = 0; this.customers = 0; this.workers = 0;
  }
  get label() { return `${this.t.key}(${this.x},${this.y})`; }
}

export class Road {
  constructor(type) { this.t = type; this.condition = 1.0; }
  capacity() { return this.t.capacity * (0.55 + 0.45 * this.condition); }
  freeTime() { return 1.0 / this.t.speed; }
}

export class City {
  constructor() {
    this.roads = new Map();      // key -> Road
    this.buildings = new Map();  // key -> Building
    this.cash = 20000;
    this.month = 0;
    this.tax = 0.10;
    this.roadBudget = 1.0;
    this.history = [];
    this.topoVersion = 0;   // 道路・建物の増減で上がる。交通量のキャッシュ判定に使う
  }

  inBounds(x, y) { return x >= 0 && x < W && y >= 0 && y < H; }
  occupied(x, y) { const k = key(x, y); return this.roads.has(k) || this.buildings.has(k); }
  residentials() { return [...this.buildings.values()].filter((b) => b.t.maxPop); }
  population() { return this.residentials().reduce((s, b) => s + b.pop, 0); }

  adjacentRoads(x, y) {
    const out = [];
    for (const [dx, dy] of NEIGHBOURS) {
      const k = key(x + dx, y + dy);
      if (this.inBounds(x + dx, y + dy) && this.roads.has(k)) out.push(k);
    }
    return out;
  }

  // 道路は「格上げのみ」。街路で大通りを踏んでも降格させない。
  // 降格を許すと交差点に見えないボトルネックができ、原因が読めなくなる。
  placeRoad(x, y, typeKey) {
    const rt = ROADS[typeKey];
    if (!this.inBounds(x, y)) return { error: "範囲外" };
    const k = key(x, y);
    if (this.buildings.has(k)) return { error: "建物がある" };
    const old = this.roads.get(k);
    if (old && old.t.tier >= rt.tier) return { price: 0, skipped: true };
    const price = rt.cost - (old ? old.t.cost * 0.4 : 0);
    this.roads.set(k, new Road(rt));
    this.topoVersion++;
    return { price };
  }

  placeBuilding(x, y, typeKey) {
    const bt = BUILDINGS[typeKey];
    if (!this.inBounds(x, y)) return { error: "範囲外" };
    if (this.occupied(x, y)) return { error: "すでに何かある" };
    if (this.adjacentRoads(x, y).length === 0) return { error: "道路に接していない" };
    this.buildings.set(key(x, y), new Building(bt, x, y));
    this.topoVersion++;
    return { price: bt.cost };
  }

  bulldoze(x, y) {
    const k = key(x, y);
    if (this.buildings.delete(k)) { this.topoVersion++; return "building"; }
    if (this.roads.delete(k)) { this.topoVersion++; return "road"; }
    return null;
  }
}
