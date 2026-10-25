// 배치 모델 (F12·F02): web/config/layout.json 형식 v3 읽기·변환·편집 단위·직렬화·실행 취소. three.js·DOM 없이 테스트 가능.
// v3 (2026-10-24): 3축 회전 = 기존 방향(yaw, Y축) + tilt_deg [X, Z], 회전 순서 YXZ(rotation_order) — v2 파일은 기울기 0으로 그대로 읽음.
//   통나무 휴식 자리는 캐릭터(접근 위치·몸 방향, 지면 위)와 통나무 자체 기울기·높이(log_tilt_deg, log_dy)를 나눠 저장.
// 파일은 하나(W-16). 옛 형식(v1, 버전 없음)은 같은 배치의 v2로 바꿔 읽는다 — 이전 코드에 있던 값(풀 9개, 바위·풀 회전 난수, 기타 위치 계산)을 파일로 옮김.
// 좌표: three.js (x, z), 단위 H. 개체 회전 yaw = 오브젝트 rotation.y (라디안, 로컬 +Z가 (sin, cos)를 향함). 파일에는 도(°)로.

export const VERSION = 3;
export const ROT_ORDER = 'YXZ';
const DEG = Math.PI / 180;
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const r2 = (v) => Math.round(v * 100) / 100;
const clone = (v) => JSON.parse(JSON.stringify(v));
const wrapDeg = (d) => { const v = ((d + 180) % 360 + 360) % 360 - 180; return v === -180 ? 180 : v; };

// 통나무 휴식 자리(W-17): 착석 자세(blender/scripts/ground_sit.py, web/config/rest_anchor.json)를 캐릭터 로컬로 옮긴 값.
// 로컬 +Z = 몸 앞(불 쪽), +X = 옆. 통나무 중심 = 옆 +0.5, 뒤 0.42 (통나무 축 = 로컬 X)
export const REST = {
  logSide: 0.5, logBack: 0.42, logRadius: 0.19, logLength: 2.0,
  hip: [0.002, -0.1193],            // 엉덩이 지면점 (로컬 x, z)
  back: [0.0, -0.2209, 0.2366],     // 등 접촉점 (x, z, 높이)
  feet: 0.1556,                     // 발끝 앞 거리
  space: { x: [-0.35, 0.35], z: [-0.23, 0.206] },   // 착석·기립 공간 (통나무 앞면 ~ 발끝)
};
export const FIRE = { ringRadius: 0.36, ringTube: 0.07, flameZone: 0.13 };

// 편집 단위 정의: 크기 범위(없으면 잠김), 높이 보정 한계
export const UNIT_RULES = {
  // dy = 지면 위 높이(자유 이동 Y). 통나무 휴식 자리의 dy는 통나무만(log_dy), 캐릭터는 지면에 남음
  rest: { name: '통나무 휴식 자리', scale: null, dy: 0.2 },
  fire: { name: '모닥불', scale: null, dy: 0.6 },
  tent: { name: '텐트', scale: [0.8, 1.2], dy: 0.6 },
  guitar: { name: '기타', scale: null, dy: 0.6 },
  guitar_case: { name: '케이스', scale: [0.85, 1.15], dy: 0.6 },
  rock: { name: '바위', scale: [0.15, 0.9], dy: 0.6 },
  grass: { name: '풀', scale: [0.1, 0.5], dy: 0.6 },
};
export const ruleOf = (id) => UNIT_RULES[id] ?? UNIT_RULES[id.replace(/\d+$/, '')];
export const MAJOR = ['rest', 'fire', 'tent', 'guitar', 'guitar_case'];

