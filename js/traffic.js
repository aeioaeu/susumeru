// 交通配分：重力モデルによる分布 ＋ MSA による利用者均衡配分。
//
// なぜこの方式か
//   車を1台ずつ経路探索させると CPU を食い尽くすうえ、渋滞の理由が説明できない。
//   BPR 関数（混むほど遅くなる）で均衡を解くと、渋滞は勝手に現れて、
//   しかも「どの施設が、どのリンクを、何%埋めているか」を数字で言える。
//   遊びの根はそこにある。
//
// 速さのために踏んだ手は3つ。どれも結果を変えない。
//   1. ウォームスタート  … 道路網が変わらなければ前月の交通量から解き直す
//   2. 逆順カスケード載荷 … OD毎の経路遡上 O(原点×目的地×経路長) を O(ノード) に
//   3. CSR 隣接表        … 配列の配列をやめてポインタ追跡を消す
import { key, ux, uy, W, H } from "./grid.js";

// BPR の α は実務では 0.15 だが、それはゲームには優しすぎる。
// v/c 0.9 でも旅行時間が1割しか伸びず、渋滞が痛みとして伝わらない。
// α=0.6 にすると v/c 1.0 で 1.6 倍、1.3 で 2.7 倍。これで詰まりが体感になる。
export const ALPHA = 0.60, BETA = 4.0;
export const CONNECTOR_COST = 0.6;
export const THETA_WORK = 0.16;   // 通勤の距離抵抗
export const THETA_SHOP = 0.30;   // 買物は通勤より近場を選ぶ
export const TRIP_RATE_WORK = 0.30;
export const TRIP_RATE_SHOP = 0.20;

const COLD_ITERS = 14, WARM_ITERS = 6, WARM_OFFSET = 4;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// 型付き配列の二分ヒープ。配列の配列にすると Dijkstra 1回ごとに
// 小さな配列が数千個生まれ、GC がフレームを削る。iPad で効く。
class Heap {
  constructor(cap) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  clear() { this.n = 0; }
  push(key, val) {
    if (this.n + 1 > this.k.length) {
      const k = new Float64Array(this.k.length * 2), v = new Int32Array(this.v.length * 2);
      k.set(this.k); v.set(this.v); this.k = k; this.v = v;
    }
    const k = this.k, v = this.v;
    let i = this.n++;
    k[i] = key; v[i] = val;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      const tk = k[p], tv = v[p];
      k[p] = k[i]; v[p] = v[i]; k[i] = tk; v[i] = tv;
      i = p;
    }
  }
  pop() {
    const k = this.k, v = this.v;
    this.outKey = k[0]; this.outVal = v[0];
    const n = --this.n;
    k[0] = k[n]; v[0] = v[n];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let sm = i;
      if (l < n && k[l] < k[sm]) sm = l;
      if (r < n && k[r] < k[sm]) sm = r;
      if (sm === i) break;
      const tk = k[sm], tv = v[sm];
      k[sm] = k[i]; v[sm] = v[i]; k[i] = tk; v[i] = tv;
      i = sm;
    }
  }
}

// ノード = 道路タイル と 建物。エッジ = 隣接道路間 と 接続路（建物→道路）。
// 隣接表は CSR（開始位置＋連結した本体）で持つ。
export function buildGraph(city) {
  const nodeKeys = [...city.roads.keys(), ...city.buildings.keys()];
  const n = nodeKeys.length;
  const index = new Map(nodeKeys.map((k, i) => [k, i]));

  const tails = [], heads = [], frees = [], caps = [], tiles = [];
  const push = (u, v, ft, cap, tile) => {
    tails.push(index.get(u)); heads.push(index.get(v));
    frees.push(ft); caps.push(cap); tiles.push(tile);
  };

  for (const [k, road] of city.roads) {
    const x = k % W, y = (k / W) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const nk = key(nx, ny);
      const other = city.roads.get(nk);
      if (!other) continue;
      push(k, nk, 0.5 * (road.freeTime() + other.freeTime()),
           Math.min(road.capacity(), other.capacity()), nk);
    }
  }
  for (const [k, b] of city.buildings) {
    for (const r of city.adjacentRoads(b.x, b.y)) {
      push(k, r, CONNECTOR_COST, 1e9, -1);
      push(r, k, CONNECTOR_COST, 1e9, -1);
    }
  }

  const m = tails.length;
  const eTail = Int32Array.from(tails), eHead = Int32Array.from(heads);
  const eFree = Float64Array.from(frees), eCap = Float64Array.from(caps);
  const eTile = Int32Array.from(tiles);

  const adjStart = new Int32Array(n + 1);
  for (let i = 0; i < m; i++) adjStart[eTail[i] + 1]++;
  for (let i = 0; i < n; i++) adjStart[i + 1] += adjStart[i];
  const cursor = adjStart.slice(0, n);
  const adjNode = new Int32Array(m), adjEdge = new Int32Array(m);
  for (let i = 0; i < m; i++) {
    const p = cursor[eTail[i]]++;
    adjNode[p] = eHead[i]; adjEdge[p] = i;
  }
  return { nodeKeys, index, n, m, eTail, eFree, eCap, eTile, adjStart, adjNode, adjEdge };
}

