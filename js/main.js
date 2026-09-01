// 画面と模型の接続。
import { City, W, H, key, ux, uy, ROADS, BUILDINGS } from "./grid.js";
import { tick } from "./economy.js";
import { diagnoseLink, corridors } from "./traffic.js";
import { Board, linePath } from "./ui.js";
import { saveCity, loadCity } from "./storage.js";

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 });
const money = (n) => nf.format(Math.round(n));

const TOOLS = [
  { id: "inspect",  label: "調べる" },
  { id: "street",   label: "街路",   cost: ROADS.street.cost,   swatch: "#39424f" },
  { id: "avenue",   label: "大通り", cost: ROADS.avenue.cost,   swatch: "#5b6b80" },
  { id: "R",        label: "住宅",   cost: BUILDINGS.R.cost,    swatch: "#4fb3c4" },
  { id: "C",        label: "商業",   cost: BUILDINGS.C.cost,    swatch: "#e0a33e" },
  { id: "I",        label: "工業",   cost: BUILDINGS.I.cost,    swatch: "#a97fd0" },
  { id: "P",        label: "公園",   cost: BUILDINGS.P.cost,    swatch: "#5fbf72" },
  { id: "move",     label: "移動" },
  { id: "bulldoze", label: "撤去" },
];

const state = {
  tool: "street",
  selected: null,      // 診断で選んだ道路タイル
  moveFrom: null,      // 移設元
  preview: [],
  previewBad: false,
  speed: 0,
  res: null,
  snap: null,
};

// --- 都市の用意 ---
let city = loadCity();
if (!city) {
  city = new City();
  // 最初の一本だけ引いておく。空白の盤面より、隣に建てる規則が早く伝わる。
  for (let x = 6; x <= 19; x++) city.placeRoad(x, 8, "avenue");
}
// --- 道具 ---
const toolbar = $("tools");
for (const t of TOOLS) {
  const b = document.createElement("button");
  b.className = "tool"; b.dataset.id = t.id; b.type = "button";
  b.innerHTML =
    (t.swatch ? `<span class="swatch" style="background:${t.swatch}"></span>` : "") +
    `<span>${t.label}</span>` + (t.cost ? `<small>${money(t.cost)}</small>` : "<small>—</small>");
  b.addEventListener("click", () => selectTool(t.id));
  toolbar.appendChild(b);
}
function selectTool(id) {
  state.tool = id;
  state.moveFrom = null;
  for (const b of toolbar.children) b.setAttribute("aria-pressed", String(b.dataset.id === id));
  draw();
}

// 盤面の採寸は、道具の並びを作って高さが確定してから。
const board = new Board($("grid"), () => draw());
selectTool("street");

// --- 盤面の操作 ---
let dragStart = null;
const cv = $("grid");
// 盤面に乗っている指の数。2本目が来たらピンチなので、描きかけを捨てて
// ブラウザの拡大縮小に譲る（捨てないと、縮めるつもりが道路になる）。
const fingers = new Set();

function cancelDrag() {
  if (!dragStart && state.preview.length === 0) return;
  dragStart = null; state.preview = [];
  draw();
}

cv.addEventListener("pointerdown", (ev) => {
  fingers.add(ev.pointerId);
  if (fingers.size > 1) { cancelDrag(); return; }
  const c = board.cellAt(ev);
  if (!c) return;
  cv.setPointerCapture(ev.pointerId);
  $("hint").classList.add("gone");
  if (state.tool === "inspect") { inspectAt(c); return; }
  if (state.tool === "move") { handleMove(c); return; }
  dragStart = c;
  updatePreview(c);
});

cv.addEventListener("pointermove", (ev) => {
  if (!dragStart || fingers.size > 1) return;
  const c = board.cellAt(ev);
  if (c) updatePreview(c);
});

cv.addEventListener("pointerup", (ev) => {
  fingers.delete(ev.pointerId);
  if (!dragStart) return;
  const cells = state.preview.slice();
  dragStart = null; state.preview = [];
  applyTool(cells);
});
cv.addEventListener("pointercancel", (ev) => { fingers.delete(ev.pointerId); cancelDrag(); });

function updatePreview(c) {
  const isRoad = state.tool === "street" || state.tool === "avenue";
  state.preview = isRoad ? linePath(dragStart, c) : [c];
  state.previewBad = !isRoad && !!state.preview.find(([x, y]) =>
    city.occupied(x, y) || city.adjacentRoads(x, y).length === 0);
  draw();
}

