// 공통 설정 저장소 (F10·F08). three.js·DOM 없이 테스트 가능.
// settings = 사용자 선택(저장 대상): scene(환경) · camera · screen(화면 효과) · quality.
// 보간 중 실제 값(불 세기·비 양·젖음 등)은 각 기능 모듈의 runtime이 settings를 읽어 시간 기준으로 만든다 — 여기서 타이머를 돌리지 않음.
// 촬영 모드: 진입 때 감상 camera·screen을 photo.saved에 보관하고 그대로 이어받음 → 종료 때 복원. 환경(scene)·품질은 공통.

export const STORAGE_KEY = 'camping.settings.v1';
export const VERSION = 1;

const num = (def, min, max) => ({ t: 'num', def, min, max });
const bool = (def) => ({ t: 'bool', def });
const oneOf = (def, values) => ({ t: 'enum', def, values });
const vec3 = (def, min, max) => ({ t: 'vec3', def, min, max });

// 정규화 강도(0..1 등)는 물리 단위가 아님. 단위가 있는 것만 이름에 표시(lens mm, distanceM 가상 m, 각도 °)
export const SCHEMA = {
  scene: {
    fire: { base: num(1.0, 0, 1.5), flicker: num(0.3, 0, 1), sparks: num(0.5, 0, 1), smoke: num(0.4, 0, 1) },
    stars: { intensity: num(0.6, 0, 1), twinkle: num(0.35, 0, 1) },
    aurora: { on: bool(false), intensity: num(0.25, 0, 1), speed: num(0.3, 0, 1) },
    rain: { on: bool(false), duration: oneOf(30, [30, 60, 'loop']), intensity: num(0.35, 0, 1) },
    wind: num(0.2, 0, 1),
    weatherLink: bool(true),
  },
  camera: {
    lens: num(35, 24, 85),                       // 렌즈 초점거리 (mm, 가상 36×24 센서)
    distance: num(7.2, 3.5, 16),                 // 카메라 거리 (H) — 렌즈와 별개 (CP-09 기본 구도: 7.4 → 7.2)
    azimuth: num(17, -180, 180),                 // °, +z에서 +x 쪽
    elevation: num(22, 0, 70),                   // °, 0 = 지면과 수평 (CP-08: 이전 하한 8°)
    target: vec3([-0.1, 0.42, -0.35], [-3.5, 0, -3], [3.5, 2.5, 3]),   // CP-09: 캠프 쪽으로 (이전 [0.25, 0.3, 0.05]는 앞 빈 땅이 화면 아래 절반을 차지)   // 평행 이동 범위 (app/camera_rig.js TARGET_BOX와 같음)
    focus: { mode: oneOf('character', ['character', 'fire', 'point', 'manual']), distanceM: num(1.2, 0.1, 10), point: vec3([0.3, 0.3, 0.0], [-4, -2, -4], [4, 4, 4]) },
    dof: { on: bool(false), fstop: num(4, 1.8, 16), maxBlur: num(0.5, 0, 1) },   // fstop = 가상 조리개
  },
  screen: {
    exposure: num(0, -2, 2),                     // EV, 노출은 여기 한곳 (renderer.toneMappingExposure = 2^EV)
    bloom: num(0.35, 0, 1.5), temperature: num(0, -1, 1), contrast: num(0, -0.5, 0.5), saturation: num(0, -0.5, 0.5),
    vignette: num(0.12, 0, 0.6), grain: { on: bool(false), amount: num(0.15, 0, 0.6) },
  },
  quality: {
    mode: oneOf('auto', ['auto', 'high', 'medium', 'low']),
    effectsOff: { sparks: bool(false), smoke: bool(false), splashes: bool(false), aurora: bool(false), dof: bool(false), shadows: bool(false), ao: bool(false) },   // ao = 접촉 음영 (2026-10-24)
  },
};

const isLeaf = (s) => s && typeof s.t === 'string';
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function defaultsOf(schema) {
  if (isLeaf(schema)) return clone(schema.def);
  return Object.fromEntries(Object.entries(schema).map(([k, s]) => [k, defaultsOf(s)]));
}
export const DEFAULTS = Object.freeze(defaultsOf(SCHEMA));
export const defaults = () => clone(DEFAULTS);

function leafOk(s, v) {
  switch (s.t) {
    case 'num': return typeof v === 'number' && Number.isFinite(v) && v >= s.min && v <= s.max;
    case 'bool': return typeof v === 'boolean';
    case 'enum': return s.values.includes(v);
    case 'vec3': return Array.isArray(v) && v.length === 3 && v.every((x, i) => typeof x === 'number' && Number.isFinite(x) && x >= s.min[i] && x <= s.max[i]);
    default: return false;
  }
}

