// 인트로(Presentation Mode) 설정 모델 — web/config/presentation.json 한 파일. three.js·DOM 없이 테스트 가능 (서버 저장 검사도 이 파일을 씀).
// 원칙: 사람이 읽고 고치기 쉬운 JSON. 문구·카메라·필터·전환 값은 모두 여기서만 (코드에 박지 않음).
// 읽기: 잘못된 값은 칸 단위로 기본값으로 바꾸고 warnings에 남김. 파일 전체를 못 쓰는 경우(JSON 아님·섹션 없음·형식 다름)만 errors → 저장 거부, 기존 파일 보존.
import { SCHEMA as STORE_SCHEMA } from './store.js';

export const PRESENTATION_VERSION = 1;
export const START_MODES = ['always', 'first', 'never'];          // 항상 표시 · 첫 방문만 · 표시 안 함
export const EASINGS = ['calm', 'smooth', 'gentle', 'linear'];      // 차분(사인) · 부드럽게(3차) · 끝만 느리게 · 일정
export const ALIGNS = ['left', 'center', 'right'];
export const VERTICALS = ['top', 'middle', 'bottom'];
export const MEDIA_LAYOUTS = ['none', 'single', 'compare', 'cards'];   // 없음 · 이미지 1장 · 비교 2장 · 작은 카드 3개
export const MEDIA_MAX = { none: 0, single: 1, compare: 2, cards: 3 };

/** 필터 값 범위 (0이면 그 효과 없음). strength = 전체 세기(0 = 필터 없음, 1 = 그대로) */
export const FILTER_RANGES = {
  strength: [0, 1], saturation: [-1, 0.5], contrast: [-0.5, 0.5], flatten: [0, 1], posterize: [0, 1],
  paint: [0, 1], outline: [0, 1], paper: [0, 1], vignette: [0, 1], bloom: [0, 1.5], warmth: [-1, 1],
};
/** 필터 프리셋: 고르면 이 값들이 그대로 복사됨 (이후 칸별로 고칠 수 있음) */
export const FILTER_PRESETS = {
  gouache: { strength: 1, saturation: -0.12, contrast: -0.06, flatten: 0.55, posterize: 0.22, paint: 0.8, outline: 0.12, paper: 0.45, vignette: 0.3, bloom: 0.75, warmth: 0.1 },
  print: { strength: 1, saturation: -0.3, contrast: 0.05, flatten: 0.45, posterize: 0.55, paint: 0.3, outline: 0.7, paper: 0.7, vignette: 0.3, bloom: 0.45, warmth: 0.15 },
  soft: { strength: 1, saturation: -0.15, contrast: -0.1, flatten: 0.35, posterize: 0.0, paint: 0.4, outline: 0.0, paper: 0.3, vignette: 0.3, bloom: 0.7, warmth: 0.06 },
  none: { strength: 0, saturation: 0, contrast: 0, flatten: 0, posterize: 0, paint: 0, outline: 0, paper: 0, vignette: 0, bloom: 1, warmth: 0 },
};
export const FILTER_PRESET_NAMES = { gouache: '과슈(붓 느낌)', print: '판화(윤곽선·종이)', soft: '부드럽게(색만)', none: '필터 없음' };

const CAM = STORE_SCHEMA.camera;
const LIMITS = { label: 40, title: 120, subtitle: 160, body: 1200, keyword: 30, keywords: 8, caption: 120, src: 300, action: 40, id: 40 };

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const num = (v) => typeof v === 'number' && Number.isFinite(v);

export function defaultCamera() {
  return { azimuth: 17, elevation: 22, distance: 7.2, lens: 35, target: [-0.1, 0.42, -0.35], dof: null };
}
export function defaultSection(i = 0) {
  return {
    id: `section-${i + 1}`, hidden: false, label: 'SECTION', title: '새 섹션', subtitle: '', body: '', keywords: [],
    layout: { align: 'left', vertical: 'bottom', maxWidth: 440 },
    media: { layout: 'none', items: [] },
    camera: defaultCamera(), cameraMobile: null, filter: {}, transition: {}, action: null,
  };
}
export function defaultPresentation() {
  return {
    version: PRESENTATION_VERSION,
    start: { mode: 'always' },
    transition: { camera: 1.2, content: 0.9, easing: 'calm', inputLock: 0.25 },
    explore: { washDuration: 2.2, streaks: 16, seed: 7 },
    ambient: { drift: 0.25 },
    filter: { preset: 'gouache', ...FILTER_PRESETS.gouache },
    sections: [defaultSection(0)],
  };
}

