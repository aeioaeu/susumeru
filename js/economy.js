// 月次の経済とフィードバック。
//
// 設計の要：
//   予算 → 舗装状態 → 道路容量 → 渋滞 → 通勤時間 → 人口と税収 → 予算
// この輪が閉じているので、財務の判断が交通の問題として返ってくる。
// しかも舗装状態は目標値へ徐々に近づくため、削減の報いは数ヶ月遅れて来る。
// 「今月の帳尻を合わせた代償を半年後に払う」——それが管理を遊びにする。
import { assign, TRIP_RATE_WORK } from "./traffic.js";

export const RES_TAX = 9.0;         // 住民1人あたり課税所得（月）
export const ADMIN_PER_CAPITA = 0.75; // 人口に比例する行政費。成長は自動では黒字化しない
export const SHOP_SPEND = 14.0;     // 買物客1トリップあたり売上
export const IND_OUTPUT = 12.0;     // 労働者1人あたり出荷額
export const GROWTH_RATE = 0.10;
export const COND_RATE = 0.18;
// 通勤時間が人口を縛る強さ。ここが緩いと渋滞が成長の制約にならず、
// 街は勝手に大きくなって交通対策が要らなくなる。
export const COMMUTE_OK = 6.0, COMMUTE_BAD = 20.0;

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

function parkBonus(city, b) {
  let bonus = 0;
  for (const p of city.buildings.values()) {
    if (p.t.desirability <= 0) continue;
    const d = Math.abs(p.x - b.x) + Math.abs(p.y - b.y);
    if (d <= p.t.radius) bonus += p.t.desirability * (1 - d / (p.t.radius + 1));
  }
  return Math.min(bonus, 0.30);
}

export function tick(city, iters = 14) {
  const res = assign(city, iters);

  const workersNeeded = city.population() * TRIP_RATE_WORK;
  const jobs = [...city.buildings.values()]
    .filter((b) => b.t.jobs)
    .reduce((s, b) => s + b.t.jobs * (0.4 + 0.6 * b.activity), 0);
  const jobRatio = workersNeeded > 0 ? clamp(jobs / workersNeeded, 0, 1.2) : 1;
  const taxEffect = clamp(1 - (city.tax - 0.09) * 4.0, 0.2, 1.25);

  let incRes = 0, incShop = 0, incInd = 0;
  let expBuildings = 0, expRoads = 0, disconnected = 0, isolated = 0;

  for (const b of city.buildings.values()) {
    const connected = city.adjacentRoads(b.x, b.y).length > 0;
    if (!connected) disconnected++;

    if (b.t.maxPop) {
      // 道路には接しているのに、どの職場にも到達できない住宅。
      // 黙って人口が消えるだけだと原因が分からないので、数えて画面に出す。
      const reach = res.skim.get(b);
      if (connected && !reach && b.pop > 0) isolated++;
      b.commute = connected ? (reach?.work ?? COMMUTE_BAD) : COMMUTE_BAD;
      const access = clamp(1 - (b.commute - COMMUTE_OK) / (COMMUTE_BAD - COMMUTE_OK));
      const quality = clamp(access * taxEffect * Math.min(1, jobRatio) + parkBonus(city, b));
      b.pop = Math.max(0, b.pop + (b.t.maxPop * quality - b.pop) * GROWTH_RATE);
      incRes += b.pop * RES_TAX * city.tax;
    }
    if (b.t.shopPull) {
      b.customers = connected ? (res.arrivals.get(b)?.shop ?? 0) : 0;
      b.activity += (clamp(b.customers / 60) - b.activity) * 0.20;
      incShop += b.customers * SHOP_SPEND * city.tax;
    }
    if (b.t.jobs && !b.t.shopPull) {
      b.workers = connected ? (res.arrivals.get(b)?.work ?? 0) : 0;
      b.activity += (clamp(b.workers / Math.max(1, b.t.jobs * 0.35)) - b.activity) * 0.20;
      incInd += Math.min(b.workers, b.t.jobs) * IND_OUTPUT * city.tax;
    }
    expBuildings += b.t.upkeep;
  }

  for (const road of city.roads.values()) {
    expRoads += road.t.upkeep * city.roadBudget;
    road.condition = clamp(
      road.condition + COND_RATE * (city.roadBudget - road.condition), 0.15, 1.0);
  }

  // 需要指標：何が足りないかをプレイヤーに見せる。
  // 仕事が余れば住宅が要り、働き手が余れば職場が要る。
  const shopCap = [...city.buildings.values()]
    .filter((b) => b.t.shopPull).length * 60;
  const shopRatio = shopCap > 0 ? (city.population() * 0.20) / shopCap : Infinity;

  const pop = city.population();
  const expAdmin = pop * ADMIN_PER_CAPITA;
  const income = incRes + incShop + incInd;
  const expenses = expRoads + expBuildings + expAdmin;

  city.cash += income - expenses;
  city.month += 1;

  const avgCondition = city.roads.size
    ? [...city.roads.values()].reduce((s, r) => s + r.condition, 0) / city.roads.size
    : 1;

  const snap = {
    month: city.month, pop, cash: city.cash,
    income, expenses, net: income - expenses,
    incRes, incShop, incInd, expRoads, expBuildings, expAdmin,
    commute: res.meanCommute, congestion: res.congestion,
    avgCondition, disconnected, isolated, jobRatio, shopRatio,
  };
  city.history.push(snap);
  if (city.history.length > 600) city.history.shift();
  return { snap, res };
}
