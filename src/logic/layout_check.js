// 배치 검사 (F12 3-4, W-21). three.js 없이 테스트 가능. 저장·동작 테스트 전에 실행.
// 오류(errors) = 저장·테스트를 막는 이동·착석 문제, 주의(warnings) = 저장 가능하지만 표시, 접촉(contacts) = 의도한 접촉.
// 어떤 문제도 개체를 다른 자리로 옮기지 않는다 — 위치와 이유만 돌려줌.
import { buildNavGrid, nearestFree, obstacleDistance } from './navgrid.js';
import { migrate, VERSION, REST, FIRE, MAJOR, UNIT_RULES, restLocalToWorld } from './layout_model.js';
import { footprintsFromLayout, obstaclesFromLayout, outlineFromLayout } from './layout.js';

const DEG = Math.PI / 180;
// 의도한 접촉: 기타는 케이스·텐트에 기대어 서 있을 수 있음 (겹침 깊이 0.12H까지)
const INTENDED = [['guitar', 'guitar_case', 0.12], ['guitar', 'tent', 0.12]];
const NAME = (id) => UNIT_RULES[id]?.name ?? (id === 'log' ? '통나무' : /^rock/.test(id) ? `바위 ${+id.slice(4) + 1}` : /^grass/.test(id) ? `풀 ${+id.slice(5) + 1}` : id);

const insideEllipse = (L, x, z, shrink = 0) => (x / (L.island.top_rx - shrink)) ** 2 + (z / (L.island.top_rz - shrink)) ** 2 <= 1;

/** 발자국 둘레 점 (원 12점, 사각형 모서리·변 중간) */
function rim(o) {
  if (o.type === 'circle') return Array.from({ length: 12 }, (_, k) => [o.x + o.r * Math.cos((k / 12) * 2 * Math.PI), o.z + o.r * Math.sin((k / 12) * 2 * Math.PI)]);
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  const pts = [];
  for (const [u, v] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]) pts.push([o.x + u * o.hw * c - v * o.hd * s, o.z + u * o.hw * s + v * o.hd * c]);
  return pts;
}
/** 발자국 안쪽 점 격자 (겹침 깊이 계산용) */
function fill(o, n = 7) {
  if (o.type === 'circle') {
    const pts = [[o.x, o.z]];
    for (let ring = 1; ring <= 3; ring++) for (let k = 0; k < 12; k++) { const a = (k / 12) * 2 * Math.PI, rr = (o.r * ring) / 3; pts.push([o.x + rr * Math.cos(a), o.z + rr * Math.sin(a)]); }
    return pts;
  }
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw), pts = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const u = -1 + (2 * i) / (n - 1), v = -1 + (2 * j) / (n - 1);
    pts.push([o.x + u * o.hw * c - v * o.hd * s, o.z + u * o.hw * s + v * o.hd * c]);
  }
  return pts;
}
/** 두 발자국 겹침 깊이 (≤ 0이면 떨어짐) */
function overlapDepth(a, b) {
  if (a.type === 'circle' && b.type === 'circle') return a.r + b.r - Math.hypot(a.x - b.x, a.z - b.z);
  let worst = -Infinity;
  for (const p of fill(a)) worst = Math.max(worst, -obstacleDistance(p[0], p[1], b));
  for (const p of fill(b)) worst = Math.max(worst, -obstacleDistance(p[0], p[1], a));
  return worst;
}

/**
 * L: layout(v1·v2), opts.terrain: { height(x, z) } (없으면 지면 차 검사 생략)
 * 반환 { ok, errors[], warnings[], contacts[], stats } — 항목 { id, code, msg, at:[x,z] }
 */
