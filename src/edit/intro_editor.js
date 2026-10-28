// 인트로 편집 (편집 모드 `?edit`의 "인트로 편집" 탭). 코드 수정 없이 web/config/presentation.json을 고침.
// 섹션 추가·복제·삭제·순서·표시/숨김, 글·배치·자료(이미지 경로)·카메라(지금 카메라 저장 / 숫자)·필터(전체 + 섹션 덮어쓰기)·전환, 시작 설정.
// 고치는 즉시 실제 인트로 화면(글·필터)으로 미리보기.
// 구도(U-16): 감상 화면처럼 왼쪽 드래그 = 돌리기 · 휠 = 거리 · 휠 버튼 드래그 = 옮기기, 장면 클릭 = 그 자리에 초점(심도) →
//   화면 아래 구도 막대에서 조리개·흐림·렌즈 → "이 구도가 좋아요" = 카메라 + 심도를 이 섹션에 넣고 바로 파일 저장.
// 배치(U-16): 미리보기의 글·자료 상자를 PPT처럼 끌어 옮기고 크기 조절 (intro_layout.js).
// 체험 버튼(U-17): 미리보기의 체험 버튼을 누르면 그 버튼의 구도·장면을 보여 주고, 구도 막대의 "이 구도가 좋아요"가 그 버튼에 저장됨(다시 누르면 섹션 구도로).
// 저장: 로컬 서버(/__project/presentation)가 검사·백업 후 저장. 공개 사이트(정적)에서는 저장이 꺼지고 JSON 내보내기만.
import {
  parsePresentation, serializePresentation, defaultSection, defaultPresentation, visibleSections, effectiveFilter, effectiveTransition,
  FILTER_PRESETS, FILTER_PRESET_NAMES, FILTER_RANGES, EASINGS, START_MODES, MEDIA_LAYOUTS, MEDIA_MAX, DEMO_ACTS, DEMO_SCENE, defaultDemo, SANDBOX_TARGETS, defaultSandbox,
} from '../logic/presentation_model.js';
import { SCHEMA } from '../logic/store.js';
import { createIntroLayout } from './intro_layout.js';

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
const MEDIA_NAMES = { none: '없음', single: '이미지 1장', compare: '비교 2장 (사이에 →)', pair: '나란히 2장', cards: '작은 카드 3개' };
const FILTER_NAMES = { strength: '전체 세기', saturation: '채도', contrast: '대비', flatten: '평면화(하이라이트 누르기)', posterize: '계조 단순화', paint: '붓 느낌', outline: '윤곽선', paper: '종이 질감', vignette: '비네팅', bloom: '빛 번짐(블룸) 배율', warmth: '따뜻한/차가운 색 나눔' };
const FOCUS_NAMES = { character: '캐릭터', fire: '모닥불', target: '카메라 타깃', point: '클릭한 곳' };
const FSTOP = [SCHEMA.camera.dof.fstop.min, SCHEMA.camera.dof.fstop.max];
const LENS = [SCHEMA.camera.lens.min, SCHEMA.camera.lens.max];
const sameJSON = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const ACT_NAMES = { none: '구도·장면만', walk: '걷기·쉬기 되풀이', focus: '두 초점 오가기' };
const SCENE_NAMES = { 'fire.base': '불 세기', 'fire.sparks': '불티', 'fire.smoke': '연기', 'aurora.on': '오로라', 'aurora.intensity': '오로라 세기', 'aurora.speed': '오로라 속도', 'meteors.on': '유성우', 'meteors.rate': '유성우 빈도', 'rain.on': '비', 'rain.intensity': '비 세기', wind: '바람', 'stars.intensity': '별 밝기' };
const CAM_FIELDS = [['azimuth', '방향 °', 1], ['elevation', '높이 °', 1], ['distance', '거리 H', 0.05], ['lens', '렌즈 mm', 1]];

