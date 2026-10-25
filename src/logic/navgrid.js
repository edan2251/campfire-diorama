// 이동 영역 격자 + A* 경로 (F04). 좌표는 섬 윗면 평면 (x, z), 단위 H. three.js 없이 테스트 가능.
// 이동 가능 = 섬 외곽선 안에서 가장자리까지 거리 ≥ edgeMargin, 그리고 부풀린 장애물 밖.
// 경로 없음·섬 밖 클릭은 { ok:false }로 돌려주고 이동 명령으로 확정하지 않는다(호출자 책임).

export function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distToSegment(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const L = dx * dx + dz * dz;
  let t = L > 0 ? ((x - ax) * dx + (z - az) * dz) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
}

export function distToPolygonEdge(x, z, poly) {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, distToSegment(x, z, poly[j][0], poly[j][1], poly[i][0], poly[i][1]));
  return d;
}

export function ellipsePolygon(rx, rz, n = 64, cx = 0, cz = 0) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([cx + rx * Math.cos(a), cz + rz * Math.sin(a)]); }
  return out;
}

/** 장애물: {type:'circle', x, z, r} | {type:'rect', x, z, hw, hd, yaw} (yaw: 라디안, x축 기준 반시계) */
export function obstacleDistance(x, z, o) {
  if (o.type === 'circle') return Math.hypot(x - o.x, z - o.z) - o.r;
  const c = Math.cos(-o.yaw), s = Math.sin(-o.yaw);
  const lx = (x - o.x) * c - (z - o.z) * s;
  const lz = (x - o.x) * s + (z - o.z) * c;
  const qx = Math.abs(lx) - o.hw, qz = Math.abs(lz) - o.hd;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

export function buildNavGrid({ outline, obstacles = [], cell = 0.08, agentRadius = 0.16, edgeMargin = 0.12 }) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of outline) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const nx = Math.ceil((maxX - minX) / cell) + 1;
  const nz = Math.ceil((maxZ - minZ) / cell) + 1;
  const free = new Uint8Array(nx * nz);
  const edge = agentRadius + edgeMargin;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = minX + i * cell, z = minZ + j * cell;
      if (!pointInPolygon(x, z, outline) || distToPolygonEdge(x, z, outline) < edge) continue;
      if (obstacles.some((o) => obstacleDistance(x, z, o) < agentRadius)) continue;
      free[j * nx + i] = 1;
    }
  }
  const grid = { nx, nz, cell, minX, minZ, free, outline, obstacles, agentRadius, edgeMargin };
  grid.toCell = (x, z) => [Math.round((x - minX) / cell), Math.round((z - minZ) / cell)];
  grid.toWorld = (i, j) => [minX + i * cell, minZ + j * cell];
  grid.isFree = (i, j) => i >= 0 && j >= 0 && i < nx && j < nz && free[j * nx + i] === 1;
  grid.isWalkable = (x, z) => { const [i, j] = grid.toCell(x, z); return grid.isFree(i, j); };
  return grid;
}

/** 가장 가까운 이동 가능 칸 (반경 maxDist 안). 없으면 null */
export function nearestFree(grid, x, z, maxDist) {
  const [ci, cj] = grid.toCell(x, z);
  if (grid.isFree(ci, cj)) return grid.toWorld(ci, cj);
  const rmax = Math.ceil(maxDist / grid.cell);
  let best = null, bestD = Infinity;
  for (let r = 1; r <= rmax; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r || !grid.isFree(ci + di, cj + dj)) continue;
        const [wx, wz] = grid.toWorld(ci + di, cj + dj);
        const d = Math.hypot(wx - x, wz - z);
        if (d < bestD && d <= maxDist) { bestD = d; best = [wx, wz]; }
      }
    }
    if (best && bestD <= r * grid.cell) break;
  }
  return best;
}

function lineFree(grid, a, b) {
  const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (grid.cell * 0.5));
  for (let k = 0; k <= steps; k++) {
    const t = steps ? k / steps : 0;
    if (!grid.isWalkable(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return false;
  }
  return true;
}

/** A* (8방향, 모서리 끼어들기 금지) + 시야 기반 다듬기. 반환 {ok, path:[[x,z]...], reason, length} */
export function findPath(grid, from, to, { snap = 0.3 } = {}) {
  const start = nearestFree(grid, from[0], from[1], Math.max(snap, 0.4));
  if (!start) return { ok: false, reason: 'start-blocked' };
  if (!pointInPolygon(to[0], to[1], grid.outline)) return { ok: false, reason: 'outside-island' };
  const goal = nearestFree(grid, to[0], to[1], snap);
  if (!goal) return { ok: false, reason: 'not-walkable' };
  const [si, sj] = grid.toCell(...start);
  const [gi, gj] = grid.toCell(...goal);
  const { nx } = grid;
  const N = grid.nx * grid.nz;
  const g = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const open = [];        // 작은 장면이라 정렬된 배열 힙으로 충분
  const h = (i, j) => { const dx = Math.abs(i - gi), dz = Math.abs(j - gj); return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz); };
  const push = (idx, f) => { let lo = 0, hi = open.length; while (lo < hi) { const m = (lo + hi) >> 1; if (open[m][1] < f) lo = m + 1; else hi = m; } open.splice(lo, 0, [idx, f]); };
  const s = sj * nx + si;
  g[s] = 0;
  push(s, h(si, sj));
  const goalIdx = gj * nx + gi;
  while (open.length) {
    const [cur] = open.shift();
    if (closed[cur]) continue;
    if (cur === goalIdx) break;
    closed[cur] = 1;
    const ci = cur % nx, cj = (cur - ci) / nx;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (!grid.isFree(ni, nj)) continue;
        if (di && dj && (!grid.isFree(ci + di, cj) || !grid.isFree(ci, cj + dj))) continue;
        const n = nj * nx + ni;
        const cost = g[cur] + (di && dj ? Math.SQRT2 : 1);
        if (cost < g[n]) { g[n] = cost; came[n] = cur; push(n, cost + h(ni, nj)); }
      }
    }
  }
  if (!(g[goalIdx] < Infinity)) return { ok: false, reason: 'no-path' };
  const cells = [];
  for (let c = goalIdx; c !== -1; c = came[c]) cells.push(grid.toWorld(c % nx, Math.floor(c / nx)));
  cells.reverse();
  cells[0] = [...start];
  cells[cells.length - 1] = [...goal];
  const path = [cells[0]];
  let anchor = 0;
  for (let k = 2; k < cells.length; k++) {
    if (!lineFree(grid, cells[anchor], cells[k])) { path.push(cells[k - 1]); anchor = k - 1; }
  }
  if (cells.length > 1) path.push(cells[cells.length - 1]);
  let length = 0;
  for (let k = 1; k < path.length; k++) length += Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]);
  return { ok: true, path, length, goal, start };
}
