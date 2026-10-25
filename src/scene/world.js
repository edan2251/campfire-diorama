// 최종 에셋 장면 (CP-03 → CP-08): 사용자 생성 Tripo 소품 8종 + 재사용 기타를 배치 데이터(layout.json v2)대로 놓는다.
// 소품 웹본은 blender/scripts/prep_props.py · export_guitar_web.py가 만든 web/assets/props/*.glb (H 단위, 바닥 중심 원점).
// 편집 단위(F12)마다 그룹 하나(userData.unitId) → apply(L)로 위치·방향·크기·높이를 다시 맞춤 (모델을 새로 만들지 않음).
// 축: 텐트 입구 = 로컬 +X, 통나무 축 = 로컬 +X, 기타·케이스 앞면 = 로컬 +Z. 높이는 섬 높이 지도(terrain) + 높이 보정(dy).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { markOccluder } from '../fx/rain.js';
import { getUnit, unitsOf, REST } from '../logic/layout_model.js';

export const PROP_NAMES = ['island', 'tent', 'log', 'firewood', 'stone_ring', 'guitar_case', 'guitar', 'rock', 'grass'];

/** 소품 불러오기. 실패한 것은 빼고 이름을 돌려줌 (조용히 다른 것으로 바꾸지 않음, W-23) */
export async function loadProps(base = 'assets/props/') {
  const loader = new GLTFLoader();
  const props = {}, failed = [];
  await Promise.all(PROP_NAMES.map(async (n) => {
    try {
      const g = await loader.loadAsync(`${base}${n}.glb`);
      // 그림자는 앞면으로 그림 (2026-10-25): 기본(뒷면)은 물체를 땅에 묻으면 빛이 빠져나가는 뒷면이 땅과 거의 같은 깊이라 밑동에 밝은 틈이 생겼음
      g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.material.shadowSide = THREE.FrontSide; } });
      props[n] = g.scene;
    } catch (e) { failed.push({ name: `${n}.glb`, error: e?.message ?? String(e) }); }
  }));
  return { props, failed };
}

/**
 * props: loadProps().props (일부 없을 수 있음), L: 배치 v2, terrain: 높이 지도
 * 반환 { group, units: Map(id → 그룹), apply(L), unitOf(object) }
 */
export function buildWorld(props, L, terrain) {
  const g = new THREE.Group();
  g.name = 'world';
  const units = new Map();
  const unit = (id, name) => { const u = new THREE.Group(); u.name = name; u.userData.unitId = id; g.add(u); units.set(id, u); return u; };
  const add = (parent, src, name, rainClass = 1) => {
    if (!src) return null;
    const o = src.clone();
    o.name = name;
    parent.add(o);
    markOccluder(o, rainClass);
    return o;
  };

  if (props.island) {
    const island = props.island.clone();
    island.name = 'island';
    island.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.name = 'island_mesh'; } });
    g.add(island);
    markOccluder(island, 0);
  }
  // 통나무 휴식 자리: 그룹 원점 = 접근 위치(엉덩이 아래 루트), 통나무는 로컬 (옆 +0.5, 뒤 0.42)
  // 통나무는 중심(지름 가운데)을 축으로 기울이고 올림 (log_tilt_deg·log_dy) — 캐릭터 루트는 지면 그대로
  const rest = unit('rest', 'rest');
  const logPivot = new THREE.Group();
  logPivot.name = 'log_pivot';
  logPivot.position.set(REST.logSide, REST.logRadius, -REST.logBack);
  rest.add(logPivot);
  const log = add(logPivot, props.log, 'log');
  if (log) log.position.set(0, -REST.logRadius, 0);
  // 모닥불: 장작 + 돌 테두리 (불꽃·불티·연기·광원은 fx/fire.js 그룹 — main이 같은 자리로 옮김)
  const fire = unit('fire', 'fire_unit');
  const ring = add(fire, props.stone_ring, 'stone_ring');
  if (ring) ring.rotation.y = 0.3;
  const wood = add(fire, props.firewood, 'firewood');
  if (wood) wood.rotation.y = 0.8;
  add(unit('tent', 'tent_unit'), props.tent, 'tent');
  // 기타·케이스: 기대어 선 기울기는 안쪽 그룹, 방향은 단위 그룹
  const lean = (u, src, name) => { if (!src) return; const h = new THREE.Group(); h.name = `${name}_lean`; u.add(h); add(h, src, name); };
  lean(unit('guitar_case', 'guitar_case_unit'), props.guitar_case, 'guitar_case');
  lean(unit('guitar', 'guitar_unit'), props.guitar, 'guitar');
  for (const rk of L.rocks) add(unit(rk.id, `${rk.id}_unit`), props.rock, rk.id);
  for (const gr of L.grass) add(unit(gr.id, `${gr.id}_unit`), props.grass, gr.id, 0);

  function apply(L2) {
    for (const { id } of unitsOf(L2)) {
      const u = units.get(id);
      if (!u) continue;
      const t = getUnit(L2, id);
      const base = terrain.height(t.x, t.z);
      if (id === 'rest') {                                    // 휴식 자리 그룹 = 캐릭터 기준(지면·방향만), 기울기·높이는 통나무만
        u.position.set(t.x, base + (L2.rest_dy ?? 0), t.z);
        u.rotation.set(0, t.yaw, 0);
        logPivot.position.y = REST.logRadius + t.dy;
        logPivot.rotation.set(t.rx, 0, t.rz, 'YXZ');
        continue;
      }
      u.position.set(t.x, base + t.dy, t.z);
      u.rotation.set(t.rx, t.yaw, t.rz, 'YXZ');   // 3축 (v3, 순서 YXZ: 방향 → 앞뒤 → 옆)
      u.scale.setScalar(t.scale);
      if (id === 'guitar' || id === 'guitar_case') {
        const h = u.children[0];
        if (h) h.children[0].rotation.x = -((L2[id].lean_deg ?? 0) * Math.PI) / 180;
      }
    }
  }
  apply(L);

  /** 장면 물체 → 편집 단위 ID (없으면 null) */
  function unitOf(obj) {
    for (let o = obj; o; o = o.parent) if (o.userData && o.userData.unitId) return o.userData.unitId;
    return null;
  }
  /** 편집 기즈모가 붙을 자리: 휴식 자리 = 통나무 중심, 나머지 = 단위 원점(모델 바닥 가운데) */
  const pivotOf = (id) => (id === 'rest' ? logPivot : units.get(id));
  return { group: g, units, apply, unitOf, pivotOf };
}