function str(v, max, path, warn, def = '') {
  if (v === undefined || v === null) return def;
  if (typeof v !== 'string') { warn.push(`${path}: 글자가 아니어서 비움`); return def; }
  if (v.length > max) { warn.push(`${path}: ${max}자까지만`); return v.slice(0, max); }
  return v;
}
function oneOf(v, list, def, path, warn) {
  if (v === undefined) return def;
  if (list.includes(v)) return v;
  warn.push(`${path}: "${v}" 대신 "${def}"`);
  return def;
}
function number(v, range, def, path, warn) {
  if (v === undefined) return def;
  if (!num(v)) { warn.push(`${path}: 숫자가 아니어서 ${def}`); return def; }
  const c = clamp(v, range);
  if (c !== v) warn.push(`${path}: 범위 ${range[0]}–${range[1]}로 자름`);
  return c;
}
/** 이미지 경로: 상대 경로 또는 http(s)만 (다른 스킴 거부) */
function src(v, path, warn) {
  const s = str(v, LIMITS.src, path, warn).trim();
  if (!s) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:/i.test(s)) { warn.push(`${path}: http(s) 또는 상대 경로만`); return ''; }
  return s;
}

export function sanitizeCamera(c, path, warn, { allowNull = false } = {}) {
  if (c === null && allowNull) return null;
  if (!isObj(c)) { if (c !== undefined && c !== null) warn.push(`${path}: 기본 카메라로`); return allowNull ? null : defaultCamera(); }
  const d = defaultCamera();
  const out = {
    azimuth: number(c.azimuth, [CAM.azimuth.min, CAM.azimuth.max], d.azimuth, `${path}.azimuth`, warn),
    elevation: number(c.elevation, [CAM.elevation.min, CAM.elevation.max], d.elevation, `${path}.elevation`, warn),
    distance: number(c.distance, [CAM.distance.min, CAM.distance.max], d.distance, `${path}.distance`, warn),
    lens: number(c.lens, [CAM.lens.min, CAM.lens.max], d.lens, `${path}.lens`, warn),
    target: d.target,
    dof: null,
  };
  if (Array.isArray(c.target) && c.target.length === 3 && c.target.every(num)) out.target = c.target.map((v, i) => clamp(v, [CAM.target.min[i], CAM.target.max[i]]));
  else if (c.target !== undefined) warn.push(`${path}.target: [x, y, z] 숫자 3개가 아니어서 기본값`);
  if (isObj(c.dof)) {
    out.dof = {
      on: c.dof.on !== false,
      focus: oneOf(c.dof.focus, ['character', 'fire', 'target'], 'character', `${path}.dof.focus`, warn),
      fstop: number(c.dof.fstop, [CAM.dof.fstop.min, CAM.dof.fstop.max], 4, `${path}.dof.fstop`, warn),
      maxBlur: number(c.dof.maxBlur, [0, 1], 0.4, `${path}.dof.maxBlur`, warn),
    };
  }
  return out;
}
export function sanitizeFilter(f, path, warn, { partial = false } = {}) {
  const out = {};
  if (!isObj(f)) { if (f !== undefined) warn.push(`${path}: 필터 값이 아니어서 ${partial ? '비움' : '기본값'}`); return partial ? {} : { preset: 'gouache', ...FILTER_PRESETS.gouache }; }
  if (f.preset !== undefined || !partial) out.preset = oneOf(f.preset, Object.keys(FILTER_PRESETS), 'gouache', `${path}.preset`, warn);
  const base = partial ? {} : FILTER_PRESETS[out.preset];
  for (const [k, r] of Object.entries(FILTER_RANGES)) {
    if (f[k] !== undefined) out[k] = number(f[k], r, base[k] ?? 0, `${path}.${k}`, warn);
    else if (!partial) out[k] = base[k];
  }
  return out;
}
function sanitizeTransition(t, path, warn, { partial = false } = {}) {
  const d = defaultPresentation().transition;
  if (!isObj(t)) { if (t !== undefined) warn.push(`${path}: 전환 값이 아니어서 ${partial ? '비움' : '기본값'}`); return partial ? {} : d; }
  const out = {};
  const put = (k, v) => { if (t[k] !== undefined || !partial) out[k] = v; };
  put('camera', number(t.camera, [0, 6], d.camera, `${path}.camera`, warn));
  put('content', number(t.content, [0, 4], d.content, `${path}.content`, warn));
  put('easing', oneOf(t.easing, EASINGS, d.easing, `${path}.easing`, warn));
  if (!partial) put('inputLock', number(t.inputLock, [0, 2], d.inputLock, `${path}.inputLock`, warn));
  return out;
}
function sanitizeSection(s, i, warn, ids) {
  const p = `sections[${i}]`;
  const d = defaultSection(i);
  if (!isObj(s)) { warn.push(`${p}: 섹션이 아니어서 새 섹션으로`); return d; }
  let id = str(s.id, LIMITS.id, `${p}.id`, warn).trim().replace(/[^\w-]/g, '-') || d.id;
  while (ids.has(id)) id = `${id}-2`;
  ids.add(id);
  const kw = Array.isArray(s.keywords) ? s.keywords.filter((k) => typeof k === 'string' && k.trim()).slice(0, LIMITS.keywords).map((k) => k.trim().slice(0, LIMITS.keyword)) : [];
  if (s.keywords !== undefined && !Array.isArray(s.keywords)) warn.push(`${p}.keywords: 목록([...])이 아니어서 비움`);
  const lay = isObj(s.layout) ? s.layout : {};
  const media = isObj(s.media) ? s.media : {};
  const mLayout = oneOf(media.layout, MEDIA_LAYOUTS, 'none', `${p}.media.layout`, warn);
  const items = (Array.isArray(media.items) ? media.items : []).slice(0, 3).map((it, k) => ({
    src: src(it?.src, `${p}.media.items[${k}].src`, warn),
    caption: str(it?.caption, LIMITS.caption, `${p}.media.items[${k}].caption`, warn),
  }));
  let action = null;
  if (isObj(s.action)) action = { type: oneOf(s.action.type, ['explore'], 'explore', `${p}.action.type`, warn), label: str(s.action.label, LIMITS.action, `${p}.action.label`, warn, '탐험하러 가기 →') || '탐험하러 가기 →' };
  return {
    id, hidden: s.hidden === true,
    label: str(s.label, LIMITS.label, `${p}.label`, warn),
    title: str(s.title, LIMITS.title, `${p}.title`, warn),
    subtitle: str(s.subtitle, LIMITS.subtitle, `${p}.subtitle`, warn),
    body: str(s.body, LIMITS.body, `${p}.body`, warn),
    keywords: kw,
    layout: {
      align: oneOf(lay.align, ALIGNS, 'left', `${p}.layout.align`, warn),
      vertical: oneOf(lay.vertical, VERTICALS, 'bottom', `${p}.layout.vertical`, warn),
      maxWidth: number(lay.maxWidth, [240, 900], 440, `${p}.layout.maxWidth`, warn),
    },
    media: { layout: mLayout, items },
    camera: sanitizeCamera(s.camera, `${p}.camera`, warn),
    cameraMobile: sanitizeCamera(s.cameraMobile ?? null, `${p}.cameraMobile`, warn, { allowNull: true }),
    filter: sanitizeFilter(s.filter, `${p}.filter`, warn, { partial: true }),
    transition: sanitizeTransition(s.transition, `${p}.transition`, warn, { partial: true }),
    action,
  };
}

