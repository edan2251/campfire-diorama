// 배치 데이터(web/config/layout.json v2, three.js 좌표·단위 H) → 이동 영역 장애물·통나무 휴식 기준·발자국 (F02·F04·F12).
// 옛 형식(v1)을 받으면 layout_model.migrate로 같은 배치의 v2로 읽는다.
import { ellipsePolygon } from './navgrid.js';
import { migrate, VERSION, REST, FIRE, logFromRest } from './layout_model.js';

const DEG = Math.PI / 180;
const v2 = (L) => (L.version === VERSION ? L : migrate(L));
const xz = (v) => [v[0], v[2]];

/** 통나무 휴식 기준: 접근 위치(루트)와 앉았을 때 몸 방향. yaw 0 = +z, 앞 = (sin, cos) */
export function restFromLayout(L) {
  L = v2(L);
  const [ax, az] = xz(L.character_approach);
  return { approach: [ax, az], yaw: L.rest_yaw_deg * DEG, dy: L.rest_dy ?? 0 };
}

/**
 * 실제 발자국 (여유 없음). 배치 검사·카메라 충돌의 기준. navgrid 장애물은 여기에 작은 여유를 더함.
 * 반환 [{id, type:'circle', x, z, r} | {id, type:'rect', x, z, hw, hd, yaw}] — rect yaw: x축 기준 반시계(축 = (cos, sin))
 */
export function footprintsFromLayout(L) {
  L = v2(L);
  const out = [];
  const [fx, fz] = xz(L.fire.center);
  out.push({ id: 'fire', type: 'circle', x: fx, z: fz, r: FIRE.ringRadius + FIRE.ringTube });
  const lg = logFromRest(L);
  out.push({ id: 'log', type: 'rect', x: lg.x, z: lg.z, hw: REST.logLength / 2, hd: REST.logRadius, yaw: -lg.yaw });
  const ts = L.tent.scale ?? 1;
  const [tx, tz] = xz(L.tent.center);
  out.push({ id: 'tent', type: 'rect', x: tx, z: tz, hw: (L.tent.half_depth ?? 0.64) * ts, hd: (L.tent.half_width ?? 0.73) * ts, yaw: (L.tent.axis_yaw_deg ?? 0) * DEG });
  if (L.guitar_case) { const [x, z] = xz(L.guitar_case.center); out.push({ id: 'guitar_case', type: 'circle', x, z, r: (L.guitar_case.radius ?? 0.2) * (L.guitar_case.scale ?? 1) }); }
  if (L.guitar) { const [x, z] = xz(L.guitar.center); out.push({ id: 'guitar', type: 'circle', x, z, r: L.guitar.radius ?? 0.14 }); }
  for (const r of L.rocks ?? []) out.push({ id: r.id, type: 'circle', x: r.center[0], z: r.center[2], r: r.scale / 1.9 });
  return out;
}

/** 장애물 (navgrid 형식). 여유는 navgrid의 agentRadius가 따로 더함 — 여기서는 발자국 + 0.01~0.02 */
export function obstaclesFromLayout(L) {
  return footprintsFromLayout(L).map((o) => (o.type === 'circle' ? { ...o, r: o.r + 0.02 } : { ...o, hw: o.hw + 0.02, hd: o.hd + 0.01 }));
}

export function outlineFromLayout(L, n = 72) {
  return ellipsePolygon(L.island.top_rx, L.island.top_rz, n);
}

/** 통나무 클릭 영역: 보이는 원통보다 넉넉하게 (반지름 +0.12H, 길이 +0.2H) — 렌더 쪽 보이지 않는 원통 크기 */
export function logHitVolume(L) {
  L = v2(L);
  const lg = logFromRest(L);
  return { center: [lg.x, REST.logRadius, lg.z], radius: REST.logRadius + 0.12, length: REST.logLength + 0.2, axisYaw: -lg.yaw, yaw: lg.yaw };
}