// v1 코드에 있던 풀 위치·크기 (scene/world.js GRASS)
const V1_GRASS = [[-2.6, 0.4, 0.26], [-1.2, 1.4, 0.22], [1.0, 1.8, 0.24], [2.6, 0.3, 0.2], [0.6, -1.9, 0.22], [-2.2, -0.9, 0.25], [1.8, 1.5, 0.28], [-0.4, -1.95, 0.2], [2.3, -0.6, 0.22]];
function rand(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

/** 옛 형식 → v3 (같은 배치). v2는 기울기 0만 더함, 이미 v3면 그대로 복사 */
export function migrate(src) {
  const L = clone(src);
  if (L.version === VERSION) return L;
  if (L.version === 2) return toV3(L);
  const [ax, , az] = L.character_approach;
  const [fx, , fz] = L.fire.center;
  L.rest_yaw_deg = r2(Math.atan2(fx - ax, fz - az) / DEG);
  L.rest_dy = 0;
  L.fire.yaw_deg = 0; L.fire.dy = 0;
  L.tent.scale = 1; L.tent.dy = 0;
  // 기타·케이스: 이전 world.js 계산(텐트 입구 앞, 카메라 쪽 옆)을 실제 값으로
  const th = (L.tent.axis_yaw_deg ?? 0) * DEG;
  const a = [Math.cos(th), Math.sin(th)];
  let s = [-a[1], a[0]];
  if (s[1] < 0) s = [-s[0], -s[1]];
  const [gx, , gz] = L.guitar_case.center;
  const fl = Math.hypot(a[0] + s[0], a[1] + s[1]);
  const faceYaw = Math.atan2((a[0] + s[0]) / fl, (a[1] + s[1]) / fl);
  L.guitar_case = { center: [r4(gx - s[0] * 0.14), 0, r4(gz - s[1] * 0.14)], yaw_deg: r2(faceYaw / DEG), lean_deg: 6, scale: 1, dy: 0, radius: 0.2 };
  L.guitar = { center: [r4(gx + s[0] * 0.15), 0, r4(gz + s[1] * 0.15)], yaw_deg: r2(faceYaw / DEG), lean_deg: 12, dy: 0, radius: 0.14 };
  // 바위·풀 회전: 이전 world.js의 고정 난수(seed 11) 순서 그대로 (바위 먼저, 풀 다음)
  const rnd = rand(11);
  L.rocks = (L.rocks ?? []).map((rk, i) => ({ id: `rock${i}`, center: rk.center, yaw_deg: r2(wrapDeg((rnd() * 6.28) / DEG)), scale: r4(rk.radius * 1.9), dy: 0 }));
  L.grass = V1_GRASS.map(([x, z, sc], i) => ({ id: `grass${i}`, center: [x, 0, z], yaw_deg: r2(wrapDeg((rnd() * 6.28) / DEG)), scale: sc, dy: 0 }));
  L.version = 2;
  return toV3(L);
}
function toV3(L) {
  L.rotation_order = ROT_ORDER;
  for (const o of [L.fire, L.tent, L.guitar, L.guitar_case, ...L.rocks, ...L.grass]) o.tilt_deg = o.tilt_deg ?? [0, 0];
  L.log_tilt_deg = L.log_tilt_deg ?? [0, 0];
  L.log_dy = L.log_dy ?? 0;
  L.version = VERSION;
  syncDerived(L);
  return L;
}

/** 휴식 자리에서 파생되는 값(통나무 중심·방향)을 다시 계산 — 파일에도 써 두지만 원본은 접근 위치·몸 방향 */
export function syncDerived(L) {
  const lg = logFromRest(L);
  L.log = { ...L.log, center: [r4(lg.x), r4(REST.logRadius + (L.log_dy ?? 0)), r4(lg.z)], yaw_deg: r2(lg.yaw / DEG), tilt_deg: L.log_tilt_deg ?? [0, 0], radius: REST.logRadius, length: REST.logLength, axial_shift_local_x: REST.logSide };
  // 예전 파일에 있던 파생 수치(접근 위치·발끝 간격)는 휴식 자리·불을 옮기면 틀려지므로 지움 — 지금 값은 layout_check.js의 stats
  for (const k of ['fire_to_approach', 'feet_to_ring_gap', 'feet_to_flame_zone']) delete L.fire[k];
  delete L.character_yaw_deg_blender;
  return L;
}

/** 로컬 (x, z) → 월드 (휴식 자리 변환) */
export function restLocalToWorld(L, lx, lz) {
  const [ax, , az] = L.character_approach;
  const t = L.rest_yaw_deg * DEG;
  return [ax + lx * Math.cos(t) + lz * Math.sin(t), az - lx * Math.sin(t) + lz * Math.cos(t)];
}
export function logFromRest(L) {
  const [x, z] = restLocalToWorld(L, REST.logSide, -REST.logBack);
  return { x, z, yaw: L.rest_yaw_deg * DEG };
}

// ---------- 편집 단위 ----------
/** 단위 목록 [{id, kind, name}] — 화면 목록 순서 */
export function unitsOf(L) {
  const out = MAJOR.map((id) => ({ id, kind: id, name: UNIT_RULES[id].name }));
  for (const [i, rk] of L.rocks.entries()) out.push({ id: rk.id, kind: 'rock', name: `바위 ${i + 1}` });
  for (const [i, g] of L.grass.entries()) out.push({ id: g.id, kind: 'grass', name: `풀 ${i + 1}` });
  return out;
}

function ref(L, id) {
  if (id === 'rest') return null;
  if (id === 'fire' || id === 'tent' || id === 'guitar' || id === 'guitar_case') return L[id];
  return L.rocks.find((r) => r.id === id) ?? L.grass.find((g) => g.id === id) ?? undefined;
}

/** 단위 변환 {x, z, yaw(라디안 rotation.y), rx, rz(라디안, 순서 YXZ), scale, dy(지면 위 높이)}. 휴식 자리: rx·rz·dy = 통나무만 */
export function getUnit(L, id) {
  if (id === 'rest') { const [x, , z] = L.character_approach; const t = L.log_tilt_deg ?? [0, 0]; return { x, z, yaw: L.rest_yaw_deg * DEG, rx: t[0] * DEG, rz: t[1] * DEG, scale: 1, dy: L.log_dy ?? 0 }; }
  const o = ref(L, id);
  if (!o) return null;
  const [x, , z] = o.center;
  // 텐트 축 각도는 x축에서 +z 쪽(장애물 사각형 기준) = rotation.y의 반대 부호
  const yaw = id === 'tent' ? -(o.axis_yaw_deg ?? 0) * DEG : (o.yaw_deg ?? 0) * DEG;
  const t = o.tilt_deg ?? [0, 0];
  return { x, z, yaw, rx: t[0] * DEG, rz: t[1] * DEG, scale: o.scale ?? 1, dy: o.dy ?? 0 };
}


/** 단위 변환 적용 (잠긴 값·범위는 여기서 지킴). 바뀐 L을 돌려줌 (원본 변경) */
export function setUnit(L, id, t) {
  const rule = ruleOf(id);
  const cur = getUnit(L, id);
  if (!rule || !cur) return L;
  const v = { ...cur, ...t };
  const dy = Math.max(-rule.dy, Math.min(rule.dy, v.dy));
  const scale = rule.scale ? Math.max(rule.scale[0], Math.min(rule.scale[1], v.scale)) : 1;
  const yawDeg = r2(wrapDeg(v.yaw / DEG));
  if (id === 'rest') {
    L.character_approach = [r4(v.x), 0, r4(v.z)];
    L.rest_yaw_deg = yawDeg;
    L.log_dy = r4(dy);
    L.log_tilt_deg = [r2(wrapDeg(v.rx / DEG)), r2(wrapDeg(v.rz / DEG))];
    return syncDerived(L);
  }
  const o = ref(L, id);
  o.center = [r4(v.x), 0, r4(v.z)];
  if (id === 'tent') o.axis_yaw_deg = r2(wrapDeg(-yawDeg));
  else o.yaw_deg = yawDeg;
  if (rule.scale) o.scale = r4(scale);
  o.dy = r4(dy);
  o.tilt_deg = [r2(wrapDeg(v.rx / DEG)), r2(wrapDeg(v.rz / DEG))];
  return L;
}

// ---------- 읽기·검사·쓰기 ----------
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(isNum);

/** JSON 문자열·객체 → { ok, layout, errors[] }. 형식이 틀리거나 필수 개체가 없으면 ok=false (호출자는 기존 상태 유지) */
export function parseLayout(input) {
  let raw = input;
  if (typeof input === 'string') {
    try { raw = JSON.parse(input); } catch (e) { return { ok: false, errors: [`JSON 형식이 아님: ${e.message}`] }; }
  }
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['배치 객체가 아님'] };
  if (raw.version !== undefined && raw.version !== 2 && raw.version !== VERSION) errors.push(`지원하지 않는 형식 버전: ${raw.version}`);
  if (raw.version === VERSION && raw.rotation_order !== undefined && raw.rotation_order !== ROT_ORDER) errors.push(`지원하지 않는 회전 순서: ${raw.rotation_order}`);
  const need = [['island', (o) => o && isNum(o.top_rx) && isNum(o.top_rz)], ['fire', (o) => o && isVec3(o.center)], ['tent', (o) => o && isVec3(o.center)],
    ['guitar_case', (o) => o && isVec3(o.center)], ['log', (o) => o && isNum(o.radius)], ['character_approach', isVec3], ['rocks', Array.isArray]];
  for (const [k, ok] of need) if (!(k in raw)) errors.push(`필수 개체 없음: ${k}`); else if (!ok(raw[k])) errors.push(`값 형식이 틀림: ${k}`);
  if (raw.version >= 2) {
    if (!isNum(raw.rest_yaw_deg)) errors.push('값 형식이 틀림: rest_yaw_deg');
    if (!(raw.guitar && isVec3(raw.guitar.center))) errors.push('필수 개체 없음: guitar');
    if (!Array.isArray(raw.grass)) errors.push('필수 개체 없음: grass');
    const ids = new Set();
    for (const it of [...(raw.rocks ?? []), ...(Array.isArray(raw.grass) ? raw.grass : [])]) {
      if (!it || typeof it.id !== 'string' || !isVec3(it.center) || !isNum(it.scale)) { errors.push(`바위·풀 항목 형식이 틀림: ${JSON.stringify(it).slice(0, 60)}`); continue; }
      if (ids.has(it.id)) errors.push(`같은 ID가 두 번: ${it.id}`);
      ids.add(it.id);
    }
  }
  if (errors.length) return { ok: false, errors };
  const layout = migrate(raw);
  syncDerived(layout);
  return { ok: true, layout, errors: [], migrated: raw.version !== VERSION };
}