/**
 * 읽기·검사. input = JSON 글자 또는 객체.
 * 반환 { ok, value, errors[], warnings[] } — ok가 false면 저장하지 않음 (기존 파일 보존)
 */
export function parsePresentation(input) {
  const errors = [], warnings = [];
  let obj = input;
  if (typeof input === 'string') {
    try { obj = JSON.parse(input); } catch (e) { return { ok: false, value: null, errors: [`JSON 형식이 아니에요: ${e.message}`], warnings }; }
  }
  if (!isObj(obj)) return { ok: false, value: null, errors: ['최상위가 { … } 객체가 아니에요'], warnings };
  if (obj.version !== undefined && obj.version !== PRESENTATION_VERSION) errors.push(`형식 v${PRESENTATION_VERSION}만 읽어요 (받은 형식 v${obj.version})`);
  if (!Array.isArray(obj.sections) || obj.sections.length === 0) errors.push('sections: 섹션이 1개 이상 있어야 해요');
  if (errors.length) return { ok: false, value: null, errors, warnings };
  if (obj.sections.length > 20) warnings.push('sections: 20개까지만');
  const d = defaultPresentation();
  const ids = new Set();
  const value = {
    version: PRESENTATION_VERSION,
    start: { mode: oneOf(obj.start?.mode, START_MODES, d.start.mode, 'start.mode', warnings) },
    transition: sanitizeTransition(obj.transition, 'transition', warnings),
    explore: {
      washDuration: number(obj.explore?.washDuration, [0.6, 6], d.explore.washDuration, 'explore.washDuration', warnings),
      streaks: Math.round(number(obj.explore?.streaks, [4, 40], d.explore.streaks, 'explore.streaks', warnings)),
      seed: Math.round(number(obj.explore?.seed, [0, 999], d.explore.seed, 'explore.seed', warnings)),
    },
    ambient: { drift: number(obj.ambient?.drift, [0, 2], d.ambient.drift, 'ambient.drift', warnings) },
    filter: sanitizeFilter(obj.filter, 'filter', warnings),
    sections: obj.sections.slice(0, 20).map((s, i) => sanitizeSection(s, i, warnings, ids)),
  };
  if (typeof obj.note === 'string') value.note = obj.note.slice(0, 2000);       // 메모 (화면에 안 나옴)
  if (typeof obj.saved_at === 'string') value.saved_at = obj.saved_at;
  if (typeof obj.saved_by === 'string') value.saved_by = obj.saved_by.slice(0, 80);
  if (!value.sections.some((s) => !s.hidden)) return { ok: false, value: null, errors: ['보이는 섹션이 하나도 없어요 (모두 숨김)'], warnings };
  return { ok: true, value, errors, warnings };
}

