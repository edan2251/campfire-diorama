// 인트로(Presentation Mode) 설정 모델 — web/config/presentation.json 한 파일. three.js·DOM 없이 테스트 가능 (서버 저장 검사도 이 파일을 씀).
// 원칙: 사람이 읽고 고치기 쉬운 JSON. 문구·카메라·필터·전환 값은 모두 여기서만 (코드에 박지 않음).
// 읽기: 잘못된 값은 칸 단위로 기본값으로 바꾸고 warnings에 남김. 파일 전체를 못 쓰는 경우(JSON 아님·섹션 없음·형식 다름)만 errors → 저장 거부, 기존 파일 보존.
import { SCHEMA as STORE_SCHEMA } from './store.js';

export const PRESENTATION_VERSION = 1;
export const START_MODES = ['always', 'first', 'never'];          // 항상 표시 · 첫 방문만 · 표시 안 함
export const EASINGS = ['calm', 'smooth', 'gentle', 'linear'];      // 차분(사인) · 부드럽게(3차) · 끝만 느리게 · 일정
export const ALIGNS = ['left', 'center', 'right'];
export const VERTICALS = ['top', 'middle', 'bottom'];
export const MEDIA_LAYOUTS = ['none', 'single', 'compare', 'pair', 'cards'];   // 없음 · 이미지 1장 · 비교 2장(→) · 나란히 2장 · 작은 카드 3개
export const MEDIA_MAX = { none: 0, single: 1, compare: 2, pair: 2, cards: 3 };

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
export const FOCUS_MODES = ['character', 'fire', 'target', 'point'];   // 캐릭터 · 모닥불 · 카메라 타깃 · 클릭한 곳(point [x,y,z])
/** 자유 배치 상자 (편집기에서 끌어 놓기·크기 조절). x·y = 왼쪽 위(화면 %), w = 너비(화면 너비 %), scale = 글 크기 배율. 휴대폰 세로에서는 쓰지 않음(자동 배치) */
export const BOX_RANGES = { x: [-10, 100], y: [-10, 100], w: [8, 100], scale: [0.4, 3] };
const LIMITS = { label: 40, title: 120, subtitle: 160, body: 1200, keyword: 30, keywords: 8, caption: 120, src: 300, action: 40, id: 40, demoLabel: 24, demoTag: 30, demoNote: 140, demos: 8, sbxCommand: 120, sbxNote: 200, sbxButton: 24, pointLabel: 12, point: 200, points: 4, mediaLabel: 40 };
/** 체험 버튼(섹션 안 "눌러 보기", U-17): 디오라마 기능 하나를 그 기능이 잘 보이는 구도(camera·심도)로 보여 줌.
 *  scene = 그동안만 바꿀 장면 값(감상 설정 경로, 저장 안 함 — 섹션을 떠나거나 탐험으로 가면 원래대로).
 *  act = 'walk'(캐릭터가 walkTo [x,z]로 걸어갔다 통나무로 돌아와 앉기를 되풀이) · 'focus'(camera.dof ↔ focusTo를 period초마다 오감) · 'none' */
export const DEMO_ACTS = ['none', 'walk', 'focus'];
/** 체험 패널(U-18, 섹션 sandbox): 'layout' = ① 글로 시키기(명령 문장 → 물체가 움직임) ② 직접 옮기기(편집 모드 기즈모 미리보기) ③ 글 상자 놀이(PPT처럼).
 *  모두 미리보기 — 패널을 닫거나 섹션을 떠나면 원래대로. target = 처음 고른 물체(배치 단위 id), command = 처음에 타자 치듯 써 넣을 예시 문장 */
