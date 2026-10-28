// 인트로 편집 (편집 모드 `?edit`의 "인트로 편집" 탭). 코드 수정 없이 web/config/presentation.json을 고침.
// 섹션 추가·복제·삭제·순서·표시/숨김, 글·배치·자료(이미지 경로)·카메라(지금 카메라 저장 / 숫자)·필터(전체 + 섹션 덮어쓰기)·전환, 시작 설정.
// 고치는 즉시 실제 인트로 화면(글·필터)으로 미리보기 — 카메라는 평소처럼 움직이고 "현재 카메라를 이 섹션 시점으로 저장".
// 저장: 로컬 서버(/__project/presentation)가 검사·백업 후 저장. 공개 사이트(정적)에서는 저장이 꺼지고 JSON 내보내기만.
import {
  parsePresentation, serializePresentation, defaultSection, defaultPresentation, visibleSections, effectiveFilter, effectiveTransition,
  FILTER_PRESETS, FILTER_PRESET_NAMES, FILTER_RANGES, EASINGS, START_MODES, MEDIA_LAYOUTS, MEDIA_MAX,
} from '../logic/presentation_model.js';

const clone = (v) => JSON.parse(JSON.stringify(v));
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'value') e.value = v;
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
const hhmmss = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; };
const pad = (n) => String(n).padStart(2, '0');
const START_NAMES = { always: '항상 표시', first: '첫 방문만', never: '표시 안 함' };
const EASE_NAMES = { calm: '차분하게', smooth: '부드럽게', gentle: '끝만 느리게', linear: '일정하게' };
const MEDIA_NAMES = { none: '없음', single: '이미지 1장', compare: '비교 2장', cards: '작은 카드 3개' };
const FILTER_NAMES = { strength: '전체 세기', saturation: '채도', contrast: '대비', flatten: '평면화(하이라이트 누르기)', posterize: '계조 단순화', paint: '붓 느낌', outline: '윤곽선', paper: '종이 질감', vignette: '비네팅', bloom: '빛 번짐(블룸) 배율', warmth: '따뜻한/차가운 색 나눔' };
const CAM_FIELDS = [['azimuth', '방향 °', 1], ['elevation', '높이 °', 1], ['distance', '거리 H', 0.05], ['lens', '렌즈 mm', 1]];

/**
 * app: { presentation(): 인트로 런타임, store, rig, initial: presentation.json 값(없으면 null), toast, setActive(bool) }
 */
