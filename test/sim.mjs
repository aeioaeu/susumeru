// ブラウザ無しでシミュレーションを回す検証用ハーネス。
import { City, key } from "../js/grid.js";
import { tick } from "../js/economy.js";
import { diagnoseLink } from "../js/traffic.js";

export function road(city, x1, y1, x2, y2, t = "street") {
  const pts = [], sx = x2 >= x1 ? 1 : -1, sy = y2 >= y1 ? 1 : -1;
  for (let x = x1; x !== x2 + sx; x += sx) pts.push([x, y1]);
  for (let y = y1; y !== y2 + sy; y += sy) pts.push([x2, y]);
  for (const [x, y] of pts) {
    const r = city.placeRoad(x, y, t);
    if (r.price) city.cash -= r.price;
  }
}
export function build(city, t, x, y) {
  const r = city.placeBuilding(x, y, t);
  if (r.error) { console.log(`  建てられない ${t}(${x},${y}): ${r.error}`); return; }
  city.cash -= r.price;
}

export function classicTown() {
  const c = new City();
  c.cash = 60000;
  road(c, 1, 8, 24, 8, "avenue");
  road(c, 3, 4, 3, 12); road(c, 6, 4, 6, 12);
  road(c, 20, 5, 20, 11);
  for (const [x, y] of [[2,5],[4,5],[2,7],[4,7],[2,9],[4,9],[2,11],[4,11],
                        [5,5],[7,5],[5,7],[7,7],[5,9],[7,9]]) build(c, "R", x, y);
  build(c, "C", 12, 7); build(c, "C", 14, 7);
  build(c, "C", 12, 9); build(c, "C", 14, 9);
  build(c, "I", 19, 6); build(c, "I", 21, 6);
  build(c, "I", 19, 10); build(c, "I", 21, 10);
  return c;
}

export function line(snap) {
  const f = (n, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
  return `${String(snap.month).padStart(3)}ヶ月  人口${String(f(snap.pop)).padStart(6)}` +
    `  資金${String(f(snap.cash)).padStart(9)}  収支${String(f(snap.net)).padStart(7)}` +
    `  通勤${snap.commute.toFixed(1).padStart(5)}分  渋滞${snap.congestion.toFixed(2)}` +
    `  舗装${(snap.avgCondition * 100).toFixed(0).padStart(3)}%`;
}

if (process.argv[1] && process.argv[1].endsWith("sim.mjs")) {
  const c = classicTown();
  console.log("== 標準の町を60ヶ月 ==");
  let last;
  for (let m = 1; m <= 60; m++) {
    const r = tick(c); last = r;
    if (m % 10 === 0) console.log(line(r.snap));
  }
  const s = last.snap;
  console.log(`\n内訳  収入: 住民${s.incRes.toFixed(0)} 商業${s.incShop.toFixed(0)} 工業${s.incInd.toFixed(0)}`);
  console.log(`      支出: 道路${s.expRoads.toFixed(0)} 施設${s.expBuildings.toFixed(0)} 行政${s.expAdmin.toFixed(0)}`);
  console.log("\n== 混雑上位 ==");
  for (const l of last.res.worst.slice(0, 3)) {
    const d = diagnoseLink(last.res, l);
    const x = l.tile % 26, y = (l.tile / 26) | 0;
    console.log(` (${x},${y}) v/c ${l.vc.toFixed(2)}  ${l.flow.toFixed(0)}/${l.cap.toFixed(0)}` +
      `  ${d.purpose.map((p) => `${p.k === "work" ? "通勤" : "買物"}${(p.share*100).toFixed(0)}%`).join(" ")}` +
      `  発生源: ${d.origins.map((o) => `${o.k.label}${(o.share*100).toFixed(0)}%`).join(" ")}`);
  }
}