function applyTool(cells) {
  const t = state.tool;
  let spent = 0, placed = 0, err = null;
  for (const [x, y] of cells) {
    if (t === "bulldoze") {
      if (city.bulldoze(x, y)) placed++;
      continue;
    }
    if (t === "street" || t === "avenue") {
      const r = city.placeRoad(x, y, t);
      if (r.error || r.skipped) { err = err || r.error; continue; }
      if (r.price > city.cash) { err = "資金が足りない"; break; }
      city.cash -= r.price; spent += r.price; placed++;
      continue;
    }
    if (BUILDINGS[t]) {
      if (BUILDINGS[t].cost > city.cash) { err = "資金が足りない"; break; }
      const r = city.placeBuilding(x, y, t);
      if (r.error) { err = r.error; continue; }
      city.cash -= r.price; spent += r.price; placed++;
    }
  }
  log(placed ? `${placed}マス操作　-${money(spent)}` : (err ? `置けない：${err}` : ""));
  saveCity(city);
  refresh();
}

function handleMove(c) {
  const k = key(...c);
  if (state.moveFrom == null) {
    if (!city.buildings.has(k)) { log("移す建物を選ぶ"); return; }
    state.moveFrom = k; log("移動先を選ぶ（費用は建設費の半額）"); draw(); return;
  }
  const src = city.buildings.get(state.moveFrom);
  const fee = src.t.cost * 0.5;
  if (fee > city.cash) { log("移設費が足りない"); state.moveFrom = null; draw(); return; }
  if (city.occupied(...c) || city.adjacentRoads(...c).length === 0) {
    log("そこには移せない（占有済みか道路に接していない）"); return;
  }
  const pop = src.pop, act = src.activity;
  city.buildings.delete(state.moveFrom);
  city.topoVersion++;
  city.placeBuilding(c[0], c[1], src.t.key);
  const nb = city.buildings.get(key(...c));
  nb.pop = pop; nb.activity = act;      // 住民と稼働は引き継ぐ
  city.cash -= fee;
  state.moveFrom = null;
  log(`${src.t.label}を移設　-${money(fee)}`);
  saveCity(city);
  refresh();
}

function inspectAt(c) {
  const k = key(...c);
  state.selected = city.roads.has(k) ? k : null;
  renderDiag();
  draw();
}

// --- 時間 ---
let timer = null;
const SPEEDS = [0, 1800, 650];
$("btn-step").addEventListener("click", () => { setSpeed(0); step(); });
$("btn-play").addEventListener("click", () => setSpeed((state.speed + 1) % 3));

function setSpeed(s) {
  state.speed = s;
  const b = $("btn-play");
  b.dataset.speed = String(s);
  b.textContent = s === 0 ? "▶ 再生" : s === 1 ? "▶ 再生中" : "▶▶ 早送り";
  clearTimeout(timer); timer = null;
  if (s > 0) loop();
}
function loop() {
  timer = setTimeout(() => { step(); if (state.speed > 0) loop(); }, SPEEDS[state.speed]);
}
function step() {
  const r = tick(city);
  state.snap = r.snap; state.res = r.res;
  saveCity(city);
  render();
}

// --- 設定 ---
$("in-tax").addEventListener("input", (e) => {
  city.tax = +e.target.value / 100;
  $("v-tax").textContent = `${e.target.value}%`;
  saveCity(city);
});
$("in-budget").addEventListener("input", (e) => {
  city.roadBudget = +e.target.value / 100;
  $("v-budget").textContent = `${e.target.value}%`;
  saveCity(city);
});
$("in-tax").value = String(Math.round(city.tax * 100));
$("in-budget").value = String(Math.round(city.roadBudget * 100));
$("v-tax").textContent = `${Math.round(city.tax * 100)}%`;
$("v-budget").textContent = `${Math.round(city.roadBudget * 100)}%`;

// --- 描画 ---
function draw() { board.draw(city, state.res, state); }
function refresh() { renderStats(); draw(); }
function render() { renderStats(); renderFinance(); renderDiag(); renderWarnings(); draw(); }

function cls(el, good, warn) {
  el.className = good ? "good" : warn ? "warn" : "bad";
}

