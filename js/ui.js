// 盤面の描画と座標変換。テクスチャは持たない。
// 色だけで「どこが詰まっているか」を一目で読ませるのが仕事。
import { W, H, key, ux, uy } from "./grid.js";

// 混雑の色。v/c が上がるほど暖色へ。
// 段でパッと切り替わるほうが、連続階調より「越えた」ことが分かる。
const BANDS = [
  [0.30, "#39424f"],  // 静か
  [0.60, "#3f7d54"],  // 流れている
  [0.85, "#b0982f"],  // 重い
  [1.00, "#c9702f"],  // 詰まりかけ
  [1.30, "#cf4239"],  // 容量超過
  [Infinity, "#ff5f52"],
];
export function vcColor(vc) {
  for (const [t, c] of BANDS) if (vc < t) return c;
  return "#ff5f52";
}

const TYPE_COLOR = { R: "#4fb3c4", C: "#e0a33e", I: "#a97fd0", P: "#5fbf72" };

export class Board {
  // 採寸は ResizeObserver に任せる。
  // 初期化時に一度測るだけだと、あとから道具の並びや診断パネルが伸びて
  // 盤面が縮んだときにセル寸法が古いままになり、タップ位置が数マスずれる。
  // iPad では回転・パネル開閉・ソフトキーボードで普通に起きる。
  constructor(canvas, onResize) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.cell = 16;
    this.ox = this.oy = 0;
    this.resize();
    if (typeof ResizeObserver !== "undefined") {
      let first = true;
      this.ro = new ResizeObserver(() => {
        this.resize();
        if (first) { first = false; return; }
        onResize?.();
      });
      this.ro.observe(canvas);
    }
  }

  resize() {
    const rect = this.cv.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cv.width = Math.round(rect.width * dpr);
    this.cv.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cell = Math.floor(Math.min(rect.width / W, rect.height / H));
    this.ox = Math.floor((rect.width - this.cell * W) / 2);
    this.oy = Math.floor((rect.height - this.cell * H) / 2);
    this.w = rect.width; this.h = rect.height;
  }

  cellAt(ev) {
    const r = this.cv.getBoundingClientRect();
    const x = Math.floor((ev.clientX - r.left - this.ox) / this.cell);
    const y = Math.floor((ev.clientY - r.top - this.oy) / this.cell);
    return x >= 0 && x < W && y >= 0 && y < H ? [x, y] : null;
  }

  draw(city, res, state = {}) {
    const g = this.ctx, s = this.cell;
    g.clearRect(0, 0, this.w, this.h);

    // 空きマス
    g.fillStyle = "#141922";
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        g.fillRect(this.ox + x * s + 1, this.oy + y * s + 1, s - 2, s - 2);
      }
    }

    // 道路
    const vcMap = res?.tileVC;
    for (const [k, road] of city.roads) {
      const x = ux(k), y = uy(k);
      const vc = vcMap?.get(k) ?? 0;
      g.fillStyle = vcColor(vc);
      const pad = road.t.tier === 2 ? 0 : 2;
      g.fillRect(this.ox + x * s + pad, this.oy + y * s + pad, s - pad * 2, s - pad * 2);
      if (road.condition < 0.7) {   // 傷んだ舗装は点線で示す
        g.fillStyle = `rgba(0,0,0,${0.45 * (1 - road.condition)})`;
        for (let i = 2; i < s - 2; i += 4) {
          g.fillRect(this.ox + x * s + i, this.oy + y * s + s / 2 - 1, 2, 2);
        }
      }
    }

    // 建物
    g.textAlign = "center"; g.textBaseline = "middle";
    g.font = `700 ${Math.max(9, Math.floor(s * 0.55))}px ui-monospace,Menlo,monospace`;
    for (const [k, b] of city.buildings) {
      const x = ux(k), y = uy(k);
      const px = this.ox + x * s + 1, py = this.oy + y * s + 1, sz = s - 2;
      const col = TYPE_COLOR[b.t.key];
      g.fillStyle = "#1b2028";
      g.fillRect(px, py, sz, sz);
      const ratio = b.t.maxPop ? b.pop / b.t.maxPop : (b.t.jobs ? b.activity : 1);
      if (ratio > 0) {
        g.globalAlpha = 0.30;
        g.fillStyle = col;
        g.fillRect(px, py + sz * (1 - ratio), sz, sz * ratio);
        g.globalAlpha = 1;
      }
      g.fillStyle = col;
      g.fillText(b.t.key, px + sz / 2, py + sz / 2 + 0.5);
      if (city.adjacentRoads(b.x, b.y).length === 0) {
        g.strokeStyle = "#e0574c"; g.lineWidth = 2;
        g.strokeRect(px + 1, py + 1, sz - 2, sz - 2);
      }
    }

    // 選択中のリンク
    if (state.selected != null && city.roads.has(state.selected)) {
      const x = ux(state.selected), y = uy(state.selected);
      g.strokeStyle = "#7fc4ff"; g.lineWidth = 2;
      g.strokeRect(this.ox + x * s - 1, this.oy + y * s - 1, s + 2, s + 2);
    }

    // 敷設のプレビュー
    if (state.preview?.length) {
      g.fillStyle = state.previewBad ? "rgba(224,87,76,.45)" : "rgba(127,196,255,.40)";
      for (const [x, y] of state.preview) {
        g.fillRect(this.ox + x * s + 1, this.oy + y * s + 1, s - 2, s - 2);
      }
    }

    // 移設元
    if (state.moveFrom != null) {
      const x = ux(state.moveFrom), y = uy(state.moveFrom);
      g.strokeStyle = "#e0a33e"; g.lineWidth = 2;
      g.setLineDash([4, 3]);
      g.strokeRect(this.ox + x * s, this.oy + y * s, s, s);
      g.setLineDash([]);
    }
  }
}

// 直線かL字。斜めは引けない（グリッド前提を守る）。
export function linePath(a, b) {
  const [x1, y1] = a, [x2, y2] = b;
  const pts = [], sx = x2 >= x1 ? 1 : -1, sy = y2 >= y1 ? 1 : -1;
  for (let x = x1; x !== x2 + sx; x += sx) pts.push([x, y1]);
  for (let y = y1 + sy; y !== y2 + sy; y += sy) pts.push([x2, y]);
  return pts;
}
