// 임시 장면 (CP-01 기술 시험·CP-02 연결용). web/config/layout.json의 치수를 그대로 쓴다. 최종 Tripo 에셋으로 교체 예정 — 이름에 temp_.
import * as THREE from 'three';
import { markOccluder } from '../fx/rain.js';

const std = (color, roughness = 0.9, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });

export function buildTempScene(L) {
  const g = new THREE.Group();
  g.name = 'temp_scene';
  const rx = L.island.top_rx, rz = L.island.top_rz, depth = L.island.depth ?? 1.5;

  // 섬: 윗면(풀) + 옆·아래(흙, 아래로 좁아짐)
  const top = new THREE.Mesh(new THREE.CircleGeometry(1, 72).rotateX(-Math.PI / 2), std(0x55602a, 0.95));
  top.scale.set(rx, 1, rz);
  top.name = 'temp_island_top';
  top.receiveShadow = true;
  g.add(top);
  const side = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.55, depth, 72, 1, true), std(0x5a3220, 1, { side: THREE.DoubleSide }));
  side.scale.set(rx, 1, rz);
  side.position.y = -depth / 2 - 0.001;
  side.name = 'temp_island_side';
  g.add(side);
  const under = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.1, 48).rotateX(Math.PI), std(0x4a2a1b, 1));
  under.scale.set(rx, 1, rz);
  under.position.y = -depth - 0.55;
  g.add(under);
  markOccluder(top, 0);

  // 텐트 (A자 프리즘, 입구가 불 쪽)
  const [tx, , tz] = L.tent.center;
  const [fx, , fz] = L.fire.center;
  const hd = L.tent.half_depth ?? 0.78, hw = L.tent.half_width ?? 0.66, th = L.tent.height ?? 1.25;
  const tg = new THREE.BufferGeometry();
  const v = [[-hd, 0, -hw], [-hd, 0, hw], [-hd, th, 0], [hd, 0, -hw], [hd, 0, hw], [hd, th, 0]];
  const faces = [[0, 1, 2], [3, 5, 4], [0, 2, 5, 3], [1, 4, 5, 2]];
  const pos = [];
  for (const f of faces) {
    const tris = f.length === 3 ? [f] : [[f[0], f[1], f[2]], [f[0], f[2], f[3]]];
    for (const t of tris) for (const k of t) pos.push(...v[k]);
  }
  tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  tg.computeVertexNormals();
  const tent = new THREE.Mesh(tg, std(0xd8c7a6, 0.95, { side: THREE.DoubleSide }));
  tent.position.set(tx, 0, tz);
  // 로컬 +x(입구 축): 지정 각도(axis_yaw_deg, x축에서 +z 쪽) 또는 불 쪽
  tent.rotation.y = L.tent.axis_yaw_deg !== undefined ? -(L.tent.axis_yaw_deg * Math.PI) / 180 : -Math.atan2(fz - tz, fx - tx);
  tent.castShadow = tent.receiveShadow = true;
  tent.name = 'temp_tent';
  g.add(tent);
  markOccluder(tent, 1);

  // 통나무
  const [lx, ly, lz] = L.log.center;
  const log = new THREE.Mesh(new THREE.CylinderGeometry(L.log.radius, L.log.radius, L.log.length, 28).rotateZ(Math.PI / 2), std(0x5b3a22, 0.85));
  log.position.set(lx, ly, lz);
  const ax = Math.atan2(fx - L.character_approach[0], fz - L.character_approach[2]);   // 캐릭터 몸 방향(불 쪽) yaw
  log.rotation.y = L.log.yaw_deg !== undefined ? (L.log.yaw_deg * Math.PI) / 180 : ax;   // 원통 축(로컬 x) ⟂ 몸 방향 (v2: 저장된 휴식 자리 방향)
  log.castShadow = log.receiveShadow = true;
  log.name = 'temp_log';
  g.add(log);
  markOccluder(log, 1);

  // 돌 테두리 (돌 9개) + 임시 장작 (티피)
  const ring = new THREE.Group();
  const R = L.fire.ring_radius ?? 0.36, tube = L.fire.ring_tube ?? 0.07;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const st = new THREE.Mesh(new THREE.IcosahedronGeometry(tube * 1.15, 1), std(0x6f6862, 0.8));
    st.position.set(fx + Math.cos(a) * R, tube * 0.7, fz + Math.sin(a) * R);
    st.scale.set(1.25, 0.8, 1.0);
    st.rotation.y = a;
    st.castShadow = st.receiveShadow = true;
    ring.add(st);
  }
  ring.name = 'temp_fire_ring';
  g.add(ring);
  markOccluder(ring, 1);
  const wood = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.34, 7), std(0x3b2516, 0.9));
    w.position.set(fx + Math.cos(a) * 0.07, 0.12, fz + Math.sin(a) * 0.07);
    w.rotation.set(Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55);
    w.castShadow = true;
    wood.add(w);
  }
  wood.name = 'temp_firewood';
  g.add(wood);
  markOccluder(wood, 1);

  // 바위·풀
  for (const r of L.rocks ?? []) {
    const rad = r.radius ?? r.scale / 1.9;                      // v2 배치는 크기(scale) — 반지름 = scale / 1.9
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(rad / 1.2, 1), std(0x5f5555, 0.85));
    m.position.set(r.center[0], rad * 0.3, r.center[2]);
    m.scale.set(1.2, 0.7, 1.0);
    m.castShadow = m.receiveShadow = true;
    m.name = 'temp_rock';
    g.add(m);
    markOccluder(m, 1);
  }
  for (const [x, z] of [[-2.6, 0.4], [-1.2, 1.4], [1.0, 1.8], [2.6, 0.3], [0.6, -1.9], [-2.2, -0.9], [1.8, 1.5]]) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 5), std(0x6b7020, 0.9));
    m.position.set(x, 0.09, z);
    m.castShadow = true;
    g.add(m);
  }
  // 케이스 (임시 상자)
  if (L.guitar_case) {
    const [cx, , cz] = L.guitar_case.center ?? L.guitar_case.near;
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.62, 0.12), std(0x2a1a12, 0.6));
    c.position.set(cx, 0.31, cz);
    c.rotation.set(0, tent.rotation.y, 0.17);
    c.castShadow = c.receiveShadow = true;
    c.name = 'temp_case';
    g.add(c);
    markOccluder(c, 1);
  }
  return g;
}