function renderStats() {
  const s = state.snap;
  $("s-month").textContent = city.month;
  $("s-pop").textContent = money(city.population());
  $("s-cash").textContent = money(city.cash);
  cls($("s-cash"), city.cash > 6000, city.cash > 1000);
  if (!s) return;
  $("s-net").textContent = (s.net >= 0 ? "+" : "") + money(s.net);
  cls($("s-net"), s.net > 0, s.net > -200);
  $("s-commute").textContent = `${s.commute.toFixed(1)}分`;
  cls($("s-commute"), s.commute < 11, s.commute < 16);
  $("s-cong").textContent = s.congestion.toFixed(2);
  cls($("s-cong"), s.congestion < 0.55, s.congestion < 0.8);
  $("s-cond").textContent = `${Math.round(s.avgCondition * 100)}%`;
  cls($("s-cond"), s.avgCondition > 0.8, s.avgCondition > 0.5);

  // 需要：何が足りないかを見せる。これが無いと次に何を建てるか分からない。
  const cl = (v) => Math.max(0, Math.min(1, v));
  const bars = [
    ["住", cl((s.jobRatio - 0.85) / 0.35), "#4fb3c4"],
    ["職", cl((1.0 - s.jobRatio) / 0.35), "#a97fd0"],
    ["店", cl((s.shopRatio - 0.8) / 0.6), "#e0a33e"],
  ];
  $("s-demand").innerHTML = bars.map(([n, v, c]) =>
    `<span class="dbar"><i style="color:${c}">${n}</i>` +
    `<u><s style="width:${(v * 100).toFixed(0)}%;background:${c}"></s></u></span>`).join("");
}

function renderFinance() {
  const s = state.snap;
  if (!s) return;
  const row = (a, b, c = "") => `<tr class="${c}"><td>${a}</td><td>${money(b)}</td></tr>`;
  $("finance-body").innerHTML =
    `<table class="fin">
      ${row("住民税", s.incRes)}${row("商業", s.incShop)}${row("工業", s.incInd)}
      ${row("収入計", s.income, "sum")}
      <tr><td colspan="2" style="height:6px"></td></tr>
      ${row("道路維持", -s.expRoads)}${row("施設維持", -s.expBuildings)}${row("行政", -s.expAdmin)}
      ${row("支出計", -s.expenses, "sum")}
      ${row("差引", s.net, "sum")}
    </table>`;
}

function renderDiag() {
  const res = state.res;
  const body = $("diag-body");
  if (!res || !res.tileVC?.size) {
    body.innerHTML = `<p class="muted">1ヶ月進めると交通が計算される。</p>`;
    return;
  }
  const groups = corridors(res, 0.5, 4);
  if (!groups.length) {
    body.innerHTML = `<p class="muted">どこも詰まっていない。人口を増やす余地がある。</p>`;
    return;
  }
  body.innerHTML = groups.map((gp) => {
    const l = gp.head;
    const d = diagnoseLink(res, l);
    const workShare = d.purpose.find((p) => p.k === "work")?.share ?? 0;
    const src = d.origins.map((o) =>
      `<em>${o.k.t.key}(${o.k.x},${o.k.y})</em> ${(o.share * 100).toFixed(0)}%`).join("、");
    const advice = l.vc >= 1.0
      ? "容量を超えている。この区間を大通りに格上げするのが一番速い。"
      : workShare > 0.6
        ? "職場が遠い。工業か商業を住宅の近くへ移すと効く。"
        : "店が遠い。住宅の近くに商業を足すと効く。";
    const col = l.vc >= 1 ? "bad" : "warn";
    const where = `(${ux(l.tile)},${uy(l.tile)})` +
      (gp.span > 1 ? ` から ${gp.span} マス` : "");
    return `<div class="link" data-tile="${l.tile}" aria-selected="${state.selected === l.tile}">
      <div class="head">
        <span>${where}</span>
        <span class="vc ${col}">v/c ${l.vc.toFixed(2)}</span>
        <span class="muted">${money(l.flow)} / ${money(l.cap)}</span>
      </div>
      <div class="why">通勤 ${(workShare * 100).toFixed(0)}%・買物 ${((1 - workShare) * 100).toFixed(0)}%
        ${src ? `<br>主な発生源：${src}` : ""}
        <br>${advice}</div>
    </div>`;
  }).join("");
  for (const el of body.querySelectorAll(".link")) {
    el.addEventListener("click", () => {
      state.selected = +el.dataset.tile;
      renderDiag(); draw();
    });
  }
}

function log(msg) { $("log").textContent = msg || ""; }

// 繋がっていないことは、黙って人口が減るのではなく言葉で伝える。
function renderWarnings() {
  const s = state.snap;
  if (!s) return;
  const msgs = [];
  if (s.disconnected) msgs.push(`道路に接していない建物が ${s.disconnected} 件`);
  if (s.isolated) msgs.push(`職場に道が繋がっていない住宅が ${s.isolated} 件`);
  $("warn").textContent = msgs.join(" / ");
  $("warn").hidden = !msgs.length;
}

addEventListener("orientationchange", () => setTimeout(() => { board.resize(); draw(); }, 250));

render();
