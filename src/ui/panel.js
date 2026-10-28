// 설정 패널 (F10): PC는 오른쪽 위 접이식, 모바일(폭 < 700px)은 아래 시트(접힘·절반·펼침). 탭 4개(장면·카메라·화면·품질), 기본 + "고급" 접기.
// 패널은 store만 바꾸고(값 검증은 store), 화면 상태(비 남은 시간·적용 품질 등)는 app 훅으로 읽어 표시한다.
// 정규화 세기는 물리 단위처럼 표시하지 않는다(0–100 또는 소수). 단위가 있는 것만 단위를 붙임: 렌즈 mm, 거리 H, 초점 거리 m(가상), 각도 °, 노출 EV.
import { PRESETS } from '../logic/store.js';

const pct = (v) => `${Math.round(v * 100)}`;
const f2 = (v) => v.toFixed(2);
const RANGE = (path, label, min, max, step, fmt = f2) => ({ t: 'range', path, label, min, max, step, fmt });
const TOGGLE = (path, label) => ({ t: 'toggle', path, label });
// effectsOff.* 는 저장값이 '끄기'(true = 끔) — 화면에는 '효과 — 사용 / 사용 안 함'으로 뒤집어 보여 줌 (저장 형식·의미는 그대로, PUB-02)
const EFFECT = (key, label) => ({ t: 'toggle', path: `quality.effectsOff.${key}`, label, invert: true });
const SEG = (path, label, options) => ({ t: 'seg', path, label, options });

const TABS = [
  { id: 'scene', label: '장면',
    basic: [RANGE('scene.fire.base', '불 세기', 0, 1.5, 0.05), RANGE('scene.stars.intensity', '별 밝기', 0, 1, 0.05, pct), TOGGLE('scene.aurora.on', '오로라'),
      TOGGLE('scene.rain.on', '비'), SEG('scene.rain.duration', '비 시간', [[30, '30초'], [60, '60초'], ['loop', '연속']]), { t: 'status', id: 'rain' }],
    adv: [RANGE('scene.fire.flicker', '불 일렁임', 0, 1, 0.05, pct), RANGE('scene.fire.sparks', '불티', 0, 1, 0.05, pct), RANGE('scene.fire.smoke', '연기', 0, 1, 0.05, pct),
      RANGE('scene.aurora.intensity', '오로라 세기', 0, 1, 0.05, pct), RANGE('scene.aurora.speed', '오로라 속도', 0, 1, 0.05, pct), RANGE('scene.rain.intensity', '비 세기', 0, 1, 0.05, pct),
      RANGE('scene.wind', '약한 바람', 0, 1, 0.05, pct), TOGGLE('scene.weatherLink', '날씨와 하늘 연동')] },
  { id: 'camera', label: '카메라',
    basic: [{ t: 'mode' }, RANGE('camera.lens', '렌즈 (mm)', 24, 85, 1, (v) => `${Math.round(v)}`), RANGE('camera.distance', '카메라 거리 (H)', 3.5, 16, 0.1, (v) => v.toFixed(1)),
      SEG('camera.focus.mode', '초점', [['character', '캐릭터'], ['fire', '모닥불'], ['point', '화면 클릭'], ['manual', '수동']]), TOGGLE('camera.dof.on', '심도')],
    adv: [RANGE('camera.elevation', '높이 (°, 0 = 수평)', 0, 70, 1, (v) => `${Math.round(v)}`), RANGE('camera.azimuth', '방향 (°)', -180, 180, 1, (v) => `${Math.round(v)}`),
      { t: 'targetY', label: '타깃 높이 (H)' }, RANGE('camera.dof.fstop', '가상 조리개 f/', 1.8, 16, 0.1, (v) => v.toFixed(1)),
      RANGE('camera.dof.maxBlur', '최대 흐림량', 0, 1, 0.05, pct), RANGE('camera.focus.distanceM', '초점 거리 (m, 가상)', 0.1, 10, 0.05, (v) => v.toFixed(2)),
      { t: 'note', text: '가상 조리개: 가상 센서(36×24 mm)·축척(1H = 15 cm)으로 계산한 심도 근사입니다. 노출은 바뀌지 않습니다.' },
      { t: 'slots' }, { t: 'photoActions' }] },
  { id: 'screen', label: '화면',
    basic: [RANGE('screen.exposure', '노출 (EV)', -2, 2, 0.05, (v) => (v > 0 ? '+' : '') + v.toFixed(2)), RANGE('screen.bloom', '블룸', 0, 1.5, 0.05, f2),
      RANGE('screen.temperature', '색감 (차갑게 ↔ 따뜻하게)', -1, 1, 0.05, f2)],
    adv: [RANGE('screen.contrast', '대비', -0.5, 0.5, 0.05, f2), RANGE('screen.saturation', '채도', -0.5, 0.5, 0.05, f2), RANGE('screen.vignette', '비네팅', 0, 0.6, 0.02, f2),
      TOGGLE('screen.grain.on', '필름 그레인'), RANGE('screen.grain.amount', '그레인 세기', 0, 0.6, 0.02, f2)] },
  { id: 'quality', label: '품질',
    basic: [SEG('quality.mode', '품질', [['auto', '자동'], ['high', '높음'], ['medium', '중간'], ['low', '낮음']]), { t: 'status', id: 'quality' }],
    adv: [{ t: 'note', text: '화면이 무거울 때 효과를 하나씩 끌 수 있어요.' },
      EFFECT('sparks', '불티 효과'), EFFECT('smoke', '연기 효과'), EFFECT('splashes', '물 튀김 효과'),
      EFFECT('aurora', '오로라 효과'), EFFECT('dof', '심도 효과'), EFFECT('shadows', '그림자'), EFFECT('ao', '접촉 음영')] },
];

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};