export function checkLayout(L0, { terrain = null } = {}) {
  const L = L0.version === VERSION ? L0 : migrate(L0);
  const errors = [], warnings = [], contacts = [];
  const err = (id, code, msg, at) => errors.push({ id, code, msg, at: at.map((v) => +v.toFixed(2)) });
  const warn = (id, code, msg, at) => warnings.push({ id, code, msg, at: at.map((v) => +v.toFixed(2)) });
  const fps = footprintsFromLayout(L);
  const unitOf = (fid) => (fid === 'log' ? 'rest' : fid);

  // 1. 섬 밖
  const centers = [['rest', L.character_approach], ['fire', L.fire.center], ['tent', L.tent.center], ['guitar', L.guitar.center], ['guitar_case', L.guitar_case.center],
    ...L.rocks.map((r) => [r.id, r.center]), ...L.grass.map((g) => [g.id, g.center])];
  for (const [id, c] of centers) {
    if (!insideEllipse(L, c[0], c[2])) (MAJOR.includes(id) ? err : warn)(id, 'outside-island', `${NAME(id)}: 중심이 섬 밖`, [c[0], c[2]]);
  }
  for (const o of fps) {
    const out = rim(o).filter(([x, z]) => !insideEllipse(L, x, z));
    if (out.length && insideEllipse(L, o.x, o.z)) warn(unitOf(o.id), 'edge-overhang', `${NAME(o.id)}: 발자국 일부가 섬 가장자리 밖`, out[0]);
  }

  // 2. 겹침 (의도한 접촉 구분)
  for (let i = 0; i < fps.length; i++) for (let j = i + 1; j < fps.length; j++) {
    const a = fps[i], b = fps[j];
    const d = overlapDepth(a, b);
    if (d <= 0.02) continue;
    const pair = INTENDED.find(([p, q]) => (p === a.id && q === b.id) || (p === b.id && q === a.id));
    const at = [(a.x + b.x) / 2, (a.z + b.z) / 2];
    if (pair && d <= pair[2]) contacts.push({ id: `${a.id}+${b.id}`, code: 'intended-contact', msg: `${NAME(a.id)}↔${NAME(b.id)}: 의도한 접촉 (겹침 ${d.toFixed(2)}H)`, at: at.map((v) => +v.toFixed(2)) });
    else warn(unitOf(a.id), 'overlap', `${NAME(a.id)}와 ${NAME(b.id)}가 겹침 (깊이 ${d.toFixed(2)}H)`, at);
  }

  // 3. 이동 영역: 접근 위치 → 걸을 수 있는 영역 연결
  const grid = buildNavGrid({ outline: outlineFromLayout(L), obstacles: obstaclesFromLayout(L) });
  const [ax, , az] = L.character_approach;
  const stats = {};
  const start = nearestFree(grid, ax, az, 0.12);
  let totalFree = 0;
  for (let k = 0; k < grid.free.length; k++) totalFree += grid.free[k];
  if (!start) err('rest', 'approach-blocked', '통나무 휴식 자리: 접근 위치가 이동 영역 밖이거나 막힘', [ax, az]);
  else {
    const seen = new Uint8Array(grid.free.length);
    const [si, sj] = grid.toCell(...start);
    const stack = [sj * grid.nx + si];
    seen[stack[0]] = 1;
    let reach = 0;
    while (stack.length) {
      const c = stack.pop(); reach++;
      const ci = c % grid.nx, cj = (c - ci) / grid.nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ci + di, nj = cj + dj;
        if (!grid.isFree(ni, nj)) continue;
        const n = nj * grid.nx + ni;
        if (!seen[n]) { seen[n] = 1; stack.push(n); }
      }
    }
    stats.reachableShare = +(reach / Math.max(1, totalFree)).toFixed(3);
    if (stats.reachableShare < 0.3) err('rest', 'approach-unreachable', '통나무 휴식 자리: 섬의 열린 땅에서 접근 위치까지 갈 수 없음', [ax, az]);
    else if (stats.reachableShare < 0.9) {
      let cx = 0, cz = 0, n = 0;
      for (let k = 0; k < grid.free.length; k++) if (grid.free[k] && !seen[k]) { const [x, z] = grid.toWorld(k % grid.nx, Math.floor(k / grid.nx)); cx += x; cz += z; n++; }
      warn('nav', 'isolated-area', `걸을 수 있는 땅의 ${Math.round((1 - stats.reachableShare) * 100)}%가 막혀 갈 수 없음`, [cx / n, cz / n]);
    }
  }
  stats.walkableCells = totalFree;

  // 4. 착석·기립 공간 (통나무 앞면 ~ 발끝, 옆 ±0.35) — 다른 소품·섬 밖이면 오류
  const spacePts = [];
  for (let i = 0; i <= 6; i++) for (let j = 0; j <= 4; j++) spacePts.push(restLocalToWorld(L, REST.space.x[0] + (i / 6) * (REST.space.x[1] - REST.space.x[0]), REST.space.z[0] + (j / 4) * (REST.space.z[1] - REST.space.z[0])));
  const blockers = new Map();
  for (const p of spacePts) {
    if (!insideEllipse(L, p[0], p[1])) { blockers.set('island-edge', p); continue; }
    for (const o of fps) if (o.id !== 'log' && obstacleDistance(p[0], p[1], o) < 0) blockers.set(o.id, p);
  }
  for (const [id, p] of blockers) err('rest', 'sit-space-blocked', id === 'island-edge' ? '착석 공간이 섬 가장자리 밖으로 나감' : `착석·기립 공간에 ${NAME(id)}`, p);

  // 5. 발끝 ↔ 돌 테두리·불꽃 (엉덩이~발끝 선분에서 가장 가까운 점)
  const hip = restLocalToWorld(L, REST.hip[0], REST.hip[1]);
  const feet = restLocalToWorld(L, 0, REST.feet);
  const [fx, , fz] = L.fire.center;
  const segDist = (() => { const dx = feet[0] - hip[0], dz = feet[1] - hip[1]; const t = Math.max(0, Math.min(1, ((fx - hip[0]) * dx + (fz - hip[1]) * dz) / (dx * dx + dz * dz))); return Math.hypot(fx - (hip[0] + t * dx), fz - (hip[1] + t * dz)); })();
  stats.feetToRing = +(segDist - (FIRE.ringRadius + FIRE.ringTube)).toFixed(3);
  stats.feetToFlame = +(segDist - FIRE.flameZone).toFixed(3);
  if (stats.feetToRing < 0) err('fire', 'feet-in-fire', `발이 돌 테두리 안 (${stats.feetToRing.toFixed(2)}H)`, feet);
  else if (stats.feetToFlame < 0.3) warn('fire', 'feet-near-flame', `발끝과 불꽃 범위가 가까움 (${stats.feetToFlame.toFixed(2)}H, 권장 0.30 이상)`, feet);
  const toFire = Math.atan2(fx - L.character_approach[0], fz - L.character_approach[2]);
  stats.facingOffDeg = +Math.abs((((toFire - L.rest_yaw_deg * DEG) / DEG + 540) % 360) - 180).toFixed(1);
  if (stats.facingOffDeg > 70) warn('rest', 'not-facing-fire', `캐릭터가 모닥불을 ${Math.round(stats.facingOffDeg)}° 비껴 앉음`, [ax, az]);

  // 5b. 통나무 기울기·높이(v3): 캐릭터는 지면에 그대로 → 등 접촉점과 통나무 표면 사이가 처음(기울기 0) 대비 얼마나 바뀌었는지
  //     현재 착석 애니메이션은 기울지 않은 통나무 기준이라 차이가 크면 '휴식 위치 보정 필요' (편집 내용은 그대로 둠)
  {
    const [tx, tz] = (L.log_tilt_deg ?? [0, 0]).map((d) => d * DEG);
    const ldy = L.log_dy ?? 0;
    const axis = [Math.cos(tz), Math.sin(tz) * Math.cos(tx), Math.sin(tz) * Math.sin(tx)];   // 로컬 X축을 Rx·Rz로 (순서 YXZ의 로컬 부분)
    const C = [REST.logSide, REST.logRadius + ldy, -REST.logBack];
    const B = [REST.back[0], REST.back[2], REST.back[1]];
    const gapAt = (c, a) => { const v = [B[0] - c[0], B[1] - c[1], B[2] - c[2]]; const t = v[0] * a[0] + v[1] * a[1] + v[2] * a[2]; return Math.hypot(v[0] - t * a[0], v[1] - t * a[1], v[2] - t * a[2]) - REST.logRadius; };
    const g0 = gapAt([REST.logSide, REST.logRadius, -REST.logBack], [1, 0, 0]);
    const dGap = gapAt(C, axis) - g0;
    stats.backGapChange = +dGap.toFixed(3);
    stats.logTiltDeg = (L.log_tilt_deg ?? [0, 0]).slice();
    const bw = restLocalToWorld(L, B[0], B[2]);
    if (dGap > 0.025) err('rest', 'rest-needs-fix', `휴식 위치 보정 필요: 통나무를 기울이거나 올려 등과 통나무 사이가 ${(dGap * 15).toFixed(1)}cm(${dGap.toFixed(3)}H) 벌어짐 — 앉으면 등이 뜸`, bw);
    else if (dGap < -0.02) err('rest', 'rest-needs-fix', `휴식 위치 보정 필요: 통나무가 등 쪽으로 ${(-dGap * 15).toFixed(1)}cm(${(-dGap).toFixed(3)}H) 파고듦 — 앉으면 몸이 통나무를 뚫음`, bw);
    if (terrain) {
      const h0 = terrain.height(L.character_approach[0], L.character_approach[2]);
      for (const sgn of [-1, 1]) {
        const e = [C[0] + axis[0] * sgn * REST.logLength / 2, C[1] + axis[1] * sgn * REST.logLength / 2, C[2] + axis[2] * sgn * REST.logLength / 2];
        const w = restLocalToWorld(L, e[0], e[2]);
        const under = h0 + e[1] - REST.logRadius - terrain.height(...w);
        if (under > 0.06) warn('rest', 'log-floating', `통나무 끝이 ${under.toFixed(2)}H 떠 있음 ('바닥에 맞추기'로 조절)`, w);
        else if (under < -0.12) warn('rest', 'log-buried', `통나무 끝이 땅에 ${(-under).toFixed(2)}H 묻힘`, w);
      }
    }
  }

  // 6. 지면 차: 휴식 자리(엉덩이·발 = 오류, 통나무 끝 = 주의), 소품 바닥 (주의)
  if (terrain) {
    const h0 = terrain.height(ax, az);
    const stepHip = Math.max(Math.abs(terrain.height(...hip) - h0), Math.abs(terrain.height(...feet) - h0));
    stats.restGroundStep = +stepHip.toFixed(3);
    if (stepHip > 0.05) err('rest', 'rest-ground-step', `휴식 자리 지면이 기울어 엉덩이·발이 뜨거나 묻힘 (${stepHip.toFixed(2)}H)`, hip);
    for (const sx of [-1, 1]) {
      const p = restLocalToWorld(L, REST.logSide + sx * REST.logLength / 2, -REST.logBack);
      const dh = terrain.height(...p) - h0;
      if (Math.abs(dh) > 0.06) warn('rest', 'log-ground-gap', `통나무 끝이 ${dh > 0 ? '땅에 묻힘' : '떠 있음'} (${Math.abs(dh).toFixed(2)}H)`, p);
    }
    for (const o of fps) {
      if (o.id === 'log') continue;
      const hc = terrain.height(o.x, o.z);
      let worst = 0, at = [o.x, o.z];
      for (const p of rim(o)) { const d = terrain.height(...p) - hc; if (Math.abs(d) > Math.abs(worst)) { worst = d; at = p; } }
      if (Math.abs(worst) > 0.06) warn(unitOf(o.id), 'ground-gap', `${NAME(o.id)}: 바닥 한쪽이 ${worst > 0 ? '묻힘' : '뜸'} (${Math.abs(worst).toFixed(2)}H, 높이 보정으로 조절 가능)`, at);
    }
  }
  return { ok: errors.length === 0, errors, warnings, contacts, stats };
}