/** 저장할 JSON 문자열 (사람이 읽기 쉽게 들여쓰기 1) */
export function serialize(L, meta = {}) {
  const out = { ...clone(L), ...meta };
  return JSON.stringify(out, null, 1) + '\n';
}

/** 두 배치가 편집 값으로 같은지 (저장 여부 표시용) */
export function sameLayout(a, b) {
  const strip = (L) => { const c = clone(L); delete c.saved_at; delete c.saved_by; return JSON.stringify(c); };
  return strip(a) === strip(b);
}

// ---------- 실행 취소 ----------
/** 상태 스냅샷 이력. push는 "확정된 한 단계"(드래그를 놓을 때, 숫자 확정 때)만 */
export function createHistory(initial, limit = 100) {
  const stack = [clone(initial)];
  let i = 0;
  return {
    get index() { return i; },
    get size() { return stack.length; },
    get canUndo() { return i > 0; },
    get canRedo() { return i < stack.length - 1; },
    current() { return clone(stack[i]); },
    push(L) {
      if (JSON.stringify(L) === JSON.stringify(stack[i])) return false;
      stack.splice(i + 1);
      stack.push(clone(L));
      if (stack.length > limit) stack.shift();
      i = stack.length - 1;
      return true;
    },
    undo() { if (i > 0) i--; return clone(stack[i]); },
    redo() { if (i < stack.length - 1) i++; return clone(stack[i]); },
  };
}
