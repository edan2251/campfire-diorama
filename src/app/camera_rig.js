// 궤도 카메라 (F08·F12). 사용자 값(store.settings.camera: azimuth·elevation·distance·target·lens)을 목표로 부드럽게 따라감.
// 범위: 고도 0–70°(0° = 지면과 수평, CP-08), 거리 3.5–16H, 타깃은 섬 둘레 상자 안. 70° 상한이라 화면이 뒤집히지 않음.
// 카메라 위치가 섬 윗면 + 0.12H 아래로 내려가면 그만큼만 위로 (타깃이 낮을 때만 해당 — 기본 타깃 높이 0.3에서는 0°까지 그대로).
// 거리(돌리 = 카메라 위치)와 렌즈(줌 = 화각)는 다른 값. 렌즈 → 화각은 가상 센서 세로 24 mm 기준.
import * as THREE from 'three';
import { lensToFov } from '../render/post.js';

const DEG = Math.PI / 180;
const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
export const TARGET_BOX = { min: [-3.5, 0, -3], max: [3.5, 2.5, 3] };

// colliders: [{ type:'circle', x, z, r, h } | { type:'rect', x, z, hw, hd, yaw, h }] — 카메라가 소품(텐트·통나무·바위 등) 안으로 들어가지 않게 (D-09)
function insideAny(p, colliders, margin = 0.18) {
  for (const o of colliders) {
    if (p.y > (o.h ?? 1) + margin) continue;
    let d;
    if (o.type === 'circle') d = Math.hypot(p.x - o.x, p.z - o.z) - o.r;
    else {
      const c = Math.cos(-o.yaw), s = Math.sin(-o.yaw);
      const lx = (p.x - o.x) * c - (p.z - o.z) * s, lz = (p.x - o.x) * s + (p.z - o.z) * c;
      const qx = Math.abs(lx) - o.hw, qz = Math.abs(lz) - o.hd;
      d = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
    }
    if (d < margin) return true;
  }
  return false;
}