export function createIntroEditor(root, app) {
  let P = clone(app.initial ?? defaultPresentation());
  let saved = clone(P);
  let sel = 0;                                   // P.sections 안의 위치 (숨김 포함)
  let writable = false, statusNote = '저장 서버 확인 중…';
  let active = false;
  let playing = false;
  const hist = [clone(P)];
  let hi = 0;
  const pres = () => app.presentation();

  // ---------- 틀 ----------
  const msg = el('div', { class: 'edit-msg', role: 'status', 'aria-live': 'polite' });
  const badge = el('span', { class: 'edit-badge' });
  const list = el('div', { class: 'intro-list', role: 'listbox', 'aria-label': '섹션 목록' });
  const body = el('div', { class: 'intro-body' });
  const fileIn = el('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: (e) => importJSON(e.target.files[0]) });
  const saveBtn = el('button', { class: 'accent', type: 'button', onclick: () => save(), title: 'Ctrl+S' }, '저장');
  const undoBtn = el('button', { type: 'button', onclick: () => undo() }, '실행 취소');
  const redoBtn = el('button', { type: 'button', onclick: () => redo() }, '다시 실행');
  root.replaceChildren(
    el('div', { class: 'edit-row intro-top' }, badge),
    msg,
    el('div', { class: 'edit-row' },
      el('button', { type: 'button', class: 'accent', onclick: () => play(0) }, '▶ 처음부터 재생'),
      el('button', { type: 'button', onclick: () => play(previewIndex()) }, '▶ 이 섹션부터')),
    el('div', { class: 'edit-sec' }, el('div', { class: 'edit-h' }, '섹션 (위에서부터 순서)'), list,
      el('div', { class: 'edit-row' },
        el('button', { type: 'button', onclick: () => addSection() }, '+ 새 섹션'),
        el('button', { type: 'button', onclick: () => dupSection() }, '복제'),
        el('button', { type: 'button', onclick: () => moveSection(-1), title: '위로' }, '↑'),
        el('button', { type: 'button', onclick: () => moveSection(1), title: '아래로' }, '↓'),
        el('button', { type: 'button', class: 'ghost danger', onclick: () => delSection() }, '삭제'))),
    body,
    el('div', { class: 'edit-sec scope' }, el('div', { class: 'edit-h' }, '인트로 저장 — web/config/presentation.json'),
      el('div', { class: 'edit-row' }, undoBtn, redoBtn, saveBtn),
      el('div', { class: 'edit-row' },
        el('button', { type: 'button', class: 'ghost', onclick: () => revert() }, '마지막 저장으로 되돌리기'),
        el('button', { type: 'button', class: 'ghost', onclick: () => exportJSON() }, 'JSON 내보내기'),
        el('button', { type: 'button', class: 'ghost', onclick: () => fileIn.click() }, 'JSON 가져오기'), fileIn),
      el('p', { class: 'edit-note' }, '저장할 때마다 이전 파일이 web/config/backups/presentation_날짜.json으로 남아요. 잘못된 파일은 저장되지 않아요.')));

  function setMsg(kind, text) { msg.className = `edit-msg ${kind}`; msg.textContent = text; }
  const dirty = () => JSON.stringify(stripMeta(P)) !== JSON.stringify(stripMeta(saved));
  function stripMeta(v) { const c = clone(v); delete c.saved_at; delete c.saved_by; return c; }
  function renderStatus() {
    badge.textContent = dirty() ? '저장 안 된 변경 있음' : `저장됨${saved.saved_at ? ' · ' + hhmmss(saved.saved_at) : ''}`;
    badge.className = `edit-badge ${dirty() ? 'dirty' : 'clean'}`;
    saveBtn.disabled = !writable;
    saveBtn.title = writable ? 'Ctrl+S' : statusNote;
    undoBtn.disabled = hi <= 0;
    redoBtn.disabled = hi >= hist.length - 1;
  }

  // ---------- 미리보기 ----------
  /** 보이는 섹션 기준 위치 (숨긴 섹션은 미리보기에 없음) */
  function previewIndex() {
    const vis = visibleSections(P);
    const s = P.sections[sel];
    const i = vis.indexOf(s);
    return i >= 0 ? i : 0;
  }
  function refreshPreview() {
    if (!active || playing) return;
    const p = pres();
    p.setConfig(clone(P));
    p.preview(previewIndex());
  }
  /** 값 변경: live = 입력 중(이력 없음), 아니면 이력 한 단계 */
  function changed({ live = false, redraw = false } = {}) {
    if (!live) { hist.length = hi + 1; hist.push(clone(P)); if (hist.length > 80) hist.shift(); hi = hist.length - 1; }
    refreshPreview();
    if (redraw) renderAll(); else { renderList(); renderStatus(); }
  }
  function undo() { if (hi <= 0) return; hi--; P = clone(hist[hi]); sel = Math.min(sel, P.sections.length - 1); refreshPreview(); renderAll(); setMsg('info', '실행 취소'); }
  function redo() { if (hi >= hist.length - 1) return; hi++; P = clone(hist[hi]); sel = Math.min(sel, P.sections.length - 1); refreshPreview(); renderAll(); setMsg('info', '다시 실행'); }

  /** 섹션을 고르면 카메라를 그 섹션 시점으로 (그다음 평소처럼 움직여 고르고 "현재 카메라 저장") */
  function select(i, { moveCamera = true } = {}) {
    sel = Math.max(0, Math.min(P.sections.length - 1, i));
    if (moveCamera) goCamera(P.sections[sel].camera);
    refreshPreview();
    renderAll();
  }
  function goCamera(c) {
    const st = app.store;
    for (const k of ['azimuth', 'elevation', 'distance', 'lens', 'target']) st.set(`camera.${k}`, c[k], { save: false });
  }
  function currentCamera() {
    const c = app.store.settings.camera;
    return { azimuth: +c.azimuth.toFixed(2), elevation: +c.elevation.toFixed(2), distance: +c.distance.toFixed(3), lens: +c.lens.toFixed(1), target: c.target.map((v) => +v.toFixed(3)) };
  }

  // ---------- 섹션 목록 ----------
  function renderList() {
    let n = 0;
    list.replaceChildren(...P.sections.map((s, i) => {
      const num = s.hidden ? '숨김' : pad(++n);
      return el('button', { type: 'button', role: 'option', 'aria-selected': String(i === sel), class: s.hidden ? 'hidden-sec' : '', onclick: () => select(i) },
        el('span', { class: 'n' }, num), el('span', { class: 't' }, `${s.label || '—'} · ${s.title || '(제목 없음)'}`), s.action ? el('span', { class: 'tag' }, '버튼') : null);
    }));
  }
  function addSection() {
    const s = defaultSection(P.sections.length);
    s.camera = currentCamera();
    let id = `section-${P.sections.length + 1}`; while (P.sections.some((x) => x.id === id)) id += '-2';
    s.id = id;
    P.sections.splice(sel + 1, 0, s);
    sel++;
    changed({ redraw: true });
    setMsg('ok', '지금 카메라로 새 섹션을 만들었어요 (선택한 섹션 바로 뒤)');
  }
  function dupSection() {
    const s = clone(P.sections[sel]);
    let id = `${s.id}-copy`; while (P.sections.some((x) => x.id === id)) id += '-2';
    s.id = id;
    if (s.action) s.action = null;          // 탐험 버튼은 하나만 두는 걸 권장 — 복제본에서는 뺌
    P.sections.splice(sel + 1, 0, s);
    sel++;
    changed({ redraw: true });
    setMsg('ok', '섹션을 복제했어요 (탐험 버튼은 복제하지 않음)');
  }
  function delSection() {
    if (P.sections.length <= 1) { setMsg('err', '섹션이 하나뿐이라 지울 수 없어요'); return; }
    const s = P.sections[sel];
    if (!confirm(`"${s.title || s.label || s.id}" 섹션을 지울까요? (저장 전에는 실행 취소로 되돌릴 수 있어요)`)) return;
    P.sections.splice(sel, 1);
    if (!P.sections.some((x) => !x.hidden)) P.sections[0].hidden = false;
    sel = Math.min(sel, P.sections.length - 1);
    changed({ redraw: true });
    setMsg('info', '섹션을 지웠어요');
  }
  function moveSection(d) {
    const j = sel + d;
    if (j < 0 || j >= P.sections.length) return;
    [P.sections[sel], P.sections[j]] = [P.sections[j], P.sections[sel]];
    sel = j;
    changed({ redraw: true });
  }

  // ---------- 입력 칸 도우미 ----------
  function text(labelText, get, set, { area = false, rows = 3, placeholder = '' } = {}) {
    const inp = el(area ? 'textarea' : 'input', { rows: area ? rows : null, type: area ? null : 'text', placeholder, value: get() ?? '',
      oninput: (e) => { set(e.target.value); changed({ live: true }); }, onchange: () => changed() });
    return el('label', { class: 'intro-field' }, el('span', {}, labelText), inp);
  }
  function number(labelText, get, set, { step = 0.01, min, max } = {}) {
    const inp = el('input', { type: 'number', step, min, max, value: get() ?? '',
      onchange: (e) => { const v = e.target.value === '' ? undefined : +e.target.value; if (v !== undefined && !Number.isFinite(v)) return; set(v); changed({ redraw: true }); } });
    return el('label', { class: 'edit-num' }, el('span', {}, labelText), inp);
  }
  function select_(labelText, options, get, set) {
    const s = el('select', { onchange: (e) => { set(e.target.value); changed({ redraw: true }); } }, options.map(([v, t]) => el('option', { value: v }, t)));
    s.value = get();
    return el('label', { class: 'intro-field' }, el('span', {}, labelText), s);
  }
  function seg(labelText, options, get, set) {
    return el('div', { class: 'intro-field' }, el('span', {}, labelText),
      el('div', { class: 'intro-seg', role: 'radiogroup', 'aria-label': labelText }, options.map(([v, t]) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(get() === v), onclick: () => { set(v); changed({ redraw: true }); } }, t))));
  }
  function slider(key, value, onInput, { inherited = false, onClear = null } = {}) {
    const [lo, hi_] = FILTER_RANGES[key];
    const out = el('output', {}, (+value).toFixed(2));
    const r = el('input', { type: 'range', min: lo, max: hi_, step: 0.01, value, 'aria-label': FILTER_NAMES[key],
      oninput: (e) => { out.textContent = (+e.target.value).toFixed(2); onInput(+e.target.value, true); }, onchange: (e) => onInput(+e.target.value, false) });
    return el('div', { class: `intro-slider${inherited ? ' inherited' : ''}` }, el('span', {}, FILTER_NAMES[key]), r, out,
      onClear ? el('button', { type: 'button', class: 'ghost small', title: '이 섹션 덮어쓰기 지우기 (전체 값 따름)', onclick: onClear }, '×') : el('span'));
  }
  const group = (title, open, ...kids) => el('details', { class: 'intro-group', open: open || null }, el('summary', {}, title), ...kids);

  // ---------- 선택 섹션 ----------
  function renderBody() {
    const s = P.sections[sel];
    if (!s) { body.replaceChildren(); return; }
    const vis = visibleSections(P);
    const pi = vis.indexOf(s);
    const cam = s.camera;
    const eff = effectiveFilter(P, s);
    const tr = effectiveTransition(P, s);
    const mediaItems = Array.from({ length: MEDIA_MAX[s.media.layout] }, (_, k) => s.media.items[k] ?? (s.media.items[k] = { src: '', caption: '' }));
    s.media.items.length = MEDIA_MAX[s.media.layout] || s.media.items.length;
    body.replaceChildren(
      el('div', { class: 'edit-h' }, `섹션: ${pi >= 0 ? `${pad(pi + 1)} / ${pad(vis.length)}` : '숨김 (인트로에 안 나옴)'}`,
        el('label', { class: 'intro-check' }, el('input', { type: 'checkbox', checked: s.hidden || null, onchange: (e) => { s.hidden = e.target.checked; if (!P.sections.some((x) => !x.hidden)) { s.hidden = false; setMsg('err', '모든 섹션을 숨길 수는 없어요'); } changed({ redraw: true }); } }), '숨김')),
      group('글', true,
        text('작은 분류 (예: CONCEPT)', () => s.label, (v) => { s.label = v; }),
        text('큰 제목', () => s.title, (v) => { s.title = v; }, { area: true, rows: 2 }),
        text('부제 (선택)', () => s.subtitle, (v) => { s.subtitle = v; }),
        text('본문 (줄바꿈 그대로)', () => s.body, (v) => { s.body = v; }, { area: true, rows: 4 }),
        text('강조 키워드 (한 줄에 하나, 최대 8개)', () => s.keywords.join('\n'), (v) => { s.keywords = v.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 8); }, { area: true, rows: 3 }),
        el('label', { class: 'intro-check' }, el('input', { type: 'checkbox', checked: s.action ? true : null, onchange: (e) => { s.action = e.target.checked ? { type: 'explore', label: '탐험하러 가기 →' } : null; changed({ redraw: true }); } }), '이 섹션에 "탐험하러 가기" 버튼 (보통 마지막 섹션)'),
        s.action ? text('버튼 문구', () => s.action.label, (v) => { s.action.label = v; }) : null),
      group('배치', false,
        seg('가로 정렬', [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']], () => s.layout.align, (v) => { s.layout.align = v; }),
        seg('세로 위치', [['top', '위'], ['middle', '가운데'], ['bottom', '아래']], () => s.layout.vertical, (v) => { s.layout.vertical = v; }),
        number('글 최대 너비 px (240–900)', () => s.layout.maxWidth, (v) => { s.layout.maxWidth = Math.min(900, Math.max(240, v ?? 440)); }, { step: 10, min: 240, max: 900 }),
        el('p', { class: 'edit-note' }, '휴대폰 세로 화면에서는 정렬과 상관없이 아래쪽 전체 폭에 놓여요.')),
      group('이미지·자료', false,
        select_('배치', MEDIA_LAYOUTS.map((m) => [m, MEDIA_NAMES[m]]), () => s.media.layout, (v) => { s.media.layout = v; }),
        ...mediaItems.map((it, k) => el('div', { class: 'intro-media' },
          text(`${k + 1}. 이미지 경로 (web/ 기준, 예: presentation/사진.jpg)`, () => it.src, (v) => { it.src = v; }),
          text(`${k + 1}. 캡션`, () => it.caption, (v) => { it.caption = v; }))),
        s.media.layout !== 'none' ? el('p', { class: 'edit-note' }, '이미지 파일은 web/presentation/ 폴더에 넣고 경로를 적으세요. 없거나 못 읽으면 점선 칸으로 보여요.') : null),
      group('카메라 (이 섹션 시점)', true,
        el('div', { class: 'edit-row' },
          el('button', { type: 'button', class: 'accent', onclick: () => { s.camera = { ...currentCamera(), dof: s.camera.dof }; changed({ redraw: true }); setMsg('ok', '현재 카메라를 이 섹션 시점으로 저장했어요 (파일 저장은 아래 "저장")'); } }, '현재 카메라를 이 섹션 시점으로 저장'),
          el('button', { type: 'button', onclick: () => goCamera(s.camera) }, '이 시점으로 이동')),
        el('p', { class: 'edit-note' }, '오른쪽 드래그 = 돌리기 · 휠 = 거리 · 휠 버튼 드래그 = 옮기기 · 렌즈는 아래 숫자 또는 설정의 카메라 탭. 미리보기 화면의 왼쪽은 이 패널에 가려지니 "패널 접기"로 전체를 확인하세요.'),
        el('div', { class: 'edit-grid3' }, ...CAM_FIELDS.map(([k, t, st]) => number(t, () => cam[k], (v) => { cam[k] = v ?? cam[k]; goCamera(cam); }, { step: st })),
          ...['X', 'Y', 'Z'].map((ax, k) => number(`타깃 ${ax}`, () => cam.target[k], (v) => { cam.target[k] = v ?? cam.target[k]; goCamera(cam); }, { step: 0.05 }))),
        el('label', { class: 'intro-check' }, el('input', { type: 'checkbox', checked: cam.dof?.on ? true : null, onchange: (e) => { cam.dof = e.target.checked ? { on: true, focus: 'character', fstop: 4, maxBlur: 0.4 } : null; changed({ redraw: true }); } }), '심도(배경 흐림)'),
        cam.dof ? el('div', { class: 'edit-grid3' },
          select_('초점', [['character', '캐릭터'], ['fire', '모닥불'], ['target', '카메라 타깃']], () => cam.dof.focus, (v) => { cam.dof.focus = v; }),
          number('조리개 f/', () => cam.dof.fstop, (v) => { cam.dof.fstop = Math.min(16, Math.max(1.8, v ?? 4)); }, { step: 0.1 }),
          number('최대 흐림 0–1', () => cam.dof.maxBlur, (v) => { cam.dof.maxBlur = Math.min(1, Math.max(0, v ?? 0.4)); }, { step: 0.05 })) : null,
        el('div', { class: 'intro-sub' }, el('strong', {}, '휴대폰 세로 시점 (선택)'),
          el('p', { class: 'edit-note' }, s.cameraMobile ? '따로 저장된 휴대폰 시점이 있어요 (화면 가로:세로 < 0.8일 때 사용).' : '없음 — 위 시점을 그대로 씀 (세로 화면은 자동으로 조금 멀리서 봄).'),
          el('div', { class: 'edit-row' },
            el('button', { type: 'button', onclick: () => { s.cameraMobile = currentCamera(); changed({ redraw: true }); setMsg('ok', '현재 카메라를 휴대폰 세로 시점으로 저장했어요. 화면 크기를 휴대폰처럼 좁혀 맞추면 정확해요.'); } }, '현재 카메라를 휴대폰 시점으로'),
            s.cameraMobile ? el('button', { type: 'button', onclick: () => goCamera(s.cameraMobile) }, '휴대폰 시점 보기') : null,
            s.cameraMobile ? el('button', { type: 'button', class: 'ghost', onclick: () => { s.cameraMobile = null; changed({ redraw: true }); } }, '지우기') : null))),
      group('필터 (이 섹션만 덮어쓰기)', false,
        el('p', { class: 'edit-note' }, '흐린 막대 = 전체 설정 값을 따름. 움직이면 이 섹션만 바뀜(×로 되돌림).'),
        select_('프리셋 적용', [['', '— 고르면 값 복사 —'], ...Object.keys(FILTER_PRESETS).map((k) => [k, FILTER_PRESET_NAMES[k]])], () => '', (v) => { if (v) s.filter = { preset: v, ...FILTER_PRESETS[v] }; }),
        ...Object.keys(FILTER_RANGES).map((k) => slider(k, eff[k], (v, live) => { s.filter[k] = v; changed({ live }); if (!live) renderBody(); },
          { inherited: !(k in s.filter), onClear: k in s.filter ? () => { delete s.filter[k]; changed({ redraw: true }); } : null })),
        Object.keys(s.filter).length ? el('button', { type: 'button', class: 'ghost', onclick: () => { s.filter = {}; changed({ redraw: true }); } }, '이 섹션 덮어쓰기 모두 지우기') : null),
      group('전환 (이 섹션으로 올 때)', false,
        number(`카메라 이동 초 (비우면 전체 ${P.transition.camera})`, () => s.transition.camera, (v) => { if (v === undefined) delete s.transition.camera; else s.transition.camera = Math.min(6, Math.max(0, v)); }, { step: 0.05 }),
        number(`글 바뀜 초 (비우면 전체 ${P.transition.content})`, () => s.transition.content, (v) => { if (v === undefined) delete s.transition.content; else s.transition.content = Math.min(4, Math.max(0, v)); }, { step: 0.05 }),
        select_('움직임 곡선', [['', `전체 값 (${EASE_NAMES[P.transition.easing]})`], ...EASINGS.map((e) => [e, EASE_NAMES[e]])], () => s.transition.easing ?? '', (v) => { if (v) s.transition.easing = v; else delete s.transition.easing; }),
        el('p', { class: 'edit-note' }, `지금 적용: 카메라 ${tr.camera}초 · 글 ${tr.content}초 · ${EASE_NAMES[tr.easing]}`)),
      group('전체 설정 (모든 섹션 공통)', false,
        select_('시작 시 인트로 (파일 기본값)', START_MODES.map((m) => [m, START_NAMES[m]]), () => P.start.mode, (v) => { P.start.mode = v; }),
        el('p', { class: 'edit-note' }, '방문자가 설정 패널에서 고른 값이 있으면 그것이 먼저예요(그 브라우저에서만). 주소 끝 ?intro=1 = 항상, ?intro=0 = 건너뜀.'),
        el('div', { class: 'edit-grid3' },
          number('카메라 이동 초', () => P.transition.camera, (v) => { P.transition.camera = Math.min(6, Math.max(0, v ?? 1.2)); }, { step: 0.05 }),
          number('글 바뀜 초', () => P.transition.content, (v) => { P.transition.content = Math.min(4, Math.max(0, v ?? 0.9)); }, { step: 0.05 }),
          number('입력 잠금 초', () => P.transition.inputLock, (v) => { P.transition.inputLock = Math.min(2, Math.max(0, v ?? 0.25)); }, { step: 0.05 })),
        select_('움직임 곡선', EASINGS.map((e) => [e, EASE_NAMES[e]]), () => P.transition.easing, (v) => { P.transition.easing = v; }),
        el('div', { class: 'edit-grid3' },
          number('빗물 씻김 초', () => P.explore.washDuration, (v) => { P.explore.washDuration = Math.min(6, Math.max(0.6, v ?? 2.2)); }, { step: 0.1 }),
          number('물줄기 수', () => P.explore.streaks, (v) => { P.explore.streaks = Math.round(Math.min(40, Math.max(4, v ?? 16))); }, { step: 1 }),
          number('물줄기 무늬 번호', () => P.explore.seed, (v) => { P.explore.seed = Math.round(Math.min(999, Math.max(0, v ?? 7))); }, { step: 1 })),
        number('카메라 숨쉬기 °', () => P.ambient.drift, (v) => { P.ambient.drift = Math.min(2, Math.max(0, v ?? 0.25)); }, { step: 0.05 }),
        el('div', { class: 'edit-h small' }, '전체 필터'),
        select_('프리셋 적용', [['', `— 지금: ${FILTER_PRESET_NAMES[P.filter.preset] ?? P.filter.preset} —`], ...Object.keys(FILTER_PRESETS).map((k) => [k, FILTER_PRESET_NAMES[k]])], () => '', (v) => { if (v) P.filter = { preset: v, ...FILTER_PRESETS[v] }; }),
        ...Object.keys(FILTER_RANGES).map((k) => slider(k, P.filter[k], (v, live) => { P.filter[k] = v; changed({ live }); }))),
    );
  }
  function renderAll() { renderList(); renderBody(); renderStatus(); }

  // ---------- 재생 ----------
  function play(i) {
    const p = pres();
    p.setConfig(clone(P));
    playing = true;
    app.setPlaying?.(true);
    p.start(i);
    setMsg('info', '재생 중 — Esc = 편집으로 돌아가기, "탐험하러 가기"를 누르면 씻김 뒤 편집으로 돌아와요');
  }
  function stopPlay() {
    if (!playing) return;
    playing = false;
    app.setPlaying?.(false);
    pres().stop();
    refreshPreview();
    setMsg('info', '편집으로 돌아왔어요');
  }

  // ---------- 저장·가져오기 ----------
  async function save() {
    if (!writable) { setMsg('err', `저장할 수 없어요: ${statusNote}`); return; }
    const chk = parsePresentation(clone(P));
    if (!chk.ok) { setMsg('err', `저장하지 않았어요: ${chk.errors.join(' / ')}`); return; }
    saveBtn.disabled = true;
    try {
      const res = await fetch('/__project/presentation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: serializePresentation(P, { saved_by: 'intro-editor' }) });
      const out = await res.json().catch(() => ({ ok: false, error: `서버 응답 ${res.status}` }));
      if (!res.ok || !out.ok) { setMsg('err', `저장 실패: ${out.error ?? res.status}`); return; }
      P.saved_at = out.saved_at;
      saved = clone(P);
      setMsg('ok', `저장했어요 ${hhmmss(out.saved_at)} → ${out.file}${out.backup ? ` (이전 파일 백업: ${out.backup})` : ''}${chk.warnings.length ? ` · 고친 값 ${chk.warnings.length}개: ${chk.warnings[0]}` : ''}`);
    } catch (e) { setMsg('err', `저장 실패: 서버에 연결하지 못했어요 (${e.message})`); } finally { renderStatus(); }
  }
  async function revert() {
    try {
      const r = parsePresentation(await (await fetch('config/presentation.json', { cache: 'no-store' })).text());
      if (!r.ok) { setMsg('err', `저장된 파일을 읽지 못했어요: ${r.errors.join(' / ')}`); return; }
      P = r.value; saved = clone(P); sel = Math.min(sel, P.sections.length - 1);
      changed({ redraw: true });
      setMsg('ok', '마지막으로 저장한 인트로로 되돌렸어요 (실행 취소로 다시 돌아갈 수 있음)');
    } catch (e) { setMsg('err', `저장된 파일을 읽지 못했어요: ${e.message}`); }
  }
  function exportJSON() {
    const blob = new Blob([serializePresentation(P, { exported_at: new Date().toISOString() })], { type: 'application/json' });
    const a = el('a', { download: `presentation_${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}.json`, href: URL.createObjectURL(blob) });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    setMsg('info', '지금 편집 상태를 JSON으로 내보냈어요 (프로젝트 파일은 그대로). 공개 사이트에서 고친 것은 이 파일을 web/config/presentation.json에 덮어쓰면 반영돼요.');
  }
  async function importJSON(file) {
    fileIn.value = '';
    if (!file) return;
    let txt;
    try { txt = await file.text(); } catch (e) { setMsg('err', `파일을 읽지 못했어요: ${e.message}`); return; }
    const r = parsePresentation(txt);
    if (!r.ok) { setMsg('err', `가져오지 않았어요 (지금 인트로 그대로): ${r.errors.join(' / ')}`); return; }
    delete r.value.exported_at;
    P = r.value; sel = 0;
    changed({ redraw: true });
    setMsg('ok', `${file.name}을 불러왔어요 — 아직 저장 전${r.warnings.length ? ` · 고친 값 ${r.warnings.length}개` : ''}`);
  }

  fetch('/__project/status', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((s) => {
    writable = !!(s && s.writable && (s.files ?? []).some((f) => f.endsWith('presentation.json')));
    statusNote = s ? (writable ? '' : s.writable ? '서버가 인트로 저장을 모름 — 로컬 서버를 다시 켜 주세요' : '이 PC의 로컬 서버 화면에서만 저장할 수 있어요') : '저장 서버가 없어요 (정적 배포) — JSON 내보내기만 가능';
    renderStatus();
    if (!writable) setMsg('info', statusNote);
  }).catch(() => { writable = false; statusNote = '저장 서버가 없어요 (정적 배포) — JSON 내보내기만 가능'; renderStatus(); setMsg('info', statusNote); });

  renderAll();
  return {
    activate() { active = true; select(sel); },
    deactivate() { active = false; if (playing) stopPlay(); pres().stop(); },
    get active() { return active; },
    get playing() { return playing; },
    get config() { return P; },
    get dirty() { return dirty(); },
    get selected() { return sel; },
    save, undo, redo, select, play, stopPlay, exportJSON,
    importText(t, name = 'import.json') { return importJSON({ name, text: async () => t }); },
    /** 재생 중 탐험하러 가기(씻김)를 마침 → 편집으로 */
    playDone() { stopPlay(); },
    /** 검사·자동화용: 지금 카메라를 선택 섹션에 저장 */
    saveCameraToSection() { const s = P.sections[sel]; s.camera = { ...currentCamera(), dof: s.camera.dof }; changed({ redraw: true }); },
  };
}