function bpr(g, flow, out) {
  for (let i = 0; i < g.m; i++) {
    out[i] = g.eCap[i] > 1e8
      ? g.eFree[i]
      : g.eFree[i] * (1 + ALPHA * Math.pow(flow[i] / g.eCap[i], BETA));
  }
}

// 確定した順に order へ積む。距離の昇順なので、逆から辿れば
// 最短経路木の葉から根へ向かう順序になる。カスケード載荷がこれを使う。
function dijkstra(g, cost, src, dist, prevEdge, heap, order, seen) {
  dist.fill(Infinity); prevEdge.fill(-1); seen.fill(0);
  dist[src] = 0;
  let count = 0;
  heap.clear(); heap.push(0, src);
  const { adjStart, adjNode, adjEdge } = g;
  while (heap.n > 0) {
    heap.pop();
    const d = heap.outKey, u = heap.outVal;
    if (seen[u] || d > dist[u] + 1e-12) continue;
    seen[u] = 1; order[count++] = u;
    const end = adjStart[u + 1];
    for (let p = adjStart[u]; p < end; p++) {
      const v = adjNode[p], eid = adjEdge[p];
      const nd = d + cost[eid];
      if (nd < dist[v] - 1e-12) { dist[v] = nd; prevEdge[v] = eid; heap.push(nd, v); }
    }
  }
  return count;
}

// 逆順カスケード載荷。
// OD ごとに経路を遡ると O(原点×目的地×経路長)。木を距離の降順に一度なぞれば
// O(ノード数) で同じ結果になる。交通配分の定石で、ここが一番効く。
function cascade(aux, g, order, count, prevEdge, nodeVol, contrib, watch, o, purpose) {
  for (let i = count - 1; i >= 0; i--) {
    const u = order[i];
    const vol = nodeVol[u];
    if (vol <= 0) continue;
    nodeVol[u] = 0;
    const eid = prevEdge[u];
    if (eid === -1) continue;
    aux[eid] += vol;
    if (contrib !== null && watch[eid]) {
      let m = contrib.get(eid);
      if (m === undefined) { m = []; contrib.set(eid, m); }
      m.push({ o, purpose, amount: vol });
    }
    nodeVol[g.eTail[eid]] += vol;
  }
}

function demand(city) {
  const origins = [];
  for (const b of city.residentials()) {
    if (b.pop > 0) origins.push({ b, work: b.pop * TRIP_RATE_WORK, shop: b.pop * TRIP_RATE_SHOP });
  }
  const workAttr = [], shopAttr = [];
  for (const b of city.buildings.values()) {
    if (b.t.jobs) workAttr.push({ b, a: b.t.jobs * (0.4 + 0.6 * b.activity), pce: b.t.freight });
    if (b.t.shopPull) shopAttr.push({ b, a: b.t.shopPull * (0.4 + 0.6 * b.activity), pce: 1.0 });
  }
  return { origins, workAttr, shopAttr };
}

const EMPTY = {
  tileVC: new Map(), tileFlow: new Map(), skim: new Map(), worst: [],
  contrib: new Map(), arrivals: new Map(), flow: new Float64Array(0),
  meanCommute: 0, congestion: 0,
};