/** 스키마 검사: 잘못된·범위 밖·빠진 값은 필드 단위로 기본값. 반환 { value, fixed: [경로...] } */
export function sanitize(raw, schema = SCHEMA, path = '') {
  if (isLeaf(schema)) {
    if (leafOk(schema, raw)) return { value: clone(raw), fixed: [] };
    return { value: clone(schema.def), fixed: [path] };
  }
  const bad = !(raw && typeof raw === 'object' && !Array.isArray(raw));   // 묶음 자체가 없거나 잘못됨 → 묶음 전체 기본값, 경로 하나로 기록
  const out = {};
  const fixed = bad ? [path || '(root)'] : [];
  for (const [k, s] of Object.entries(schema)) {
    const r = sanitize(bad ? undefined : raw[k], s, path ? `${path}.${k}` : k);
    out[k] = r.value;
    if (!bad) fixed.push(...r.fixed);
  }
  return { value: out, fixed };
}

function schemaAt(path) {
  let s = SCHEMA;
  for (const k of path.split('.')) { if (!s || isLeaf(s) || !(k in s)) return null; s = s[k]; }
  return s;
}
function getAt(obj, path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function setAt(obj, path, v) {
  const ks = path.split('.');
  let o = obj;
  for (const k of ks.slice(0, -1)) o = o[k];
  o[ks[ks.length - 1]] = v;
}

// 기본 프리셋 4종. 각 프리셋이 바꾸는 범위(camera / screen / scene)를 명시 — 없는 묶음은 건드리지 않음
export const PRESETS = [
  { id: 'calm', name: '고요한 별밤', changes: ['camera', 'screen', 'scene'],
    camera: {}, screen: {}, scene: { 'fire.base': 1.0, 'stars.intensity': 0.6, 'aurora.on': false, 'rain.on': false } },
  { id: 'aurora', name: '오로라의 밤', changes: ['camera', 'screen', 'scene'],
    camera: { elevation: 8, distance: 9.0, target: [0.0, 1.1, -0.4] }, screen: { temperature: -0.15, bloom: 0.4 },   // 하늘이 화면 위 절반. CP-09: 타깃 높이 1.8은 옛 범위(≤1.5)로 무시되다 CP-08에서 적용 → 섬이 화면 아래로 작아져 1.1로
    scene: { 'aurora.on': true, 'aurora.intensity': 0.25 } },
  { id: 'rain', name: '잠깐 내리는 비', changes: ['scene'],
    scene: { 'rain.on': true, 'rain.duration': 30, 'rain.intensity': 0.35 } },
  { id: 'portrait', name: '모닥불 곁 인물 촬영', changes: ['camera', 'screen'], photo: true,
    camera: { lens: 50, distance: 3.6, azimuth: 40, elevation: 14, target: [0.32, 0.3, 0.02], 'focus.mode': 'character', 'dof.on': true, 'dof.fstop': 2.8, 'dof.maxBlur': 0.35 },
    screen: { temperature: 0.12 } },
];

export function createStore({ storage = null, key = STORAGE_KEY } = {}) {
  // 첫 화면 카메라(W-20): web/config/first_view.json 값. 카메라 초기화·전체 초기화·프리셋의 카메라 기준
  let cameraBase = null;
  const defaultsNow = () => { const d = defaults(); if (cameraBase) Object.assign(d.camera, clone(cameraBase)); return d; };
  let settings = defaults();
  const photo = { active: false, saved: null, paused: false, slots: [null, null, null] };
  const listeners = new Set();
  let lastLoad = { fixed: [], migrated: false, error: null };

  const emit = (what) => { for (const fn of listeners) fn(what, api); };
  // 최상위 객체는 바꾸지 않고 안의 묶음만 교체 → 바깥에서 store.settings를 붙잡아 둔 참조가 끊기지 않음
  const replaceAll = (obj) => { for (const k of Object.keys(settings)) delete settings[k]; Object.assign(settings, obj); };
  const viewSettings = () => (photo.active ? { ...settings, camera: photo.saved.camera, screen: photo.saved.screen } : settings);

  function applyPatch(group, patch) {
    for (const [p, v] of Object.entries(patch)) {
      const path = `${group}.${p}`;
      const s = schemaAt(path);
      if (s && isLeaf(s) && leafOk(s, v)) setAt(settings, path, clone(v));
    }
  }

  const api = {
    get settings() { return settings; },
    get photo() { return photo; },
    get lastLoad() { return lastLoad; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get(path) { return getAt(settings, path); },
    /** 값 하나 변경. 잘못된 값은 거부(false), 범위 밖 숫자는 끝값으로 자름. opts.save=false면 저장소 쓰기 생략(드래그 중 등) */
    set(path, value, opts = {}) {
      const s = schemaAt(path);
      if (!s || !isLeaf(s)) return false;
      let v = value;
      if (s.t === 'num' && typeof v === 'number' && Number.isFinite(v)) v = Math.min(s.max, Math.max(s.min, v));
      if (!leafOk(s, v)) return false;
      setAt(settings, path, clone(v));
      emit({ type: 'set', path });
      if (opts.save !== false) api.save();
      return true;
    },

    // ---------- 촬영 모드 ----------
    enterPhoto() {
      if (photo.active) return;
      photo.saved = { camera: clone(settings.camera), screen: clone(settings.screen) };
      photo.active = true;                          // 현재 카메라·화면 효과를 그대로 이어받음
      emit({ type: 'photo', active: true });
    },
    exitPhoto() {
      if (!photo.active) return;
      settings.camera = clone(photo.saved.camera);
      settings.screen = clone(photo.saved.screen);
      photo.active = false; photo.saved = null;
      photo.paused = false;                         // 촬영 중 건 일시 정지 해제
      emit({ type: 'photo', active: false });
      api.save();
    },
    /** "감상 화면에도 적용": 현재 촬영 카메라·화면 효과를 감상 설정과 종료 때 복원할 기준 둘 다에 */
    applyPhotoToView() {
      if (!photo.active) return;
      photo.saved = { camera: clone(settings.camera), screen: clone(settings.screen) };
      emit({ type: 'photo-apply' });
      api.save();
    },
    setPaused(p) { photo.paused = !!p; emit({ type: 'pause', paused: photo.paused }); },

    // ---------- 시점·프리셋 저장 (카메라·화면 효과만, 환경 미포함) ----------
    saveSlot(i) {
      if (!(i >= 0 && i < 3)) return false;
      photo.slots[i] = { camera: clone(settings.camera), screen: clone(settings.screen) };
      api.save();
      return true;
    },
    loadSlot(i) {
      const s = photo.slots[i];
      if (!s) return false;
      settings.camera = clone(s.camera);
      settings.screen = clone(s.screen);
      emit({ type: 'slot', index: i });
      api.save();
      return true;
    },

    applyPreset(id) {
      const p = PRESETS.find((x) => x.id === id);
      if (!p) return false;
      if (p.photo) api.enterPhoto();
      if (p.changes.includes('camera')) { settings.camera = defaultsNow().camera; applyPatch('camera', p.camera ?? {}); }
      if (p.changes.includes('screen')) { settings.screen = defaultsNow().screen; applyPatch('screen', p.screen ?? {}); }
      if (p.changes.includes('scene')) applyPatch('scene', p.scene ?? {});
      emit({ type: 'preset', id, changes: p.changes });
      api.save();
      return true;
    },

    /** 초기화 3종: 'camera' | 'envScreen' | 'all' */
    reset(scope) {
      const d = defaultsNow();
      if (scope === 'camera') settings.camera = d.camera;
      else if (scope === 'envScreen') { settings.scene = d.scene; settings.screen = d.screen; }
      else if (scope === 'all') {
        replaceAll(d);
        if (photo.active) photo.saved = { camera: clone(d.camera), screen: clone(d.screen) };   // 종료 때 과거 설정이 되살아나지 않게
        photo.paused = false;
      } else return false;
      emit({ type: 'reset', scope });                // 'all'이면 앱이 비 타이머·입자·캐릭터 상태도 초기화
      api.save();
      return true;
    },

    // ---------- 첫 화면 카메라 ----------
    /** 첫 화면 카메라 지정 (lens·distance·azimuth·elevation·target 중 유효한 값만). 반환: 적용된 값 */
    setCameraBase(cam) {
      const ok = {};
      for (const k of ['lens', 'distance', 'azimuth', 'elevation', 'target']) { const s = SCHEMA.camera[k]; if (cam && leafOk(s, cam[k])) ok[k] = clone(cam[k]); }
      cameraBase = Object.keys(ok).length ? ok : null;
      return cameraBase;
    },
    get cameraBase() { return cameraBase && clone(cameraBase); },
    /** 카메라를 첫 화면으로 (페이지를 열 때: 브라우저에 남은 마지막 카메라 대신) */
    startFromFirstView() { settings.camera = defaultsNow().camera; emit({ type: 'reset', scope: 'camera' }); },

    // ---------- 저장·불러오기 ----------
    serialize() {
      const v = viewSettings();
      return JSON.stringify({ version: VERSION, settings: v, slots: photo.slots });
    },
    save() {
      if (!storage) return false;
      try { storage.setItem(key, api.serialize()); return true; } catch { return false; }
    },
    load() {
      lastLoad = { fixed: [], migrated: false, error: null };
      if (!storage) return lastLoad;
      let raw = null;
      try { raw = storage.getItem(key); } catch (e) { lastLoad.error = 'storage-unavailable'; return lastLoad; }
      if (raw == null) return lastLoad;
      let obj;
      try { obj = JSON.parse(raw); } catch { lastLoad.error = 'bad-json'; replaceAll(defaults()); return lastLoad; }
      if (!obj || obj.version !== VERSION) { lastLoad.migrated = true; replaceAll(defaults()); return lastLoad; }   // 이전 판 변환 규칙 없음 → 기본값
      const r = sanitize(obj.settings);
      replaceAll(r.value);
      lastLoad.fixed = r.fixed;
      if (Array.isArray(obj.slots)) {
        photo.slots = [0, 1, 2].map((i) => {
          const s = obj.slots[i];
          if (!s) return null;
          const c = sanitize(s.camera, SCHEMA.camera, 'camera');
          const sc = sanitize(s.screen, SCHEMA.screen, 'screen');
          return { camera: c.value, screen: sc.value };
        });
      }
      emit({ type: 'load' });
      return lastLoad;
    },
  };
  return api;
}
