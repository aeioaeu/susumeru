// 「渋滞対策」と「財務管理」が本当に遊びとして成立するかの検証。
// 面白さの仮説は「操作が結果に返ってくること」なので、それを数字で確かめる。
import { tick } from "../js/economy.js";
import { classicTown, line, build, road } from "./sim.mjs";
import { key } from "../js/grid.js";

const run = (c, n) => { let r; for (let i = 0; i < n; i++) r = tick(c); return r.snap; };
const fmt = (s) => `人口${s.pop.toFixed(0).padStart(5)} 通勤${s.commute.toFixed(1)}分 ` +
  `渋滞${s.congestion.toFixed(2)} 舗装${(s.avgCondition*100).toFixed(0)}% 収支${s.net.toFixed(0).padStart(6)}`;

console.log("=== 検証1: 道路予算の削減は、遅れて渋滞として返ってくるか ===");
{
  const c = classicTown();
  console.log("  基準(40ヶ月)      ", fmt(run(c, 40)));
  c.roadBudget = 0.40;
  console.log("  予算40%に削減 ->");
  for (const m of [3, 6, 12, 24]) {
    const before = c.month;
    console.log(`   +${String(m - (before - 40)).padStart(2)}ヶ月 (計${m})  `,
      fmt(run(c, m - (before - 40))));
  }
  c.roadBudget = 1.0;
  console.log("  予算を戻して24ヶ月 ", fmt(run(c, 24)));
}

console.log("\n=== 検証2: 工場を住宅の近くに移すと通勤と人口は改善するか ===");
{
  const a = classicTown(); const base = run(a, 40);
  console.log("  移設なし(40ヶ月)  ", fmt(base));

  const b = classicTown(); run(b, 40);
  // 遠い工業2つを住宅側の空きへ移す（道路に接した位置）
  const moves = [[19, 6, 5, 11], [21, 6, 7, 11]];
  for (const [x1, y1, x2, y2] of moves) {
    const src = b.buildings.get(key(x1, y1));
    if (!src) { console.log(`  移設元なし (${x1},${y1})`); continue; }
    const r = b.placeBuilding(x2, y2, src.t.key);
    if (r.error) { console.log(`  移設先不可 (${x2},${y2}): ${r.error}`); continue; }
    const nb = b.buildings.get(key(x2, y2));
    nb.pop = src.pop; nb.activity = src.activity;
    b.buildings.delete(key(x1, y1));
    b.cash -= src.t.cost * 0.5;
  }
  console.log("  工業2つを移設 ->  ", fmt(run(b, 24)));
}

console.log("\n=== 検証3: 道路を1本足すと全体は良くなるか（ブライスの逆説の確認）===");
{
  const a = classicTown(); console.log("  現状(40ヶ月)      ", fmt(run(a, 40)));
  const b = classicTown(); run(b, 40);
  road(b, 8, 3, 22, 3, "street");    // 北側にバイパスを1本
  road(b, 8, 3, 8, 7); road(b, 22, 3, 22, 7);
  console.log("  北バイパス追加 -> ", fmt(run(b, 24)));
  const d = classicTown(); run(d, 40);
  road(d, 1, 8, 24, 8, "avenue");
  console.log("  （比較）何もしない", fmt(run(d, 24)));
}