/** 저장용 JSON (사람이 읽기 쉽게 2칸 들여쓰기, 키 순서 고정) */
export function serializePresentation(p, extra = {}) {
  const v = clone(p);
  delete v.saved_at; delete v.saved_by;
  return JSON.stringify({ ...v, ...extra }, null, 2) + '\n';
}

/** 섹션에서 실제로 쓰는 값 계산: 전역 + 섹션 덮어쓰기 */
export function effectiveFilter(p, section) {
  return { ...p.filter, ...(section?.filter ?? {}) };
}
export function effectiveTransition(p, section) {
  return { ...p.transition, ...(section?.transition ?? {}) };
}
/** 보이는 섹션만 (순서 그대로) */
export function visibleSections(p) {
  return p.sections.filter((s) => !s.hidden);
}

/** 이징 함수 (0..1 → 0..1) — 튕김 없음 */
export const EASE = {
  calm: (t) => 0.5 - 0.5 * Math.cos(Math.PI * t),
  smooth: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  gentle: (t) => 1 - Math.pow(1 - t, 3),
  linear: (t) => t,
};

/** 카메라 값 보간 (방위는 짧은 쪽으로) */
export function lerpCamera(a, b, t) {
  const wrap = (x) => ((((x + 180) % 360) + 360) % 360) - 180;
  const L = (x, y) => x + (y - x) * t;
  return {
    azimuth: wrap(a.azimuth + wrap(b.azimuth - a.azimuth) * t),
    elevation: L(a.elevation, b.elevation),
    distance: L(a.distance, b.distance),
    lens: L(a.lens, b.lens),
    target: a.target.map((v, i) => L(v, b.target[i])),
  };
}