/**
 * app: { presentation(): 인트로 런타임, store, rig, presentRoot(#present), project([x,y,z]) → 화면 [px,py] | null, initial: presentation.json 값(없으면 null), toast, setPlaying(bool) }
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
  let draftDof = null;                           // 구도 막대에서 고치는 중인 심도 (저장 전) — 미리보기에 바로 보임
  let demoSel = -1, demoSide = 0;                // 구도를 고치는 체험 버튼 (-1 = 섹션 구도), 두 초점 버튼이면 0 = 첫 초점 · 1 = 두 번째 초점
  const demoOf = () => (demoSel >= 0 ? P.sections[sel]?.demos[demoSel] ?? null : null);
  /** 구도 막대가 고치는 대상: { cam, dof(저장된 심도), name } */
  function compTarget() {
    const s = P.sections[sel], d = demoOf();
    if (!d) return { cam: s.camera, dof: s.camera.dof, name: `"${s.label || s.title}" 섹션` };
    return { cam: d.camera, dof: demoSide ? d.focusTo : d.camera.dof, name: `체험 버튼 "${d.label}"${d.act === 'focus' ? (demoSide ? ' 두 번째 초점' : ' 첫 초점') : ''}` };
  }

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

  // ---------- 구도 막대 (화면 위 오른쪽, 접을 수 있음): 초점·조리개·흐림·렌즈 → 이 구도가 좋아요 ----------
  const icFocus = el('span', { class: 'ic-focus' });
  const icF = el('input', { type: 'range', min: FSTOP[0], max: FSTOP[1], step: 0.1, 'aria-label': '조리개 f값 (작을수록 많이 흐림)',
    oninput: (e) => { if (!draftDof) return; draftDof.fstop = +e.target.value; pushDraft(); } });
  const icFo = el('output');
  const icB = el('input', { type: 'range', min: 0, max: 1, step: 0.05, 'aria-label': '최대 흐림',
    oninput: (e) => { if (!draftDof) return; draftDof.maxBlur = +e.target.value; pushDraft(); } });
  const icBo = el('output');
  const icL = el('input', { type: 'range', min: LENS[0], max: LENS[1], step: 1, 'aria-label': '렌즈 mm',
    oninput: (e) => { app.store.set('camera.lens', +e.target.value, { save: false }); icLo.textContent = `${e.target.value}mm`; } });
  const icLo = el('output');
  const icOff = el('button', { type: 'button', class: 'ghost', onclick: () => { draftDof = null; pushDraft(); } }, '심도 끄기');
  const icFocusSel = el('select', { 'aria-label': '초점 대상', onchange: (e) => {
    const v = e.target.value;
    if (!v) return;
    draftDof = { on: true, focus: v, fstop: draftDof?.fstop ?? 2.8, maxBlur: draftDof?.maxBlur ?? 0.5 };
    pushDraft();
  } }, el('option', { value: '' }, '대상 고르기…'), ...['character', 'fire', 'target'].map((k) => el('option', { value: k }, FOCUS_NAMES[k])));
  const icReset = el('button', { type: 'button', class: 'ghost', title: '이 섹션에 저장된 카메라·심도로', onclick: () => resetComposition() }, '원래대로');
  const icGood = el('button', { type: 'button', class: 'accent ic-good', onclick: () => commitComposition() }, '✓ 이 구도가 좋아요');
  const icState = el('span', { class: 'ic-state' });
  const icTitle = el('strong', { class: 'ic-title' }, '구도');
  const icSide = el('button', { type: 'button', class: 'ghost', hidden: true, title: '두 초점 버튼: 첫 초점 ↔ 두 번째 초점 (각각 "이 구도가 좋아요"로 저장)', onclick: () => {
    const d = demoOf();
    if (!d) return;
    demoSide = 1 - demoSide;
    const f = demoSide ? d.focusTo ?? d.camera.dof : d.camera.dof;
    draftDof = f ? clone(f) : null;
    pushDraft();
  } });
  const icFold = el('button', { type: 'button', class: 'ghost small', title: '구도 막대 접기/펴기 (화면을 가릴 때)', onclick: () => { compose.classList.toggle('folded'); icFold.textContent = compose.classList.contains('folded') ? '펴기' : '접기'; } }, '접기');
  const marker = el('div', { class: 'intro-focus-mark', hidden: true, 'aria-hidden': 'true' });
  const compose = el('div', { class: 'intro-compose', hidden: true, role: 'toolbar', 'aria-label': '섹션 구도' },
    el('div', { class: 'ic-row end' }, icTitle, icState, icSide, icReset, icGood, icFold),
    el('div', { class: 'ic-hint' }, '왼쪽 드래그 = 돌리기 · 휠 = 거리 · 휠 버튼 드래그 = 옮기기 · ', el('b', {}, '장면 클릭 = 그 자리에 초점'), ' · 글·이미지 상자는 끌어서 옮기고 모서리로 크기'),
    el('div', { class: 'ic-row' },
      el('span', { class: 'ic-lab' }, '초점'), icFocus, icFocusSel, icOff),
    el('div', { class: 'ic-row' },
      el('label', { class: 'ic-rng' }, el('span', {}, '조리개'), icF, icFo),
      el('label', { class: 'ic-rng' }, el('span', {}, '흐림'), icB, icBo),
      el('label', { class: 'ic-rng' }, el('span', {}, '렌즈'), icL, icLo)));
  document.body.append(compose, marker);

  /** 막대·미리보기에 지금 고치는 심도 반영 */
  function pushDraft() {
    pres().setPreviewDof(draftDof);
    renderCompose();
  }
  function renderCompose() {
    const d = draftDof;
    icFocus.textContent = d ? FOCUS_NAMES[d.focus] : '없음 (심도 끔)';
    icFocusSel.value = '';
    icF.disabled = icB.disabled = icOff.disabled = !d;
    icF.value = d?.fstop ?? 2.8; icFo.textContent = `f/${(+icF.value).toFixed(1)}`;
    icB.value = d?.maxBlur ?? 0.5; icBo.textContent = `${Math.round(icB.value * 100)}%`;
    const lens = app.store.settings.camera.lens;
    if (document.activeElement !== icL) { icL.value = lens; icLo.textContent = `${Math.round(lens)}mm`; }
    const dm = demoOf();
    icTitle.textContent = dm ? `구도 · 체험 버튼 "${dm.label}"` : '구도';
    compose.classList.toggle('demo', !!dm);
    icSide.hidden = dm?.act !== 'focus';
    icSide.textContent = demoSide ? '← 첫 초점 보기' : '두 번째 초점 보기 →';
  }
  /** 저장된 구도와 다른지 (카메라·심도) */
  function compositionChanged() {
    const s = P.sections[sel];
    if (!s) return false;
    const t = compTarget();
    const c = currentCamera(), k = t.cam;
    const near = Math.abs(c.azimuth - k.azimuth) < 0.05 && Math.abs(c.elevation - k.elevation) < 0.05 && Math.abs(c.distance - k.distance) < 0.005
      && Math.abs(c.lens - k.lens) < 0.05 && c.target.every((v, i) => Math.abs(v - k.target[i]) < 0.002);
    return !near || !sameJSON(draftDof, t.dof);
  }
  function resetComposition() {
    const t = compTarget();
    goCamera(t.cam);
    draftDof = t.dof ? clone(t.dof) : null;
    pushDraft();
    setMsg('info', `${t.name}에 저장된 구도로 돌아왔어요`);
  }
  /** 이 구도가 좋아요: 지금 카메라 + 심도 → 이 섹션, 바로 파일 저장 (저장할 수 없는 곳이면 편집 내용에만) */
  async function commitComposition() {
    const s = P.sections[sel], d = demoOf(), name = compTarget().name;
    const dof = draftDof ? clone(draftDof) : null;
    if (!d) s.camera = { ...currentCamera(), dof };
    else if (demoSide) { d.camera = { ...currentCamera(), dof: d.camera.dof }; d.focusTo = dof; }   // 두 번째 초점: 카메라는 같이, 심도는 focusTo로
    else d.camera = { ...currentCamera(), dof };
    changed({ redraw: true });
    const what = draftDof ? `초점 ${FOCUS_NAMES[draftDof.focus]} f/${draftDof.fstop}` : '심도 없음';
    if (writable) { await save(); if (!dirty()) setMsg('ok', `${name} 구도를 저장했어요 (카메라 + ${what})`); }
    else setMsg('info', `구도를 이 섹션에 넣었어요 (카메라 + ${what}) — 파일 저장은 할 수 없어요: ${statusNote}`);
  }
  /** 장면 클릭 → 그 자리에 초점 (main.js가 장면을 찍어 3D 점을 줌) */
  function focusAt(point) {
    if (!active || playing) return false;
    draftDof = { on: true, focus: 'point', fstop: draftDof?.fstop ?? 2.8, maxBlur: draftDof?.maxBlur ?? 0.5, point: point.map((v) => +v.toFixed(3)) };
    pushDraft();
    return true;
  }

  // ---------- 글·자료 상자 끌어 놓기 ----------
  const layout = app.presentRoot ? createIntroLayout({
    root: app.presentRoot, pres,
    getBox: (kind) => { const s = P.sections[sel]; return s ? (kind === 'text' ? s.layout.box : s.media.box) : null; },
    onChange: (kind, box, live) => {
      const s = P.sections[sel];
      if (!s) return;
      const wasFree = !!(kind === 'text' ? s.layout.box : s.media.box);
      if (kind === 'text') s.layout.box = box; else s.media.box = box;
      if (live) { if (!wasFree) pres().setConfig(clone(P)); return; }      // 자동 → 자유: 그 자리 그대로 다시 그림
      changed({ redraw: true });
    },
  }) : null;

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
    if (moveCamera || i !== sel) { demoSel = -1; demoSide = 0; }
    sel = Math.max(0, Math.min(P.sections.length - 1, i));
    if (moveCamera) { goCamera(P.sections[sel].camera); draftDof = P.sections[sel].camera.dof ? clone(P.sections[sel].camera.dof) : null; }
    refreshPreview();
    pres().setPreviewDof(draftDof);
    renderCompose();
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

  /** 미리보기에서 체험 버튼을 누름(인트로 런타임이 알려 줌): 그 버튼 구도를 보여 주고 구도 막대가 그 버튼을 고침. k < 0 = 꺼짐 → 섹션 구도로 */
  function demoPicked(d, k) {
    if (!active || playing) return;
    demoSel = d ? k : -1; demoSide = 0;
    const t = compTarget();
    goCamera(t.cam);
    draftDof = t.dof ? clone(t.dof) : null;
    pushDraft();
    renderBody();
    setMsg('info', d ? `체험 버튼 "${d.label}" 구도예요 — 고친 뒤 "이 구도가 좋아요"를 누르면 이 버튼에 저장돼요 (버튼을 다시 누르면 섹션 구도로)` : '섹션 구도로 돌아왔어요');
  }
  /** 체험 버튼 묶음 (섹션 안) */
  function demoGroup(s) {
    const move = (k, dd) => { const j = k + dd; if (j < 0 || j >= s.demos.length) return; [s.demos[k], s.demos[j]] = [s.demos[j], s.demos[k]]; pres().endDemo(); demoSel = -1; changed({ redraw: true }); };
    const show = (k) => { if (pres().mode !== 'preview') refreshPreview(); pres().toggleDemo(k); };
    return group(`체험 버튼 (${s.demos.length}/8)`, s.demos.length > 0,
      el('p', { class: 'edit-note' }, '방문자가 눌러 기능을 바로 볼 수 있는 버튼이에요. 누르면 그 버튼의 구도로 옮기고 장면 값(비·오로라·불 등)을 잠깐 바꿔요 — 저장된 설정은 그대로, 섹션을 떠나면 원래대로. 미리보기의 버튼을 누르면 그 버튼 구도를 고칠 수 있어요(구도 막대 → 이 구도가 좋아요).'),
      ...s.demos.map((d, k) => el('div', { class: `intro-sub${k === demoSel ? ' picked' : ''}` },
        el('div', { class: 'edit-row' }, el('strong', {}, `${pad(k + 1)} ${d.label}`),
          el('button', { type: 'button', class: k === demoSel ? 'accent' : '', onclick: () => show(k) }, k === demoSel ? '끄기' : '보기·구도 고치기'),
          el('button', { type: 'button', title: '위로', onclick: () => move(k, -1) }, '↑'),
          el('button', { type: 'button', title: '아래로', onclick: () => move(k, 1) }, '↓'),
          el('button', { type: 'button', class: 'ghost danger', onclick: () => { if (!confirm(`체험 버튼 "${d.label}"을 지울까요?`)) return; pres().endDemo(); demoSel = -1; s.demos.splice(k, 1); changed({ redraw: true }); } }, '삭제')),
        el('div', { class: 'edit-grid3' },
          text('버튼 이름', () => d.label, (v) => { d.label = v; }),
          text('작은 영문 꼬리표', () => d.tag, (v) => { d.tag = v; }),
          select_('동작', DEMO_ACTS.map((a) => [a, ACT_NAMES[a]]), () => d.act, (v) => { d.act = v; if (v === 'focus' && !d.focusTo) d.focusTo = { on: true, focus: 'character', fstop: 8, maxBlur: d.camera.dof?.maxBlur ?? 0.6 }; })),
        text(d.act === 'focus' ? '설명 (첫 초점일 때)' : '설명 한 줄', () => d.note, (v) => { d.note = v; }),
        d.act === 'focus' ? text('설명 (두 번째 초점일 때)', () => d.noteTo, (v) => { d.noteTo = v; }) : null,
        d.act === 'focus' ? number('초점 바뀌는 간격 초', () => d.period, (v) => { d.period = Math.min(12, Math.max(1.5, v ?? 3.5)); }, { step: 0.5 }) : null,
        d.act === 'walk' ? el('div', { class: 'edit-grid3' },
          number('걸어갈 곳 X', () => d.walkTo?.[0], (v) => { d.walkTo = v === undefined ? null : [v, d.walkTo?.[1] ?? 0]; }, { step: 0.05 }),
          number('걸어갈 곳 Z', () => d.walkTo?.[1], (v) => { d.walkTo = v === undefined ? null : [d.walkTo?.[0] ?? 0, v]; }, { step: 0.05 })) : null,
        el('div', { class: 'edit-h small' }, '바꿀 장면 값 (비우면 그대로)'),
        el('div', { class: 'edit-grid3' }, ...Object.entries(DEMO_SCENE).map(([key, r]) => (r === 'bool'
          ? select_(SCENE_NAMES[key], [['', '그대로'], ['true', '켜기'], ['false', '끄기']], () => (key in d.scene ? String(d.scene[key]) : ''), (v) => { if (v) d.scene[key] = v === 'true'; else delete d.scene[key]; })
          : number(`${SCENE_NAMES[key]} ${r[0]}–${r[1]}`, () => d.scene[key], (v) => { if (v === undefined) delete d.scene[key]; else d.scene[key] = Math.min(r[1], Math.max(r[0], v)); }, { step: 0.05 })))))),
      s.demos.length < 8 ? el('button', { type: 'button', onclick: () => {
        const d = defaultDemo(s.demos.length);
        let id = d.id; while (s.demos.some((x) => x.id === id)) id += '-2';
        d.id = id; d.camera = { ...currentCamera(), dof: draftDof ? clone(draftDof) : null };
        s.demos.push(d);
        changed({ redraw: true });
        setMsg('ok', '지금 구도로 새 체험 버튼을 만들었어요 — 이름·설명·장면 값을 고르세요');
      } }, '+ 체험 버튼 (지금 구도로)') : null);
  }

  /** 체험 패널 (U-18): 글 상자의 "직접 해 보기" 버튼으로 여는 ① 글로 시키기 ② 직접 옮기기 ③ 글 상자 */
  function sandboxGroup(s) {
    const b = s.sandbox;
    const TARGET_NAMES = { rock0: '바위 1', rock1: '바위 2', rock2: '바위 3', rock3: '바위 4', tent: '텐트', guitar_case: '기타 케이스' };
    return group('체험 패널 (직접 해 보기)', !!b,
      el('label', { class: 'intro-check' }, el('input', { type: 'checkbox', checked: b ? true : null, onchange: (e) => { s.sandbox = e.target.checked ? defaultSandbox() : null; changed({ redraw: true }); } }), '이 섹션에 체험 패널 버튼'),
      el('p', { class: 'edit-note' }, '방문자가 버튼을 누르면 오른쪽에 패널이 열려요: ① 예시 명령이 타자 치듯 써지고 실행하면 물체가 움직임 ② 편집 모드처럼 기즈모로 옮기기·돌리기·크기 ③ 글 상자 만들어 끌고 크기 바꾸기. 모두 미리보기라 닫거나 섹션을 떠나면 원래대로. 재생(▶)에서만 열려요.'),
      b ? el('div', { class: 'edit-grid3' },
        text('버튼 이름', () => b.button, (v) => { b.button = v; }),
        text('패널 제목', () => b.title, (v) => { b.title = v; }),
        select_('처음 고른 물체', SANDBOX_TARGETS.filter((id) => TARGET_NAMES[id] || id.startsWith('grass')).map((id) => [id, TARGET_NAMES[id] ?? `풀 ${+id.slice(5) + 1}`]), () => b.target, (v) => { b.target = v; })) : null,
      b ? text('① 예시 명령 (타자 치듯 써짐)', () => b.command, (v) => { b.command = v; }) : null,
      b ? text('① 설명', () => b.notes.command, (v) => { b.notes.command = v; }, { area: true, rows: 2 }) : null,
      b ? text('② 설명', () => b.notes.direct, (v) => { b.notes.direct = v; }, { area: true, rows: 2 }) : null,
      b ? text('③ 설명', () => b.notes.text, (v) => { b.notes.text = v; }, { area: true, rows: 2 }) : null,
      b ? text('③ 새 글 상자 기본 글', () => b.boxText, (v) => { b.boxText = v; }) : null);
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
  /** 자유 배치 상자 숫자 (없으면 자동 배치 안내) */
  function boxFields(title, b, withScale, onAuto) {
    if (!b) return el('div', { class: 'intro-sub' }, el('strong', {}, title), el('p', { class: 'edit-note' }, withScale ? '자동 배치 (위 정렬·세로 위치). 화면에서 끌면 자유 배치가 돼요.' : '글 아래에 같이 놓임. 화면에서 이미지를 끌면 따로 떨어진 상자가 돼요.'));
    const put = (k, lo, hi) => (v) => { if (v !== undefined) b[k] = Math.min(hi, Math.max(lo, v)); };
    return el('div', { class: 'intro-sub' }, el('strong', {}, `${title} — 자유 배치 (화면 %)`),
      el('div', { class: 'edit-grid3' },
        number('왼쪽 x %', () => b.x, put('x', -10, 100), { step: 0.5 }),
        number('위 y %', () => b.y, put('y', -10, 100), { step: 0.5 }),
        number('너비 %', () => b.w, put('w', 8, 100), { step: 0.5 }),
        withScale ? number('글 크기 배율', () => b.scale, put('scale', 0.4, 3), { step: 0.05 }) : null),
      el('button', { type: 'button', class: 'ghost', onclick: onAuto }, '자동 배치로 되돌리기'));
  }
  const group = (title, open, ...kids) => el('details', { class: 'intro-group', open: open || null }, el('summary', {}, title), ...kids);

  /** 패널에서 저장된 심도를 바꾸면 구도 막대(미리보기)도 같은 값으로 */
  function syncDraft() { const d = P.sections[sel]?.camera.dof; draftDof = d ? clone(d) : null; pres().setPreviewDof(draftDof); renderCompose(); }

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
        text('짧은 항목 (한 줄에 하나 "제목 | 내용", 최대 4개 — 예: 문제 | …)', () => s.points.map((pt) => `${pt.label} | ${pt.text}`).join('\n'),
          (v) => { s.points = v.split('\n').map((ln) => { const i = ln.indexOf('|'); return i < 0 ? { label: '', text: ln.trim() } : { label: ln.slice(0, i).trim().slice(0, 12), text: ln.slice(i + 1).trim().slice(0, 200) }; }).filter((pt) => pt.label || pt.text).slice(0, 4); }, { area: true, rows: 3 }),
        text('강조 키워드 (한 줄에 하나, 최대 8개)', () => s.keywords.join('\n'), (v) => { s.keywords = v.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 8); }, { area: true, rows: 3 }),
        el('label', { class: 'intro-check' }, el('input', { type: 'checkbox', checked: s.action ? true : null, onchange: (e) => { s.action = e.target.checked ? { type: 'explore', label: '탐험하러 가기 →' } : null; changed({ redraw: true }); } }), '이 섹션에 "탐험하러 가기" 버튼 (보통 마지막 섹션)'),
        s.action ? text('버튼 문구', () => s.action.label, (v) => { s.action.label = v; }) : null),
      demoGroup(s),
      sandboxGroup(s),
      group('배치', false,
        seg('가로 정렬', [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']], () => s.layout.align, (v) => { s.layout.align = v; }),
        seg('세로 위치', [['top', '위'], ['middle', '가운데'], ['bottom', '아래']], () => s.layout.vertical, (v) => { s.layout.vertical = v; }),
        number('글 최대 너비 px (240–900)', () => s.layout.maxWidth, (v) => { s.layout.maxWidth = Math.min(900, Math.max(240, v ?? 440)); }, { step: 10, min: 240, max: 900 }),
        el('p', { class: 'edit-note' }, '화면의 글·이미지 상자를 끌면 그 자리에 놓이고(자유 배치), 모서리 점 = 크기(글자도 같이), 좌우 점 = 너비만. 상자를 고른 뒤 방향키 = 조금씩(Shift = 크게), Alt를 누른 채 끌면 맞춤선에 붙지 않아요. 휴대폰 세로 화면에서는 항상 자동 배치(아래쪽 전체 폭)예요.'),
        boxFields('글 상자', s.layout.box, true, () => { s.layout.box = null; changed({ redraw: true }); }),
        s.media.layout !== 'none' ? boxFields('자료(이미지) 상자', s.media.box, false, () => { s.media.box = null; changed({ redraw: true }); }) : null),
      group('이미지·자료', false,
        select_('배치', MEDIA_LAYOUTS.map((m) => [m, MEDIA_NAMES[m]]), () => s.media.layout, (v) => { s.media.layout = v; }),
        s.media.layout !== 'none' ? text('자료 위 작은 제목 (선택, 예: 결과 자료)', () => s.media.label, (v) => { s.media.label = v; }) : null,
        ...mediaItems.map((it, k) => el('div', { class: 'intro-media' },
          text(`${k + 1}. 이미지 경로 (web/ 기준, 예: presentation/사진.jpg)`, () => it.src, (v) => { it.src = v; }),
          text(`${k + 1}. 캡션`, () => it.caption, (v) => { it.caption = v; }))),
        s.media.layout !== 'none' ? el('p', { class: 'edit-note' }, '이미지 파일은 web/presentation/ 폴더에 넣고 경로를 적으세요. 없거나 못 읽으면 점선 칸으로 보여요.') : null),
      group('카메라 (이 섹션 시점)', true,
        el('div', { class: 'edit-row' },
          el('button', { type: 'button', class: 'accent', onclick: () => commitComposition() }, '✓ 이 구도가 좋아요 (카메라·심도 저장)'),
          el('button', { type: 'button', onclick: () => resetComposition() }, '저장된 구도로')),
        el('p', { class: 'edit-note' }, '감상 화면처럼 왼쪽 드래그 = 돌리기 · 휠 = 거리 · 휠 버튼 드래그 = 옮기기. 장면을 클릭하면 그 자리에 초점이 맞고, 화면 아래 구도 막대에서 조리개·흐림·렌즈를 고른 뒤 "이 구도가 좋아요"를 누르면 이 섹션에 들어가고 파일까지 저장돼요. 같은 카메라로 초점만 다른 섹션을 이어 두면 넘길 때 초점이 옮겨 가요(예: 기타 → 캐릭터). 미리보기 왼쪽은 이 패널에 가려지니 "접기"로 전체를 확인하세요.'),
        el('div', { class: 'edit-grid3' }, ...CAM_FIELDS.map(([k, t, st]) => number(t, () => cam[k], (v) => { cam[k] = v ?? cam[k]; goCamera(cam); }, { step: st })),
          ...['X', 'Y', 'Z'].map((ax, k) => number(`타깃 ${ax}`, () => cam.target[k], (v) => { cam.target[k] = v ?? cam.target[k]; goCamera(cam); }, { step: 0.05 }))),
        el('div', { class: 'edit-h small' }, '저장된 심도 (숫자로 고치기)'),
        el('label', { class: 'intro-check' }, el('input', { type: 'checkbox', checked: cam.dof?.on ? true : null, onchange: (e) => { cam.dof = e.target.checked ? { on: true, focus: 'character', fstop: 4, maxBlur: 0.4 } : null; syncDraft(); changed({ redraw: true }); } }), '심도(배경 흐림)'),
        cam.dof ? el('div', { class: 'edit-grid3' },
          select_('초점', [['character', '캐릭터'], ['fire', '모닥불'], ['target', '카메라 타깃'], ...(cam.dof.point ? [['point', '클릭한 곳']] : [])], () => cam.dof.focus, (v) => { cam.dof.focus = v; syncDraft(); }),
          number('조리개 f/', () => cam.dof.fstop, (v) => { cam.dof.fstop = Math.min(16, Math.max(1.8, v ?? 4)); syncDraft(); }, { step: 0.1 }),
          number('최대 흐림 0–1', () => cam.dof.maxBlur, (v) => { cam.dof.maxBlur = Math.min(1, Math.max(0, v ?? 0.4)); syncDraft(); }, { step: 0.05 })) : null,
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
          number('번짐 전환 초', () => P.explore.washDuration, (v) => { P.explore.washDuration = Math.min(6, Math.max(0.6, v ?? 2.2)); }, { step: 0.1 }),
          number('작은 번짐 수', () => P.explore.streaks, (v) => { P.explore.streaks = Math.round(Math.min(12, Math.max(0, v ?? 5))); }, { step: 1 }),
          number('번짐 무늬 번호', () => P.explore.seed, (v) => { P.explore.seed = Math.round(Math.min(999, Math.max(0, v ?? 7))); }, { step: 1 })),
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
    compose.hidden = true; marker.hidden = true;
    p.start(i);
    setMsg('info', '재생 중 — Esc = 편집으로 돌아가기, "탐험하러 가기"를 누르면 씻김 뒤 편집으로 돌아와요');
  }
  function stopPlay() {
    if (!playing) return;
    playing = false;
    app.setPlaying?.(false);
    pres().stop();
    compose.hidden = !active;
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
    activate() { active = true; compose.hidden = false; layout?.setOn(true); select(sel); },
    deactivate() { demoSel = -1; demoSide = 0; active = false; compose.hidden = true; marker.hidden = true; layout?.setOn(false); pres().setPreviewDof(null); if (playing) stopPlay(); pres().stop(); },
    focusAt, commitComposition, resetComposition, demoPicked,
    get demoSel() { return demoSel; },
    get draftDof() { return draftDof; },
    get layout() { return layout; },
    /** 매 프레임 (편집기 update에서): 클릭 초점 표시 위치, 구도 바뀜 표시 */
    update() {
      if (!active || playing) { marker.hidden = true; return; }
      const d = draftDof;
      const p = d?.focus === 'point' && d.point ? app.project?.(d.point) : null;
      marker.hidden = !p;
      if (p) { marker.style.left = `${p[0]}px`; marker.style.top = `${p[1]}px`; }
      const ch = compositionChanged();
      if (compose.classList.contains('changed') !== ch || !icState.textContent) { compose.classList.toggle('changed', ch); icState.textContent = ch ? '저장된 구도와 다름' : '저장된 구도 그대로'; }
      if (document.activeElement !== icL) { const lens = app.store.settings.camera.lens; if (+icL.value !== Math.round(lens)) { icL.value = lens; icLo.textContent = `${Math.round(lens)}mm`; } }
    },
    get active() { return active; },
    get playing() { return playing; },
    get config() { return P; },
    get dirty() { return dirty(); },
    get selected() { return sel; },
    save, undo, redo, select, play, stopPlay, exportJSON,
    importText(t, name = 'import.json') { return importJSON({ name, text: async () => t }); },
    /** 재생 중 탐험하러 가기(씻김)를 마침 → 편집으로 */
    playDone() { stopPlay(); },
    /** 검사·자동화용: 지금 카메라(+ 구도 막대 심도)를 선택 섹션에 넣음 (파일 저장 없음) */
    saveCameraToSection() { const s = P.sections[sel]; s.camera = { ...currentCamera(), dof: draftDof ? clone(draftDof) : null }; changed({ redraw: true }); },
  };
}
