// localStorage への保存。iPad はアプリを切ると平気で捨てられるので、
// 毎月と毎編集で書く。壊れた保存で起動不能にならないよう必ず try で包む。
import { City, Road, Building, ROADS, BUILDINGS, ux, uy } from "./grid.js";

const KEY = "citymvp.v1";

export function saveCity(city) {
  try {
    const data = {
      v: 1, cash: city.cash, month: city.month, tax: city.tax,
      roadBudget: city.roadBudget,
      roads: [...city.roads].map(([k, r]) => [k, r.t.key, Math.round(r.condition * 100)]),
      buildings: [...city.buildings].map(([k, b]) =>
        [k, b.t.key, Math.round(b.pop), Math.round(b.activity * 100)]),
    };
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch { /* 容量超過やプライベートモード。保存できなくても遊べる */ }
}

export function loadCity() {
  let raw;
  try { raw = localStorage.getItem(KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    if (d.v !== 1) return null;
    const c = new City();
    c.cash = d.cash; c.month = d.month; c.tax = d.tax; c.roadBudget = d.roadBudget;
    for (const [k, t, cond] of d.roads) {
      if (!ROADS[t]) continue;
      const r = new Road(ROADS[t]); r.condition = cond / 100; c.roads.set(k, r);
    }
    for (const [k, t, pop, act] of d.buildings) {
      if (!BUILDINGS[t]) continue;
      const b = new Building(BUILDINGS[t], ux(k), uy(k));
      b.pop = pop; b.activity = act / 100;
      c.buildings.set(k, b);
    }
    c.topoVersion = 1;
    return c;
  } catch { return null; }
}

export function clearCity() {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
}