export function assign(city, iters = 0) {
  const g = buildGraph(city);
  if (!g.m) return EMPTY;
  const { origins, workAttr, shopAttr } = demand(city);
  if (!origins.length || (!workAttr.length && !shopAttr.length)) return EMPTY;

  // 街は毎月ゼロから作り直されるわけではない。道路網が変わっていなければ
  // 前月の交通量から解き直す。必要な反復数が 14 から 6 に減る。
  const cache = city._traffic || (city._traffic = {});
  const warm = cache.flow && cache.topo === city.topoVersion && cache.flow.length === g.m;
  const n = iters || (warm ? WARM_ITERS : COLD_ITERS);

  const flow = warm ? cache.flow : new Float64Array(g.m);
  const aux = new Float64Array(g.m);
  const cost = new Float64Array(g.m);
  const watch = new Uint8Array(g.m);
  const dist = new Float64Array(g.n);
  const prevEdge = new Int32Array(g.n);
  const order = new Int32Array(g.n);
  const seen = new Uint8Array(g.n);
  const nodeVol = new Float64Array(g.n);
  const heap = new Heap(g.m + g.n);
  const wbuf = new Float64Array(Math.max(workAttr.length, shopAttr.length, 1));

  // 建物のノード番号は毎反復引かないで一度だけ引く
  const originIdx = origins.map((o) => g.index.get(key(o.b.x, o.b.y)));
  const workIdx = workAttr.map((d) => g.index.get(key(d.b.x, d.b.y)));
  const shopIdx = shopAttr.map((d) => g.index.get(key(d.b.x, d.b.y)));

  let skim = new Map(), contrib = new Map(), arrivals = new Map();

  for (let it = 1; it <= n; it++) {
    bpr(g, flow, cost);
    aux.fill(0);
    const last = it === n;
    if (last) {
      skim = new Map(); contrib = new Map(); arrivals = new Map();
      // 診断に要るのは混んでいるリンクだけ。全ODの寄与を持つと
      // 数十万件のオブジェクトが生まれる。直前の交通量で当たりをつける。
      watch.fill(0);
      for (let i = 0; i < g.m; i++) {
        if (g.eCap[i] < 1e8 && g.eTile[i] >= 0 && flow[i] / g.eCap[i] > 0.45) watch[i] = 1;
      }
    }

    for (let oi = 0; oi < origins.length; oi++) {
      const o = origins[oi];
      const src = originIdx[oi];
      const count = dijkstra(g, cost, src, dist, prevEdge, heap, order, seen);
      for (let pi = 0; pi < 2; pi++) {
        const attr = pi === 0 ? workAttr : shopAttr;
        const idxs = pi === 0 ? workIdx : shopIdx;
        const trips = pi === 0 ? o.work : o.shop;
        const theta = pi === 0 ? THETA_WORK : THETA_SHOP;
        const purpose = pi === 0 ? "work" : "shop";
        if (trips <= 0 || !attr.length) continue;

        let total = 0;
        for (let i = 0; i < attr.length; i++) {
          if (attr[i].b === o.b) { wbuf[i] = 0; continue; }
          const c = dist[idxs[i]];
          const v = c < Infinity ? attr[i].a * Math.exp(-theta * c) : 0;
          wbuf[i] = v; total += v;
        }
        if (total <= 0) continue;

        let meanCost = 0;
        for (let i = 0; i < attr.length; i++) {
          if (wbuf[i] <= 0) continue;
          const share = wbuf[i] / total, t = trips * share;
          meanCost += share * dist[idxs[i]];
          if (last) {
            const slot = arrivals.get(attr[i].b) || { work: 0, shop: 0 };
            slot[purpose] += t; arrivals.set(attr[i].b, slot);
          }
          nodeVol[idxs[i]] += t * attr[i].pce;  // 目的地に積む
        }
        cascade(aux, g, order, count, prevEdge, nodeVol,
                last ? contrib : null, watch, o.b, purpose);
        if (last) {
          const sk = skim.get(o.b) || { work: 0, shop: 0 };
          sk[purpose] = meanCost; skim.set(o.b, sk);
        }
      }
    }
    const step = warm ? 1 / (it + WARM_OFFSET) : 1 / it;
    for (let i = 0; i < g.m; i++) flow[i] += step * (aux[i] - flow[i]);
  }

  cache.flow = flow; cache.topo = city.topoVersion;
  return result(g, flow, skim, contrib, arrivals, origins);
}