/**
 * app 훅: { rainStatus(): string, qualityStatus(): string, savePNG(), setUIHidden(bool), isPaused(), setPaused(bool) }
 */
export function createPanel(root, store, app) {
  const S = () => store.settings;
  const get = (p) => store.get(p);
  const refreshers = [];
  let tab = 'scene';
  let sheet = 'collapsed';      // 모바일 시트: collapsed | half | full
  let open = false;             // PC 접이식

  const panel = el('section', { class: 'panel', 'aria-label': '설정' });
  const toggleBtn = el('button', { class: 'panel-toggle', 'aria-label': '설정 열기', 'aria-expanded': 'false', title: '설정', onclick: () => setOpen(!open) },
    el('span', { 'aria-hidden': 'true' }, '⚙'));
  const handle = el('button', { class: 'sheet-handle', 'aria-label': '설정 시트 크기 바꾸기', onclick: () => setSheet(sheet === 'collapsed' ? 'half' : sheet === 'half' ? 'full' : 'collapsed') }, el('span'));
  const tabsRow = el('div', { class: 'tabs', role: 'tablist' });
  const body = el('div', { class: 'panel-body' });
  const foot = el('div', { class: 'panel-foot' });
  panel.append(handle, tabsRow, body, foot);
  root.append(toggleBtn, panel);

  function setOpen(v) { open = v; root.classList.toggle('open', v); toggleBtn.setAttribute('aria-expanded', String(v)); toggleBtn.setAttribute('aria-label', v ? '설정 닫기' : '설정 열기'); }
  function setSheet(v) { sheet = v; root.dataset.sheet = v; }
  setSheet('collapsed');

  function control(c) {
    if (c.t === 'range') {
      const id = 'c_' + c.path.replace(/\./g, '_');
      const out = el('output', { for: id });
      const inp = el('input', { id, type: 'range', min: c.min, max: c.max, step: c.step,
        oninput: (e) => { store.set(c.path, +e.target.value, { save: false }); out.textContent = c.fmt(get(c.path)); },
        onchange: () => store.save() });
      const r = () => { const v = get(c.path); inp.value = v; out.textContent = c.fmt(v); };
      refreshers.push(r); r();
      return el('label', { class: 'row range', for: id }, el('span', { class: 'lab' }, c.label), inp, out);
    }
    if (c.t === 'toggle') {
      const labId = 'l_' + c.path.replace(/\./g, '_');
      // 이름 = 설정 이름(“비”), 상태 = aria-checked (보이는 글자 “켜짐/꺼짐”이 이름이 되지 않게)
      const b = el('button', { class: 'tog', type: 'button', role: 'switch', 'aria-label': c.label, onclick: () => store.set(c.path, !get(c.path)) });
      // 스위치 상태 = 보이는 이름의 상태 (invert: 저장값 true(끔) → '사용 안 함')
      const r = () => { const on = c.invert ? !get(c.path) : !!get(c.path); b.setAttribute('aria-checked', String(on)); b.textContent = c.invert ? (on ? '사용' : '사용 안 함') : (on ? '켜짐' : '꺼짐'); };
      refreshers.push(r); r();
      return el('div', { class: 'row' }, el('span', { class: 'lab', id: labId }, c.label), b);
    }
    if (c.t === 'seg') {
      const g = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': c.label });
      const btns = c.options.map(([v, text]) => {
        const b = el('button', { type: 'button', role: 'radio', onclick: () => store.set(c.path, v) }, text);
        b._v = v; g.append(b); return b;
      });
      const r = () => { for (const b of btns) b.setAttribute('aria-checked', String(get(c.path) === b._v)); };
      refreshers.push(r); r();
      return el('div', { class: 'row col' }, el('span', { class: 'lab' }, c.label), g);
    }
    if (c.t === 'status') {
      const s = el('div', { class: 'status', 'aria-live': 'polite' });
      refreshers.push(() => { s.textContent = c.id === 'rain' ? app.rainStatus() : app.qualityStatus(); });
      return s;
    }
    if (c.t === 'mode') {
      const g = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': '모드' });
      const bv = el('button', { role: 'radio', onclick: () => store.exitPhoto() }, '감상');
      const bp = el('button', { role: 'radio', onclick: () => store.enterPhoto() }, '촬영');
      g.append(bv, bp);
      refreshers.push(() => { bv.setAttribute('aria-checked', String(!store.photo.active)); bp.setAttribute('aria-checked', String(store.photo.active)); });
      return el('div', { class: 'row col' }, el('span', { class: 'lab' }, '모드'), g);
    }
    if (c.t === 'targetY') {
      const out = el('output');
      const inp = el('input', { type: 'range', min: 0, max: 2.5, step: 0.05, 'aria-label': c.label,
        oninput: (e) => { const t = [...S().camera.target]; t[1] = +e.target.value; store.set('camera.target', t, { save: false }); out.textContent = t[1].toFixed(2); },
        onchange: () => store.save() });
      refreshers.push(() => { inp.value = S().camera.target[1]; out.textContent = S().camera.target[1].toFixed(2); });
      return el('label', { class: 'row range' }, el('span', { class: 'lab' }, c.label), inp, out);
    }
    if (c.t === 'note') return el('p', { class: 'note' }, c.text);
    if (c.t === 'slots') {
      const wrap = el('div', { class: 'slots' });
      for (let i = 0; i < 3; i++) {
        const load = el('button', { onclick: () => store.loadSlot(i) }, `시점 ${i + 1}`);
        const save = el('button', { class: 'ghost', onclick: () => { store.saveSlot(i); app.toast?.(`시점 ${i + 1}에 저장 (카메라·화면 효과)`); } }, '저장');
        refreshers.push(() => { load.disabled = !store.photo.slots[i]; });
        wrap.append(el('div', { class: 'slot' }, load, save));
      }
      return el('div', { class: 'row col' }, el('span', { class: 'lab' }, '시점 저장 (카메라·화면 효과만, 날씨 제외)'), wrap);
    }
    if (c.t === 'photoActions') {
      // 사진 저장·일시 정지·UI 숨기기는 촬영 모드 위쪽 막대로 옮김 (ui/hud.js, PUB-02) — 여기는 촬영 구도를 감상에도 쓰는 버튼만
      const apply = el('button', { type: 'button', onclick: () => { store.applyPhotoToView(); app.toast?.('감상 화면에도 적용했어요'); } }, '감상 화면에도 적용');
      refreshers.push(() => { apply.disabled = !store.photo.active; });
      return el('div', { class: 'row col' }, el('div', { class: 'actions' }, apply), el('p', { class: 'note' }, '사진 저장·일시 정지·UI 숨기기는 촬영 모드에서 화면 위쪽 막대에 있어요.'));
    }
    return null;
  }

  function renderTab() {
    body.replaceChildren();
    const t = TABS.find((x) => x.id === tab);
    refreshers.length = 0;
    body.append(...t.basic.map(control));
    if (t.adv.length) {
      const det = el('details', { class: 'adv' }, el('summary', {}, '고급'));
      det.append(...t.adv.map(control));
      body.append(det);
    }
    for (const b of tabsRow.children) b.setAttribute('aria-selected', String(b._id === tab));
    refresh();
  }
  for (const t of TABS) {
    const b = el('button', { role: 'tab', onclick: () => { tab = t.id; renderTab(); if (sheet === 'collapsed') setSheet('half'); } }, t.label);
    b._id = t.id;
    tabsRow.append(b);
  }
  // 프리셋·초기화 (변경 범위를 이름 옆에 표시)
  const SCOPE = { camera: '카메라', screen: '화면', scene: '환경' };
  const presetRow = el('div', { class: 'presets' }, ...PRESETS.map((p) => el('button', { title: `바꾸는 것: ${p.changes.map((c) => SCOPE[c]).join('·')}`, onclick: () => { store.applyPreset(p.id); app.toast?.(`${p.name} — ${p.changes.map((c) => SCOPE[c]).join('·')} 변경`); } }, p.name)));
  const resetRow = el('div', { class: 'resets' },
    el('button', { class: 'ghost', title: '첫 화면 구도로 (편집 모드에서 저장한 첫 화면, 없으면 기본 구도)', onclick: () => store.reset('camera') }, '카메라 초기화'),
    el('button', { class: 'ghost', onclick: () => store.reset('envScreen') }, '환경·화면 기본값'),
    el('button', { class: 'ghost danger', onclick: () => { if (confirm('모든 설정·날씨·캐릭터 상태를 처음으로 되돌릴까요?')) store.reset('all'); } }, '전체 초기화'));
  foot.append(el('div', { class: 'lab small' }, '프리셋'), presetRow, resetRow);
  // 인트로: 다시 보기 + 시작 시 인트로 (방문자 브라우저에 저장, 없으면 presentation.json의 start.mode)
  const introRow = el('div', { class: 'intro-row', hidden: '' });
  foot.append(introRow);
  function setIntroHooks(h) {
    if (!h) return;
    const START = [['always', '항상'], ['first', '첫 방문만'], ['never', '표시 안 함']];
    const seg = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': '시작 시 인트로' });
    const btns = START.map(([v, t]) => { const b = el('button', { type: 'button', role: 'radio', onclick: () => { h.set(v); r(); app.toast?.(`시작 시 인트로: ${t}`); } }, t); b._v = v; seg.append(b); return b; });
    const r = () => { const m = h.mode ?? h.fileDefault; for (const b of btns) b.setAttribute('aria-checked', String(b._v === m)); };
    r();
    introRow.replaceChildren(
      el('div', { class: 'lab small' }, '시작 시 인트로'), seg,
      h.replay ? el('button', { type: 'button', class: 'ghost', onclick: () => h.replay() }, '인트로 다시 보기') : null);
    introRow.hidden = false;
  }

  function refresh() { for (const r of refreshers) r(); }
  store.subscribe(() => refresh());
  renderTab();
  return { refresh, setOpen, setSheet, setIntroHooks, get tab() { return tab; }, selectTab(id) { tab = id; renderTab(); } };
}