export const SANDBOX_KINDS = ['layout'];
export const SANDBOX_TARGETS = ['rock0', 'rock1', 'rock2', 'rock3', 'tent', 'guitar_case', 'grass0', 'grass1', 'grass2', 'grass3', 'grass4', 'grass5', 'grass6', 'grass7', 'grass8'];
export function defaultSandbox() {
  return { kind: 'layout', button: '직접 해 보기', title: '직접 해 보기', target: 'rock0', command: '', notes: { command: '', direct: '', text: '' }, boxText: '' };
}
export const DEMO_SCENE = {
  'fire.base': [0, 1.5], 'fire.sparks': [0, 1], 'fire.smoke': [0, 1], 'aurora.on': 'bool', 'aurora.intensity': [0, 1], 'aurora.speed': [0, 1], 'meteors.on': 'bool', 'meteors.rate': [0, 1],
  'rain.on': 'bool', 'rain.intensity': [0, 1], wind: [0, 1], 'stars.intensity': [0, 1],
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const num = (v) => typeof v === 'number' && Number.isFinite(v);

export function defaultCamera() {
  return { azimuth: 17, elevation: 22, distance: 7.2, lens: 35, target: [-0.1, 0.42, -0.35], dof: null };
}
export function defaultSection(i = 0) {
  return {
    id: `section-${i + 1}`, hidden: false, label: 'SECTION', title: '새 섹션', subtitle: '', body: '', keywords: [], points: [],
    layout: { align: 'left', vertical: 'bottom', maxWidth: 440, box: null },
    media: { layout: 'none', label: '', items: [], box: null },
    camera: defaultCamera(), cameraMobile: null, filter: {}, transition: {}, action: null, demos: [], sandbox: null,
  };
}
export function defaultPresentation() {
  return {
    version: PRESENTATION_VERSION,
    start: { mode: 'always' },
    transition: { camera: 1.2, content: 0.9, easing: 'calm', inputLock: 0.25 },
    explore: { washDuration: 2.2, streaks: 5, seed: 7 },   // 번짐 전환 시간 · 뒤따르는 작은 번짐 수 · 무늬 번호
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
  if (isObj(c.dof)) out.dof = sanitizeDof(c.dof, `${path}.dof`, warn);
  return out;
}
/** 심도 { on, focus, fstop, maxBlur, point? } */
export function sanitizeDof(v, path, warn) {
  const out = {
    on: v.on !== false,
    focus: oneOf(v.focus, FOCUS_MODES, 'character', `${path}.focus`, warn),
    fstop: number(v.fstop, [CAM.dof.fstop.min, CAM.dof.fstop.max], 4, `${path}.fstop`, warn),
    maxBlur: number(v.maxBlur, [0, 1], 0.4, `${path}.maxBlur`, warn),
  };
  if (out.focus === 'point') {
    if (Array.isArray(v.point) && v.point.length === 3 && v.point.every(num)) out.point = v.point.map((x) => clamp(x, [-50, 50]));
    else { warn.push(`${path}.point: [x, y, z] 숫자 3개가 아니어서 초점 = 캐릭터`); out.focus = 'character'; }
  }
  return out;
}
export function defaultDemo(i = 0) {
  return { id: `demo-${i + 1}`, label: '새 버튼', tag: '', note: '', noteTo: '', act: 'none', camera: defaultCamera(), cameraMobile: null, scene: {}, walkTo: null, focusTo: null, period: 3.5 };
}
function sanitizeDemo(d, path, warn, ids) {
  const def = defaultDemo(ids.size);
  if (!isObj(d)) { warn.push(`${path}: 체험 버튼이 아니어서 뺌`); return null; }
  let id = str(d.id, LIMITS.id, `${path}.id`, warn).trim().replace(/[^\w-]/g, '-') || def.id;
  while (ids.has(id)) id = `${id}-2`;
  ids.add(id);
  const scene = {};
  if (isObj(d.scene)) {
    for (const [k, v] of Object.entries(d.scene)) {
      const r = DEMO_SCENE[k];
      if (!r) { warn.push(`${path}.scene.${k}: 바꿀 수 없는 값이라 뺌`); continue; }
      if (r === 'bool') { if (typeof v === 'boolean') scene[k] = v; else warn.push(`${path}.scene.${k}: true/false가 아니어서 뺌`); continue; }
      if (num(v)) scene[k] = clamp(v, r); else warn.push(`${path}.scene.${k}: 숫자가 아니어서 뺌`);
    }
  } else if (d.scene !== undefined && d.scene !== null) warn.push(`${path}.scene: { … }가 아니어서 비움`);
  const act = oneOf(d.act, DEMO_ACTS, 'none', `${path}.act`, warn);
  let walkTo = null;
  if (Array.isArray(d.walkTo) && d.walkTo.length === 2 && d.walkTo.every(num)) walkTo = d.walkTo.map((v) => clamp(v, [-4, 4]));
  else if (d.walkTo !== undefined && d.walkTo !== null) warn.push(`${path}.walkTo: [x, z] 숫자 2개가 아니어서 기본 자리`);
  return {
    id,
    label: str(d.label, LIMITS.demoLabel, `${path}.label`, warn, def.label) || def.label,
    tag: str(d.tag, LIMITS.demoTag, `${path}.tag`, warn),
    note: str(d.note, LIMITS.demoNote, `${path}.note`, warn),
    noteTo: str(d.noteTo, LIMITS.demoNote, `${path}.noteTo`, warn),
    act,
    camera: sanitizeCamera(d.camera, `${path}.camera`, warn),
    cameraMobile: sanitizeCamera(d.cameraMobile ?? null, `${path}.cameraMobile`, warn, { allowNull: true }),   // 휴대폰 세로 (없으면 camera)
    scene,
    walkTo,
    focusTo: isObj(d.focusTo) ? sanitizeDof(d.focusTo, `${path}.focusTo`, warn) : null,
    period: number(d.period, [1.5, 12], 3.5, `${path}.period`, warn),
  };
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
/** 자유 배치 상자: 없으면 null(정렬·세로 위치로 자동 배치) */
export function sanitizeBox(b, path, warn, { scale = true } = {}) {
  if (b === undefined || b === null) return null;
  if (!isObj(b)) { warn.push(`${path}: 상자 값이 아니어서 자동 배치`); return null; }
  const out = {};
  for (const k of ['x', 'y', 'w']) out[k] = +number(b[k], BOX_RANGES[k], k === 'w' ? 34 : 5, `${path}.${k}`, warn).toFixed(2);
  if (scale) out.scale = +number(b.scale, BOX_RANGES.scale, 1, `${path}.scale`, warn).toFixed(3);
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
  // 짧은 항목 (예: 문제 / 해결) — 작은 제목 + 한두 줄
  if (s.points !== undefined && !Array.isArray(s.points)) warn.push(`${p}.points: 목록([...])이 아니어서 비움`);
  const points = (Array.isArray(s.points) ? s.points : []).slice(0, LIMITS.points)
    .map((pt, k) => (isObj(pt) ? { label: str(pt.label, LIMITS.pointLabel, `${p}.points[${k}].label`, warn).trim(), text: str(pt.text, LIMITS.point, `${p}.points[${k}].text`, warn).trim() } : null))
    .filter((pt) => pt && (pt.label || pt.text));
  const items = (Array.isArray(media.items) ? media.items : []).slice(0, 3).map((it, k) => ({
    src: src(it?.src, `${p}.media.items[${k}].src`, warn),
    caption: str(it?.caption, LIMITS.caption, `${p}.media.items[${k}].caption`, warn),
  }));
  let sandbox = null;
  if (isObj(s.sandbox)) {
    const b = s.sandbox, d = defaultSandbox(), q = `${p}.sandbox`;
    const notes = isObj(b.notes) ? b.notes : {};
    sandbox = {
      kind: oneOf(b.kind, SANDBOX_KINDS, 'layout', `${q}.kind`, warn),
      button: str(b.button, LIMITS.sbxButton, `${q}.button`, warn, d.button) || d.button,
      title: str(b.title, LIMITS.sbxButton, `${q}.title`, warn, d.title) || d.title,
      target: oneOf(b.target, SANDBOX_TARGETS, 'rock0', `${q}.target`, warn),
      command: str(b.command, LIMITS.sbxCommand, `${q}.command`, warn),
      notes: Object.fromEntries(['command', 'direct', 'text'].map((k) => [k, str(notes[k], LIMITS.sbxNote, `${q}.notes.${k}`, warn)])),
      boxText: str(b.boxText, LIMITS.sbxButton, `${q}.boxText`, warn),
    };
  } else if (s.sandbox !== undefined && s.sandbox !== null) warn.push(`${p}.sandbox: { … }가 아니어서 뺌`);
  const demoIds = new Set();
  if (s.demos !== undefined && !Array.isArray(s.demos)) warn.push(`${p}.demos: 목록([...])이 아니어서 비움`);
  const demos = (Array.isArray(s.demos) ? s.demos : []).slice(0, LIMITS.demos).map((d, k) => sanitizeDemo(d, `${p}.demos[${k}]`, warn, demoIds)).filter(Boolean);
  let action = null;
  if (isObj(s.action)) action = { type: oneOf(s.action.type, ['explore'], 'explore', `${p}.action.type`, warn), label: str(s.action.label, LIMITS.action, `${p}.action.label`, warn, '탐험하러 가기 →') || '탐험하러 가기 →' };
  return {
    id, hidden: s.hidden === true,
    label: str(s.label, LIMITS.label, `${p}.label`, warn),
    title: str(s.title, LIMITS.title, `${p}.title`, warn),
    subtitle: str(s.subtitle, LIMITS.subtitle, `${p}.subtitle`, warn),
    body: str(s.body, LIMITS.body, `${p}.body`, warn),
    keywords: kw,
    points,
    layout: {
      align: oneOf(lay.align, ALIGNS, 'left', `${p}.layout.align`, warn),
      vertical: oneOf(lay.vertical, VERTICALS, 'bottom', `${p}.layout.vertical`, warn),
      maxWidth: number(lay.maxWidth, [240, 900], 440, `${p}.layout.maxWidth`, warn),
      box: sanitizeBox(lay.box, `${p}.layout.box`, warn),
    },
    media: { layout: mLayout, label: str(media.label, LIMITS.mediaLabel, `${p}.media.label`, warn), items, box: sanitizeBox(media.box, `${p}.media.box`, warn, { scale: false }) },
    camera: sanitizeCamera(s.camera, `${p}.camera`, warn),
    cameraMobile: sanitizeCamera(s.cameraMobile ?? null, `${p}.cameraMobile`, warn, { allowNull: true }),
    filter: sanitizeFilter(s.filter, `${p}.filter`, warn, { partial: true }),
    transition: sanitizeTransition(s.transition, `${p}.transition`, warn, { partial: true }),
    action,
    demos,
    sandbox,
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
      streaks: Math.round(number(obj.explore?.streaks, [0, 12], d.explore.streaks, 'explore.streaks', warnings)),
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