function result(g, flow, skim, contrib, arrivals, origins) {
  const tileVC = new Map(), tileFlow = new Map(), links = [];
  for (let i = 0; i < g.m; i++) {
    if (g.eCap[i] > 1e8 || g.eTile[i] < 0) continue;
    const vc = flow[i] / g.eCap[i], tile = g.eTile[i];
    if (vc > (tileVC.get(tile) ?? 0)) { tileVC.set(tile, vc); tileFlow.set(tile, flow[i]); }
    links.push({ vc, eid: i, tile, flow: flow[i], cap: g.eCap[i] });
  }
  links.sort((a, b) => b.vc - a.vc);

  const totalPop = origins.reduce((s, o) => s + o.b.pop, 0) || 1;
  const meanCommute = origins.reduce(
    (s, o) => s + (skim.get(o.b)?.work ?? 0) * o.b.pop, 0) / totalPop;

  let veh = 0, weighted = 0;
  for (let i = 0; i < g.m; i++) {
    if (g.eCap[i] > 1e8 || g.eTile[i] < 0) continue;
    veh += flow[i]; weighted += (flow[i] * flow[i]) / g.eCap[i];
  }

  // 同じタイルの上り下りが両方出ると読みにくいので、タイル単位で最悪だけ残す
  const bestPerTile = new Map();
  for (const l of links) {
    const prev = bestPerTile.get(l.tile);
    if (!prev || l.vc > prev.vc) bestPerTile.set(l.tile, l);
  }
  const worst = [...bestPerTile.values()].sort((a, b) => b.vc - a.vc).slice(0, 8);

  const tileLink = new Map();
  for (const l of links) {
    const prev = tileLink.get(l.tile);
    if (!prev || l.vc > prev.vc) tileLink.set(l.tile, l);
  }

  return {
    tileVC, tileFlow, skim, arrivals, contrib, flow, worst, tileLink,
    meanCommute,
    congestion: veh > 0 ? weighted / veh : 0,
  };
}

// 診断：生の OD は細かすぎて対策に使えないので、発生源と目的で束ねる。
export function diagnoseLink(res, link) {
  const rows = res.contrib.get(link.eid) || [];
  const total = rows.reduce((s, r) => s + r.amount, 0) || 1;
  const bucket = (fn) => {
    const m = new Map();
    for (const r of rows) m.set(fn(r), (m.get(fn(r)) || 0) + r.amount);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ k, share: v / total }));
  };
  return { total, purpose: bucket((r) => r.purpose), origins: bucket((r) => r.o).slice(0, 4) };
}


// 詰まっているタイルを「区間」にまとめる。
// 一本の道が10マス混んでいるのは渋滞1件であって10件ではない。
// 別々に並べると同じ話を繰り返すだけで、対策の判断に使えない。
export function corridors(res, minVC = 0.5, limit = 4) {
  const hot = [...res.tileVC.entries()].filter(([, vc]) => vc >= minVC)
    .sort((a, b) => b[1] - a[1]);
  const vcOf = new Map(hot);
  const seen = new Set();
  const groups = [];

  for (const [start, vc] of hot) {
    if (seen.has(start)) continue;
    seen.add(start);
    const stack = [start], tiles = [];
    while (stack.length) {
      const t = stack.pop();
      tiles.push(t);
      const x = ux(t), y = uy(t);
      for (const [dx, dy] of DIRS) {
        const nk = key(x + dx, y + dy);
        if (x + dx < 0 || x + dx >= W || y + dy < 0 || y + dy >= H) continue;
        if (seen.has(nk) || !vcOf.has(nk)) continue;
        if (Math.abs(vcOf.get(nk) - vc) > 0.18) continue;   // 混み方が近いものだけ繋ぐ
        seen.add(nk); stack.push(nk);
      }
    }
    const head = res.tileLink.get(start);
    groups.push({ tiles, head, vc, span: tiles.length });
  }
  return groups.slice(0, limit);
}