/** ground(x, z): 섬 윗면 높이 또는 null(섬 밖). 없으면 지면 검사 생략 */
export function createCameraRig(camera, store, { tau = 0.12, ground = null } = {}) {
  let colliders = [];
  const c0 = store.settings.camera;
  const cur = { azimuth: c0.azimuth, elevation: c0.elevation, distance: c0.distance, target: new THREE.Vector3(...c0.target), lens: c0.lens };
  let lastLift = 0;
  let side = null;               // 소품 안에 들어갔을 때 고른 쪽: 'pull'(타깃 쪽 앞면) | 'push'(바깥 뒷면) — 안에 있는 동안 유지(떨림·튐 방지)
  const probe = new THREE.Vector3();

  function place() {
    const az = cur.azimuth * DEG, el = cur.elevation * DEG, t = cur.target;
    // 세로로 긴 화면(모바일 세로)에서는 가로 화각이 좁아 섬이 잘림 → 실제 거리만 늘림 (사용자 거리 값은 그대로). 16:10 기준 가로의 60%가 보이게
    let d = cur.distance * Math.max(1, 0.96 / Math.max(0.2, camera.aspect));
    const dir = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
    const at = (dd) => camera.position.set(t.x + dd * dir[0], t.y + dd * dir[1], t.z + dd * dir[2]);
    const blocked = (dd) => insideAny(probe.set(t.x + dd * dir[0], t.y + dd * dir[1], t.z + dd * dir[2]), colliders);
    // 소품 안이면 같은 시선 위에서 가장 가까운 바깥 자리로: 들어온 쪽(앞면=타깃 쪽 또는 뒷면)을 안에 있는 동안 유지 → 지나갈 때 한 번에 크게 튀지 않음 (CP-08)
    if (colliders.length && blocked(d)) {
      let d1 = d, d2 = d;
      while (d1 > 0 && blocked(d1)) d1 -= 0.03;
      while (d2 < d + 6 && blocked(d2)) d2 += 0.03;
      const canPull = d1 > 0.8;
      if (!side) side = canPull && d - d1 <= d2 - d ? 'pull' : 'push';
      if (side === 'pull' && !canPull) side = 'push';
      d = side === 'pull' ? d1 : d2;
    } else side = null;
    at(d);
    // 지면 아래 금지: 섬 윗면 + 0.12H (위치만 올림 — 같은 타깃을 보므로 살짝 내려다봄)
    lastLift = 0;
    const gh = ground ? ground(camera.position.x, camera.position.z) : null;
    if (gh !== null && gh !== undefined && camera.position.y < gh + 0.12) { lastLift = gh + 0.12 - camera.position.y; camera.position.y = gh + 0.12; }
    camera.up.set(0, 1, 0);
    camera.lookAt(t);
    const fov = lensToFov(cur.lens);
    if (Math.abs(camera.fov - fov) > 1e-4) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }
  place();

  const right = new THREE.Vector3(), up = new THREE.Vector3();
  const api = {
    get current() { return cur; },
    get lastLift() { return lastLift; },
    setColliders(list) { colliders = list || []; },
    /** 드래그(px): 가로 = 방위, 세로 = 고도. 감도는 화면 높이 기준 */
    rotateBy(dx, dy, viewH) {
      const k = 180 / Math.max(300, viewH);
      const c = store.settings.camera;
      store.set('camera.azimuth', wrap180(c.azimuth - dx * k), { save: false });
      store.set('camera.elevation', c.elevation + dy * k * 0.7, { save: false });
    },
    /** 평행 이동(px): 화면을 잡아 끄는 느낌 — 타깃(과 카메라)이 화면 오른쪽·위 방향으로 함께 이동. 방향·거리·렌즈는 그대로 */
    panBy(dx, dy, viewH) {
      const c = store.settings.camera;
      const dist = camera.position.distanceTo(cur.target);
      const perPx = (2 * dist * Math.tan((camera.fov * DEG) / 2)) / Math.max(1, viewH);   // 타깃 깊이에서 화면 1px = 몇 H
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      up.setFromMatrixColumn(camera.matrixWorld, 1);
      const t = new THREE.Vector3(...c.target).addScaledVector(right, -dx * perPx).addScaledVector(up, dy * perPx);
      const v = t.toArray().map((x, i) => Math.min(TARGET_BOX.max[i], Math.max(TARGET_BOX.min[i], x)));
      store.set('camera.target', v, { save: false });
      cur.target.set(...v);             // 평행 이동은 바로 따라감 (부드럽게 따라가면 커서와 어긋남)
    },
    /** factor > 1 이면 멀어짐 (휠·핀치) */
    zoomBy(factor) {
      store.set('camera.distance', store.settings.camera.distance * factor, { save: false });
    },
    commit() { store.save(); },
    /** 바로 맞춤 (초기화·프리셋·시점 불러오기 직후 튐 대신 즉시 이동이 필요할 때) */
    snap() {
      const c = store.settings.camera;
      Object.assign(cur, { azimuth: c.azimuth, elevation: c.elevation, distance: c.distance, lens: c.lens });
      cur.target.set(...c.target);
      place();
    },
    update(realDt) {
      const c = store.settings.camera;
      const k = 1 - Math.exp(-Math.max(0, realDt) / tau);      // 실제 시간 기준 (일시 정지 중에도 카메라는 움직임)
      cur.azimuth = wrap180(cur.azimuth + wrap180(c.azimuth - cur.azimuth) * k);
      cur.elevation += (c.elevation - cur.elevation) * k;
      cur.distance += (c.distance - cur.distance) * k;
      cur.lens += (c.lens - cur.lens) * k;
      cur.target.lerp(new THREE.Vector3(...c.target), k);
      place();
    },
  };
  return api;
}
