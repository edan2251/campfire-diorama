// 배치 편집 모드 (F12, `?edit`). 편집 상태(배치 L·실행 취소 이력·선택)와 편집 UI·기즈모·단축키를 맡고,
// 장면 반영·이동 영역·캐릭터·저장 요청은 main.js가 넘겨준 app 훅으로 한다.
// 기즈모(2026-10-24): three r160 TransformControls를 보이지 않는 대리 물체(proxy)에 붙임 → 대리 물체 변환을 배치 값으로 바꿔 장면에 반영.
//   이동(X·Y·Z 화살표 + 평면), 회전(X·Y·Z 고리, 순서 YXZ), 크기(허용된 단위만, 균일). 월드/로컬, 스냅. 드래그 한 번 = 실행 취소 한 단계.
// 입력: main.js가 편집 모드의 왼쪽 버튼을 pointerDown으로 넘김 — 기즈모 위면 기즈모가, 물체 위면 선택만, 빈 곳이면 아무것도 안 함.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { getUnit, setUnit, unitsOf, ruleOf, createHistory, parseLayout, serialize, sameLayout, REST, restLocalToWorld } from '../logic/layout_model.js';
import { footprintsFromLayout } from '../logic/layout.js';
import { createIntroEditor } from './intro_editor.js';

const DEG = Math.PI / 180;
const clone = (v) => JSON.parse(JSON.stringify(v));
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
const hhmmss = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; };
const ACCENT = 0xf0a35a;
const SNAP = { move: 0.05, rotate: 15, scale: 0.05 };
const TOOL_NAME = { select: '선택', translate: '이동', rotate: '회전', scale: '크기' };

/**
 * app 훅:
 *  scene, camera, canvas, terrain, world(buildWorld 결과: units·pivotOf·unitOf), characterRoot,
 *  applyLayout(L, { final }) — 장면·충돌체·불·통나무 클릭 영역·미리보기 캐릭터 갱신 (final이면 이동 영역도)
 *  check(L), startTest(L) → boolean, stopTest(), toast(text), store, rig, firstView
 */
export function createEditor(root, initial, app) {
  let L = clone(initial);
  let saved = clone(initial);
  const history = createHistory(L);
  let selected = null;
  let testing = false;
  let lastCheck = app.check(L);
  let writable = false, statusNote = '저장 서버 확인 중…';
  let firstView = app.firstView ?? null;
  let message = null;
  let tool = 'translate';            // select | translate | rotate | scale
  let space = 'world';
  let snapOn = false;
  let techOn = false;                // 기술용 표시(충돌 발자국·착석 공간·선택 상자)

  // ---------- 3D: 기즈모·표시 (편집 전용: 비 가림 레이어 아님, 그림자 없음, PNG 때 숨김) ----------
  const helpers = new THREE.Group();
  helpers.name = 'editor_helpers';
  app.scene.add(helpers);
  const proxy = new THREE.Object3D();
  proxy.name = 'editor_proxy';
  app.scene.add(proxy);
  const tc = new TransformControls(app.camera, app.canvas);
  tc.name = 'editor_gizmo';
  tc.setSize(0.85);
  app.scene.add(tc);
  const lineMat = (color, opacity = 1) => new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
  const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), lineMat(ACCENT, 0.7));
  box.renderOrder = 50; box.matrixAutoUpdate = false;
  const foot = new THREE.Group();     // 기술 표시: 실제 발자국(충돌체)·착석 공간
  const marks = new THREE.Group();    // 검사 오류·주의 위치 (항상)
  helpers.add(box, foot, marks);
  const localBox = new THREE.Box3();
  const boxCenter = new THREE.Vector3(), boxSize = new THREE.Vector3();
  const tmpM = new THREE.Matrix4();

  function computeLocalBox(id) {
    localBox.makeEmpty();
    const u = app.world.units.get(id);
    if (!u) return;
    u.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(u.matrixWorld).invert();
    u.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      localBox.union(o.geometry.boundingBox.clone().applyMatrix4(tmpM.multiplyMatrices(inv, o.matrixWorld)));
    });
    if (id === 'rest') localBox.union(new THREE.Box3(new THREE.Vector3(-0.32, 0, -0.3), new THREE.Vector3(0.32, 0.78, 0.22)));
    if (localBox.isEmpty()) localBox.set(new THREE.Vector3(-0.2, 0, -0.2), new THREE.Vector3(0.2, 0.3, 0.2));
  }
  function loop(points, color) {
    const g = new THREE.BufferGeometry().setFromPoints(points.map(([x, z]) => new THREE.Vector3(x, app.terrain.height(x, z) + 0.015, z)));
    const l = new THREE.LineLoop(g, lineMat(color, 0.9));
    l.renderOrder = 50;
    return l;
  }
  function rebuildFoot() {
    for (const c of foot.children) c.geometry.dispose();
    foot.clear();
    if (!selected || !techOn) return;
    const ids = selected === 'rest' ? ['log'] : [selected];
    for (const o of footprintsFromLayout(L).filter((f) => ids.includes(f.id))) {
      let pts;
      if (o.type === 'circle') pts = Array.from({ length: 40 }, (_, k) => [o.x + o.r * Math.cos((k / 40) * 2 * Math.PI), o.z + o.r * Math.sin((k / 40) * 2 * Math.PI)]);
      else { const c = Math.cos(o.yaw), s = Math.sin(o.yaw); pts = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([u, v]) => [o.x + u * o.hw * c - v * o.hd * s, o.z + u * o.hw * s + v * o.hd * c]); }
      foot.add(loop(pts, 0xffc27a));
    }
    if (selected === 'rest') {
      const sp = REST.space;
      foot.add(loop([[sp.x[0], sp.z[0]], [sp.x[1], sp.z[0]], [sp.x[1], sp.z[1]], [sp.x[0], sp.z[1]]].map(([x, z]) => restLocalToWorld(L, x, z)), 0x9fe0ff));
    }
  }
  function rebuildMarks() {
    for (const c of marks.children) c.geometry.dispose();
    marks.clear();
    const add = (it, color) => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 12).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }));
      m.position.set(it.at[0], app.terrain.height(it.at[0], it.at[1]) + 0.3, it.at[1]);
      m.renderOrder = 52;
      marks.add(m);
    };
    for (const it of lastCheck.errors) add(it, 0xff5a5a);
    if (techOn) for (const it of lastCheck.warnings) add(it, 0xffc04d);
  }

  // ---------- 대리 물체 ↔ 배치 ----------
  const v3 = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), eul = new THREE.Euler(0, 0, 0, 'YXZ');
  /** 선택 단위의 피벗(휴식 자리 = 통나무 중심, 나머지 = 모델 바닥 가운데) 월드 변환을 대리 물체로 */
  function syncProxy() {
    const pv = selected && app.world.pivotOf(selected);
    if (!pv) return;
    pv.updateWorldMatrix(true, false);
    pv.matrixWorld.decompose(proxy.position, proxy.quaternion, sc);
    proxy.scale.setScalar(selected === 'rest' ? 1 : getUnit(L, selected).scale);
    proxy.updateMatrixWorld(true);
  }
  let dragStart = null;              // { L, scale }
  /** 대리 물체 변환 → 배치 값 (단위별 규칙·범위는 setUnit이 지킴) */
  function proxyToLayout() {
    const p = proxy.position;
    eul.setFromQuaternion(proxy.quaternion, 'YXZ');
    if (selected === 'rest') {
      // 통나무 중심이 옮겨지면 휴식 자리 전체(캐릭터 포함)가 같이, 방향(Y)은 휴식 자리 전체, X·Z 기울기와 높이는 통나무만
      const yaw = eul.y, c = Math.cos(yaw), s = Math.sin(yaw);
      const lx = REST.logSide, lz = -REST.logBack;
      const ax = p.x - (lx * c + lz * s), az = p.z - (-lx * s + lz * c);
      const ground = app.terrain.height(ax, az) + (L.rest_dy ?? 0);
      setUnit(L, 'rest', { x: ax, z: az, yaw, rx: eul.x, rz: eul.z, dy: p.y - ground - REST.logRadius });
      return;
    }
    const s0 = dragStart ? dragStart.scale : getUnit(L, selected).scale;
    const comps = [proxy.scale.x, proxy.scale.y, proxy.scale.z];
    const sUni = comps.reduce((a, b) => (Math.abs(b - s0) > Math.abs(a - s0) ? b : a), s0);   // 균일 크기: 가장 많이 바뀐 축 값
    setUnit(L, selected, { x: p.x, z: p.z, dy: p.y - app.terrain.height(p.x, p.z), yaw: eul.y, rx: eul.x, rz: eul.z, scale: sUni });
  }
  tc.addEventListener('mouseDown', () => { dragStart = { L: clone(L), scale: selected ? getUnit(L, selected).scale : 1 }; });
  tc.addEventListener('objectChange', () => {
    if (!selected || !tc.dragging) return;
    proxyToLayout();
    app.applyLayout(L, { final: false });            // 보이는 것만 (이동 영역·검사·이력은 놓을 때)
    if (techOn) rebuildFoot();
    renderSel(true);
  });
  let cancelling = false;
  tc.addEventListener('mouseUp', () => {
    const start = dragStart; dragStart = null;
    if (cancelling) return;
    if (start && JSON.stringify(start.L) !== JSON.stringify(L)) { finalize(); setMsg('info', `${TOOL_NAME[tool]} — 실행 취소 한 단계`); }
    syncProxy();                                    // 범위에 걸려 잘린 값으로 기즈모를 맞춤
  });

  function applyTool() {
    const u = selected && app.world.pivotOf(selected);
    const canScale = selected && selected !== 'rest' && !!ruleOf(selected)?.scale;
    if (tool === 'scale' && !canScale && selected) setMsg('info', '이 물체는 크기가 잠겨 있어요 (에셋 비율·접촉 보호)');
    const show = u && tool !== 'select' && !(tool === 'scale' && !canScale) && api.active;
    if (show) { if (tc.object !== proxy) tc.attach(proxy); tc.setMode(tool); tc.setSpace(tool === 'scale' ? 'local' : space); }
    else if (tc.object) tc.detach();
    tc.setTranslationSnap(snapOn ? SNAP.move : null);
    tc.setRotationSnap(snapOn ? SNAP.rotate * DEG : null);
    tc.setScaleSnap(snapOn ? SNAP.scale : null);
    renderToolbar();
  }

  // ---------- UI ----------
  const link = el('link', { rel: 'stylesheet', href: 'src/edit/editor.css' });
  document.head.append(link);
  const label = el('div', { class: 'edit-label', hidden: true });
  document.body.append(label);
  const toolbar = el('div', { class: 'edit-toolbar', role: 'toolbar', 'aria-label': '편집 도구' });
  document.body.append(toolbar);
  const badge = el('div', { class: 'edit-badge' });
  const listBox = el('div', { class: 'edit-list', role: 'listbox', 'aria-label': '오브젝트 목록' });
  const selBox = el('div', { class: 'edit-sel' });
  const checkBox = el('div', { class: 'edit-check', 'aria-live': 'polite' });
  const msgBox = el('div', { class: 'edit-msg', role: 'status', 'aria-live': 'polite' });
  const undoBtn = el('button', { onclick: () => undo(), title: 'Ctrl+Z' }, '실행 취소');
  const redoBtn = el('button', { onclick: () => redo(), title: 'Ctrl+Y / Ctrl+Shift+Z' }, '다시 실행');
  const revertBtn = el('button', { class: 'ghost', onclick: () => revertToSaved() }, '마지막 저장으로 되돌리기');
  const testBtn = el('button', { onclick: () => toggleTest() }, '동작 테스트');
  const saveBtn = el('button', { class: 'accent', onclick: () => save(), title: 'Ctrl+S' }, '적용·저장');
  const exportBtn = el('button', { class: 'ghost', onclick: () => exportJSON() }, 'JSON 내보내기');
  const fileIn = el('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: (e) => importJSON(e.target.files[0]) });
  const importBtn = el('button', { class: 'ghost', onclick: () => fileIn.click() }, 'JSON 가져오기');
  const fvBtn = el('button', { onclick: () => saveFirstView() }, '현재 구도를 첫 화면으로 저장');
  const fvNote = el('div', { class: 'edit-note' });
  const testBox = el('div', { class: 'edit-test', hidden: true },
    el('p', {}, '동작 테스트 중 — 섬을 클릭하면 걷고, 통나무를 클릭하면 다가가 앉습니다. 편집 표시와 기즈모는 꺼져 있어요.'),
    el('button', { class: 'accent', onclick: () => toggleTest() }, '편집으로 돌아가기'));
  const editBox = el('div', { class: 'edit-main' },
    el('div', { class: 'edit-sec' }, el('div', { class: 'edit-h' }, '오브젝트'), listBox),
    selBox,
    el('div', { class: 'edit-row' }, undoBtn, redoBtn, revertBtn),
    el('div', { class: 'edit-sec' }, el('div', { class: 'edit-h' }, '배치 검사'), checkBox),
    el('div', { class: 'edit-sec scope' }, el('div', { class: 'edit-h' }, '배치 저장 — web/config/layout.json'),
      el('div', { class: 'edit-row' }, testBtn, saveBtn), el('div', { class: 'edit-row' }, exportBtn, importBtn, fileIn)),
    el('div', { class: 'edit-sec scope' }, el('div', { class: 'edit-h' }, '첫 화면 카메라 — web/config/first_view.json'), el('div', { class: 'edit-row' }, fvBtn), fvNote),
    el('details', { class: 'edit-help' }, el('summary', {}, '단축키·조작'),
      el('p', {}, 'Q 선택(기즈모 끔) · W 이동 · E 회전 · R 크기 · L 월드/로컬 · F 선택 물체 보기 · Ctrl+Z 실행 취소 · Ctrl+Y / Ctrl+Shift+Z 다시 실행 · Ctrl+S 배치 저장 · Esc 드래그 취소 / 선택 해제'),
      el('p', {}, '기즈모: 빨강 X · 초록 Y · 파랑 Z. 화살표 = 한 축, 작은 사각형 = 평면, 고리 = 그 축으로 회전. 물체 클릭 = 선택, 빈 곳 클릭 = 해제. 오른쪽 드래그 = 카메라 회전, 휠 버튼 드래그 = 평행 이동, 휠 = 거리.')));
  // 탭: 장면 편집(배치) | 인트로 편집(presentation.json). 인트로 탭에서는 기즈모·장면 단축키를 끔 (장면 편집 기능은 그대로 남음)
  let introTab = false;
  const introBox = el('div', { class: 'edit-main intro-edit', hidden: true });
  const tabScene = el('button', { type: 'button', role: 'tab', 'aria-selected': 'true', onclick: () => setTab(false) }, '장면 편집');
  const tabIntro = el('button', { type: 'button', role: 'tab', 'aria-selected': 'false', onclick: () => setTab(true) }, '인트로 편집');
  const collapseBtn = el('button', { type: 'button', class: 'ghost small edit-collapse', title: '패널 접기/펴기 (미리보기 전체 화면 확인)', onclick: () => panel.classList.toggle('collapsed') }, '접기');
  const panel = el('section', { class: 'edit-panel', 'aria-label': '편집' },
    el('div', { class: 'edit-top' }, el('strong', {}, '편집 모드'), badge, collapseBtn),
    el('div', { class: 'edit-tabs', role: 'tablist' }, tabScene, tabIntro),
    msgBox, editBox, testBox, introBox);
  root.append(panel);
  // 화면 나누기 (U-19): 왼쪽 = 패널, 오른쪽 = 실제 화면. 실제 화면은 창과 같은 가로세로 비율로 줄여 보여 줌(방문자가 보는 구도·글 크기 그대로, 위아래 여백).
  // 패널을 접으면 화면 전체. 재생 중·좁은 창(900px 미만)은 나누지 않음 (editor.css)
  document.body.classList.add('edit-split');
  const setSplit = () => {
    const w = panel.classList.contains('collapsed') ? 0 : Math.round(panel.getBoundingClientRect().right + 12);
    const sc = Math.max(0.3, (innerWidth - w) / innerWidth);
    const st = document.documentElement.style;
    st.setProperty('--edit-w', `${w}px`);
    st.setProperty('--edit-s', sc.toFixed(4));
    st.setProperty('--edit-top', `${Math.round(((1 - sc) * innerHeight) / 2)}px`);
  };
  new ResizeObserver(setSplit).observe(panel);
  addEventListener('resize', setSplit);
  link.addEventListener('load', setSplit);                            // 편집기 CSS가 늦게 오면 처음 잰 패널 폭(전체 폭)이 틀림
  new MutationObserver(setSplit).observe(panel, { attributes: true, attributeFilter: ['class'] });
  setSplit();
  const intro = app.presentation ? createIntroEditor(introBox, {
    presentation: app.presentation, store: app.store, rig: app.rig, initial: app.presentationConfig, toast: app.toast,
    presentRoot: app.presentRoot, project: app.project,
    setPlaying: (v) => document.body.classList.toggle('intro-playing', v),
  }) : null;
  if (!intro) tabIntro.disabled = true;
  function setTab(toIntro) {
    if (toIntro === introTab || (toIntro && !intro)) return;
    if (toIntro && testing) toggleTest();
    introTab = toIntro;
    tabScene.setAttribute('aria-selected', String(!toIntro));
    tabIntro.setAttribute('aria-selected', String(toIntro));
    editBox.hidden = toIntro || testing; testBox.hidden = toIntro || !testing; introBox.hidden = !toIntro;
    msgBox.hidden = toIntro;
    badge.hidden = toIntro;
    if (toIntro) { if (tc.object) tc.detach(); intro.activate(); } else { intro.deactivate(); applyTool(); }
    renderToolbar();
  }
  if (matchMedia('(pointer: coarse)').matches) msgBox.textContent = '편집 모드는 PC(마우스) 우선 지원입니다. 모바일 편집은 검증하지 않았어요.';

  function setMsg(kind, text) { message = { kind, text }; msgBox.className = `edit-msg ${kind}`; msgBox.textContent = text; }

  function renderToolbar() {
    const b = (key, text, active, onclick, title) => el('button', { class: active ? 'on' : '', 'aria-pressed': String(!!active), title, onclick }, el('kbd', {}, key), ` ${text}`);
    toolbar.hidden = !api.active;
    toolbar.replaceChildren(
      b('Q', '선택', tool === 'select', () => setTool('select'), '기즈모 끄기'),
      b('W', '이동', tool === 'translate', () => setTool('translate')),
      b('E', '회전', tool === 'rotate', () => setTool('rotate')),
      b('R', '크기', tool === 'scale', () => setTool('scale'), '허용된 물체만 (균일)'),
      el('span', { class: 'sep' }),
      b('L', space === 'world' ? '월드' : '로컬', false, () => toggleSpace(), '좌표계 전환 (크기는 항상 로컬)'),
      el('button', { class: snapOn ? 'on' : '', 'aria-pressed': String(snapOn), onclick: () => { snapOn = !snapOn; applyTool(); } }, `스냅 ${snapOn ? `켬 ${SNAP.move}H·${SNAP.rotate}°·${SNAP.scale}` : '끔'}`),
      el('span', { class: 'sep' }),
      el('button', { onclick: () => groundSnap(), disabled: !selected, title: '변환된 모델 밑면을 실제 지형에 닿게 (높이만)' }, '바닥에 맞추기'),
      b('F', '보기', false, () => frameSelected(), '선택 물체가 화면에 들어오게 (첫 화면은 그대로)'),
      el('button', { class: techOn ? 'on' : '', 'aria-pressed': String(techOn), onclick: () => { techOn = !techOn; rebuildFoot(); rebuildMarks(); renderToolbar(); }, title: '충돌 발자국·착석 공간·선택 상자·주의 표시' }, '기술 표시'));
  }
  function renderList() {
    listBox.replaceChildren(...unitsOf(L).map((u) => {
      const bad = lastCheck.errors.some((e) => e.id === u.id) ? 'err' : lastCheck.warnings.some((w) => w.id === u.id) ? 'warn' : '';
      return el('button', { role: 'option', 'aria-selected': String(u.id === selected), class: bad, onclick: () => select(u.id === selected ? null : u.id) }, u.name);
    }));
  }
  const numInputs = {};
  function numField(key, labelText, step, value, opts = {}) {
    const inp = el('input', { type: 'number', step, value: (+value).toFixed(opts.dec ?? 2), disabled: opts.locked, 'aria-label': labelText,
      onchange: (e) => { const v = +e.target.value; if (!Number.isFinite(v)) { renderSel(); return; } commitUnit({ [key]: opts.toInternal ? opts.toInternal(v) : v }); } });
    numInputs[key] = { inp, dec: opts.dec ?? 2, fromInternal: opts.fromInternal };
    return el('label', { class: 'edit-num' }, el('span', {}, labelText), inp, opts.locked ? el('em', {}, '잠김') : null);
  }
  /** 숫자 칸 다시 그리기. onlyValues: 드래그 중에는 값만 바꿈(입력 중인 칸은 건드리지 않음) */
  function renderSel(onlyValues = false) {
    if (!selected) { selBox.replaceChildren(el('p', { class: 'edit-note' }, '물체를 클릭하거나 목록에서 고르세요. 가려진 소품도 목록에서 고를 수 있어요.')); return; }
    const t = getUnit(L, selected);
    const view = { x: t.x, dy: t.dy, z: t.z, rx: t.rx / DEG, yaw: t.yaw / DEG, rz: t.rz / DEG, scale: t.scale };
    if (onlyValues) {
      for (const [k, f] of Object.entries(numInputs)) if (document.activeElement !== f.inp && k in view) f.inp.value = (+view[k]).toFixed(f.dec);
      return;
    }
    const rule = ruleOf(selected);
    const name = unitsOf(L).find((u) => u.id === selected)?.name ?? selected;
    const isRest = selected === 'rest';
    for (const k of Object.keys(numInputs)) delete numInputs[k];
    selBox.replaceChildren(...[
      el('div', { class: 'edit-h' }, `선택: ${name}`, el('button', { class: 'ghost small', onclick: () => select(null) }, '선택 해제')),
      el('p', { class: 'edit-note' }, '숫자는 항상 월드 기준 (위치 H, 높이 = 지면 위, 회전 ° 순서 Y→X→Z). 기즈모의 월드/로컬은 끌 때 축 방향만 바꿈.'),
      el('div', { class: 'edit-grid3' },
        numField('x', 'X', 0.01, view.x), numField('dy', isRest ? '통나무 높이' : '높이', 0.005, view.dy, { dec: 3 }), numField('z', 'Z', 0.01, view.z),
        numField('rx', isRest ? '통나무 X°' : '회전 X°', 1, view.rx, { dec: 1, toInternal: (v) => v * DEG }),
        numField('yaw', '회전 Y°', 1, view.yaw, { dec: 1, toInternal: (v) => v * DEG }),
        numField('rz', isRest ? '통나무 Z°' : '회전 Z°', 1, view.rz, { dec: 1, toInternal: (v) => v * DEG }),
        numField('scale', rule.scale ? `크기 ${rule.scale[0]}–${rule.scale[1]}` : '크기', 0.01, view.scale, { locked: !rule.scale })),
      el('div', { class: 'edit-row' }, el('button', { onclick: () => commitUnit({ yaw: t.yaw - 15 * DEG }) }, '↺ 15°'), el('button', { onclick: () => commitUnit({ yaw: t.yaw + 15 * DEG }) }, '↻ 15°'),
        el('button', { class: 'ghost', onclick: () => commitUnit({ rx: 0, rz: 0 }) }, '기울기 0')),
      isRest ? el('p', { class: 'edit-note' }, '이동·Y 회전 = 통나무·앉은 캐릭터·접근 위치가 함께. 높이·X·Z 기울기 = 통나무만(캐릭터 엉덩이는 지면). 착석 동작은 기울지 않은 통나무 기준이라 등 접촉이 크게 바뀌면 "휴식 위치 보정 필요".') : null,
      selected === 'fire' ? el('p', { class: 'edit-note' }, '장작·돌 테두리를 기울여도 불꽃·연기는 위로 올라감. 불꽃·광원·이동 금지 범위는 모닥불 자리를 따라감. 크기 잠김.') : null].filter(Boolean));
  }
  function renderCheck() {
    const item = (it, kind) => el('li', { class: kind, onclick: () => { if (it.id && getUnit(L, it.id)) select(it.id); } }, `${it.msg} `, el('span', { class: 'at' }, `(${it.at[0]}, ${it.at[1]})`));
    const rows = [...lastCheck.errors.map((e) => item(e, 'err')), ...lastCheck.warnings.map((w) => item(w, 'warn')), ...lastCheck.contacts.map((c) => item(c, 'info'))];
    const s = lastCheck.stats;
    checkBox.replaceChildren(
      el('div', { class: lastCheck.errors.length ? 'sum err' : lastCheck.warnings.length ? 'sum warn' : 'sum ok' },
        lastCheck.errors.length ? `오류 ${lastCheck.errors.length} — 저장·동작 테스트 불가 (실행 취소·마지막 저장으로 되돌릴 수 있음)` : lastCheck.warnings.length ? `주의 ${lastCheck.warnings.length} (저장 가능)` : '문제 없음'),
      ...(rows.length ? [el('ul', {}, rows)] : []),
      el('div', { class: 'edit-note' }, `발끝–돌 테두리 ${s.feetToRing?.toFixed(2)}H · 발끝–불꽃 ${s.feetToFlame?.toFixed(2)}H · 갈 수 있는 땅 ${Math.round((s.reachableShare ?? 0) * 100)}%`));
  }
  function renderStatus() {
    const dirty = !sameLayout(L, saved);
    badge.textContent = testing ? '동작 테스트 중' : dirty ? '저장 안 된 변경 있음' : `저장됨${saved.saved_at ? ' · ' + hhmmss(saved.saved_at) : ''}`;
    badge.className = `edit-badge ${testing ? 'test' : dirty ? 'dirty' : 'clean'}`;
    undoBtn.disabled = !history.canUndo || testing;
    redoBtn.disabled = !history.canRedo || testing;
    saveBtn.disabled = !writable || testing;
    saveBtn.title = writable ? 'Ctrl+S' : statusNote;
    fvBtn.disabled = !writable;
    testBtn.disabled = lastCheck.errors.length > 0;
    fvNote.textContent = (firstView?.saved_at ? `저장된 첫 화면: ${hhmmss(firstView.saved_at)} · ` : '저장된 첫 화면 없음(기본 구도) · ') + '“카메라 초기화”는 이 첫 화면으로 돌아갑니다. F(보기)나 카메라 이동으로는 바뀌지 않아요.' + (writable ? '' : ` (${statusNote})`);
  }
  function renderAll() { renderList(); renderSel(); renderCheck(); renderStatus(); renderToolbar(); }

  // ---------- 상태 변경 ----------
  function select(id) {
    selected = id;
    if (id) { computeLocalBox(id); syncProxy(); }
    applyTool();
    rebuildFoot();
    renderList(); renderSel(); renderToolbar();
  }
  function setTool(t) { tool = t; setMsg('info', `${TOOL_NAME[t]} 도구${t === 'select' ? ' — 기즈모 꺼짐, 클릭으로 선택만' : ''}`); applyTool(); }
  function toggleSpace() { space = space === 'world' ? 'local' : 'world'; applyTool(); setMsg('info', `좌표계: ${space === 'world' ? '월드(장면 축)' : '로컬(물체가 기울어진 축)'}`); }
  /** 확정 변경 (숫자·버튼·드래그 끝): 장면 반영 + 검사 + 이력 한 단계 */
  function finalize() {
    app.applyLayout(L, { final: true });
    lastCheck = app.check(L);
    history.push(L);
    if (selected) { computeLocalBox(selected); syncProxy(); }
    rebuildFoot(); rebuildMarks();
    renderAll();
  }
  function commitUnit(patch) {
    if (!selected || testing) return;
    setUnit(L, selected, patch);
    finalize();
  }
  function replaceLayout(next) {
    L = clone(next);
    if (selected && !getUnit(L, selected)) selected = null;
    app.applyLayout(L, { final: true });
    lastCheck = app.check(L);
    if (selected) { computeLocalBox(selected); syncProxy(); }
    applyTool();
    rebuildFoot(); rebuildMarks();
    renderAll();
  }
  function undo() { if (testing || tc.dragging || !history.canUndo) return; replaceLayout(history.undo()); setMsg('info', '실행 취소'); }
  function redo() { if (testing || tc.dragging || !history.canRedo) return; replaceLayout(history.redo()); setMsg('info', '다시 실행'); }
  /** 드래그 취소 (Esc): 드래그 시작 전 값으로, 이력에 남기지 않음 */
  function cancelDrag() {
    if (!tc.dragging) return false;
    cancelling = true;
    const start = dragStart;
    tc.pointerUp({ button: 0 });                     // 기즈모 드래그 끝내기 (카메라 입력 복구)
    cancelling = false; dragStart = null;
    if (start) replaceLayout(start.L);
    setMsg('info', '드래그 취소 — 이전 값으로');
    return true;
  }

  /** 바닥에 맞추기: 변환된 모델의 가장 낮은 점들이 실제 지형에 닿도록 높이만 조절 (원점 Y를 0으로 하지 않음) */
  function groundSnap() {
    if (!selected || testing) return;
    const pv = app.world.pivotOf(selected);
    pv.updateWorldMatrix(true, true);
    let minGap = Infinity;
    const p = new THREE.Vector3();
    pv.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      const pos = o.geometry.attributes.position, step = Math.max(1, Math.floor(pos.count / 6000));
      for (let i = 0; i < pos.count; i += step) {
        p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        const g = p.y - app.terrain.height(p.x, p.z);
        if (g < minGap) minGap = g;
      }
    });
    if (!Number.isFinite(minGap)) return;
    const t = getUnit(L, selected);
    commitUnit({ dy: t.dy - minGap });
    setMsg('ok', `바닥에 맞춤: 가장 낮은 점이 지면에서 ${minGap >= 0 ? '떠 있던' : '묻혀 있던'} ${Math.abs(minGap).toFixed(3)}H 만큼 높이 조절${selected === 'rest' ? ' (통나무만)' : ''}`);
  }
  /** F: 선택 물체가 화면에 들어오게 카메라만 (저장된 첫 화면은 그대로) */
  function frameSelected() {
    if (!selected) return;
    const u = app.world.units.get(selected);
    const bx = new THREE.Box3().setFromObject(u);
    if (selected === 'rest' && app.characterRoot) bx.union(new THREE.Box3().setFromObject(app.characterRoot));
    const sph = bx.getBoundingSphere(new THREE.Sphere());
    const fov = (app.camera.fov * Math.PI) / 180;
    const d = Math.max(3.5, Math.min(16, (sph.radius * 1.6) / Math.tan(fov / 2)));
    app.store.set('camera.target', sph.center.toArray().map((v, i) => (i === 1 ? Math.max(0, v) : v)), { save: false });
    app.store.set('camera.distance', d, { save: false });
    setMsg('info', 'F: 선택 물체 보기 (첫 화면 구도는 바뀌지 않음)');
  }

  async function revertToSaved() {
    if (testing) return;
    try {
      const r = parseLayout(await (await fetch('config/layout.json', { cache: 'no-store' })).text());
      if (!r.ok) { setMsg('err', `저장된 배치를 읽지 못했어요: ${r.errors.join(' / ')}`); return; }
      saved = clone(r.layout);
      history.push(r.layout);
      replaceLayout(r.layout);
      setMsg('ok', '마지막 저장 배치로 되돌렸어요 (실행 취소로 다시 돌아갈 수 있음)');
    } catch (e) { setMsg('err', `저장된 배치를 읽지 못했어요: ${e.message}`); }
  }

  async function save() {
    if (testing || tc.dragging) return;
    lastCheck = app.check(L);
    renderCheck(); rebuildMarks();
    if (lastCheck.errors.length) { setMsg('err', `저장하지 않았어요 — 오류 ${lastCheck.errors.length}개: ${lastCheck.errors[0].msg}`); renderStatus(); return; }
    if (!writable) { setMsg('err', `저장할 수 없어요: ${statusNote}`); return; }
    saveBtn.disabled = true;
    try {
      const res = await fetch('/__project/layout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: serialize(L, { saved_by: 'editor' }) });
      const out = await res.json().catch(() => ({ ok: false, error: `서버 응답 ${res.status}` }));
      if (!res.ok || !out.ok) { setMsg('err', `저장 실패: ${out.error ?? res.status}`); return; }
      L.saved_at = out.saved_at; L.saved_by = 'editor';
      saved = clone(L);
      setMsg('ok', `저장했어요 ${hhmmss(out.saved_at)} → ${out.file}${out.backup ? ` (이전 파일 백업: ${out.backup})` : ''}${lastCheck.warnings.length ? ` · 주의 ${lastCheck.warnings.length}개 있음` : ''}`);
    } catch (e) {
      setMsg('err', `저장 실패: 서버에 연결하지 못했어요 (${e.message})`);
    } finally { renderStatus(); }
  }

  async function saveFirstView() {
    if (!writable) { setMsg('err', `저장할 수 없어요: ${statusNote}`); return; }
    const c = app.store.settings.camera;
    const camera = { lens: +c.lens.toFixed(2), distance: +c.distance.toFixed(3), azimuth: +c.azimuth.toFixed(2), elevation: +c.elevation.toFixed(2), target: c.target.map((v) => +v.toFixed(3)) };
    try {
      const res = await fetch('/__project/first_view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ camera }) });
      const out = await res.json().catch(() => ({ ok: false, error: `서버 응답 ${res.status}` }));
      if (!res.ok || !out.ok) { setMsg('err', `첫 화면 저장 실패: ${out.error ?? res.status}`); return; }
      firstView = { camera, saved_at: out.saved_at };
      app.store.setCameraBase(camera);
      setMsg('ok', `현재 구도를 첫 화면으로 저장했어요 ${hhmmss(out.saved_at)} → ${out.file} (배치는 저장하지 않음)`);
    } catch (e) { setMsg('err', `첫 화면 저장 실패: ${e.message}`); }
    renderStatus();
  }

  function exportJSON() {
    const blob = new Blob([serialize(L, { exported_at: new Date().toISOString() })], { type: 'application/json' });
    const a = el('a', { download: `camping_layout_${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}.json`, href: URL.createObjectURL(blob) });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    setMsg('info', '현재 편집 상태를 JSON으로 내보냈어요 (프로젝트 파일은 그대로)');
  }
  async function importJSON(file) {
    fileIn.value = '';
    if (!file) return;
    let text;
    try { text = await file.text(); } catch (e) { setMsg('err', `파일을 읽지 못했어요: ${e.message}`); return; }
    const r = parseLayout(text);
    if (!r.ok) { setMsg('err', `가져오지 않았어요 (지금 배치 그대로): ${r.errors.join(' / ')}`); return; }
    delete r.layout.exported_at;
    history.push(r.layout);
    replaceLayout(r.layout);
    setMsg('ok', `${file.name}을 불러왔어요 — 아직 저장 전입니다${r.migrated ? ' (옛 형식을 v3로 변환)' : ''}`);
  }

  function toggleTest() {
    if (!testing) {
      lastCheck = app.check(L);
      renderCheck(); rebuildMarks();
      if (lastCheck.errors.length) { setMsg('err', `동작 테스트를 시작하지 않았어요 — 오류 ${lastCheck.errors.length}개`); renderStatus(); return; }
      if (!app.startTest(L)) return;
      testing = true;
      editBox.hidden = true; testBox.hidden = false;
      setMsg('info', '새 배치로 이동 영역을 만들고 착석 상태에서 시작했어요');
    } else {
      app.stopTest();
      testing = false;
      editBox.hidden = false; testBox.hidden = true;
      setMsg('info', '편집으로 돌아왔어요 (캐릭터는 휴식 자리 미리보기)');
    }
    applyTool();
    renderStatus();
  }

  // ---------- 입력 (main.js가 편집 모드의 왼쪽 버튼만 넘김) ----------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const aim = (x, y) => { const r = app.canvas.getBoundingClientRect(); ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, app.camera); };
  const isChild = (o, rootObj) => { for (let p = o; p; p = p.parent) if (p === rootObj) return true; return false; };
  function pickUnit(x, y) {
    aim(x, y);
    const hits = ray.intersectObjects([...app.world.units.values(), app.characterRoot].filter(Boolean), true);
    for (const h of hits) {
      if (!h.object.visible) continue;
      if (app.characterRoot && isChild(h.object, app.characterRoot)) return 'rest';
      const id = app.world.unitOf(h.object);
      if (id) return id;
    }
    return null;
  }

  const api = {
    get active() { return !testing && !app.store.photo.active && !introTab; },
    get introTab() { return introTab; },
    intro,
    setTab,
    /** 인트로 재생 중 Esc / 씻김 끝 → 편집으로 */
    introPlayDone() { intro?.playDone(); },
    introEscape() { if (intro?.playing) { intro.stopPlay(); return true; } return false; },
    get testing() { return testing; },
    get layout() { return L; },
    get saved() { return saved; },
    get selected() { return selected; },
    get lastCheck() { return lastCheck; },
    get dirty() { return !sameLayout(L, saved); },
    get history() { return history; },
    get message() { return message; },
    get tool() { return tool; },
    get space() { return space; },
    get snap() { return snapOn; },
    get dragging() { return tc.dragging; },
    gizmo: tc, proxy,
    select, undo, redo, save, saveFirstView, revertToSaved, toggleTest, exportJSON, setTool, toggleSpace, groundSnap, frameSelected, cancelDrag,
    setSnap(v) { snapOn = !!v; applyTool(); },
    setTech(v) { techOn = !!v; rebuildFoot(); rebuildMarks(); renderToolbar(); },
    importText(text, name = 'import.json') { return importJSON({ name, text: async () => text }); },
    commitUnit,
    /** 왼쪽 버튼 누름: 기즈모 위면 기즈모가 처리(true), 물체 위면 선택(true), 빈 곳이면 false (드래그해도 아무 일 없음) */
    pointerDown(x, y) {
      if (!api.active) return false;
      if (tc.object && (tc.dragging || tc.axis)) return true;
      const id = pickUnit(x, y);
      if (!id) return false;
      if (id !== selected) select(id);
      return true;
    },
    pointerMove() {},
    pointerUp() {},
    /** 짧은 클릭: 빈 곳 = 선택 해제 */
    tap(x, y) { if (!api.active || tc.axis) return; select(pickUnit(x, y)); },
    /** 매 프레임: 표시·이름표 */
    update() {
      intro?.update();
      const show = api.active;
      helpers.visible = show;
      toolbar.hidden = !show;
      if (!show && tc.object) tc.detach(); else if (show && selected && !tc.object && tool !== 'select') applyTool();
      const u = selected && app.world.units.get(selected);
      box.visible = !!u && techOn;
      if (u && techOn) {
        u.updateMatrixWorld(true);
        localBox.getCenter(boxCenter); localBox.getSize(boxSize);
        box.matrix.copy(u.matrixWorld).multiply(tmpM.compose(boxCenter, new THREE.Quaternion(), boxSize.clone().max(new THREE.Vector3(0.02, 0.02, 0.02))));
        box.matrixWorldNeedsUpdate = true;
      }
      label.hidden = !(selected && show);
      if (!label.hidden) {
        localBox.getCenter(boxCenter);
        const top = new THREE.Vector3(boxCenter.x, localBox.max.y + 0.1, boxCenter.z).applyMatrix4(u.matrixWorld).project(app.camera);
        const r = app.canvas.getBoundingClientRect();
        label.style.left = `${r.left + ((top.x + 1) / 2) * r.width}px`;
        label.style.top = `${r.top + ((1 - top.y) / 2) * r.height}px`;
        label.textContent = `${unitsOf(L).find((x) => x.id === selected)?.name ?? selected} · ${TOOL_NAME[tool]}`;
      }
    },
    setHelpersHidden(v) { helpers.visible = !v && api.active; tc.visible = !v; label.hidden = v || !selected; },
  };

  // 단축키: 편집 중이고, 글자 입력 칸·한글 조합 중이 아닐 때만 (입력 칸의 Ctrl+Z는 브라우저 기본 동작 그대로)
  addEventListener('keydown', (e) => {
    if (testing || app.store.photo.active) return;
    if (e.isComposing || e.keyCode === 229) return;
    const t = e.target;
    if (introTab) {                                    // 인트로 탭: Ctrl+S만 (인트로 저장). 입력 칸의 Ctrl+Z는 브라우저 기본
      const inField = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { e.preventDefault(); intro.save(); }
      else if (!inField && (e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) intro.redo(); else intro.undo(); }
      return;
    }
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    // 키 위치(code)로 판별 — 한글 자판 상태에서도 같은 키(ㅂ·ㄷ·ㄱ…)로 동작. 조합 중(isComposing·229)은 위에서 거름
    const k = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (ctrl && k === 'y') { e.preventDefault(); redo(); return; }
    if (ctrl && k === 's') { e.preventDefault(); save(); return; }
    if (ctrl || e.altKey) return;
    if (k === 'escape') { if (!cancelDrag()) select(null); return; }
    if (tc.dragging) return;
    if (k === 'q') setTool('select');
    else if (k === 'w') setTool('translate');
    else if (k === 'e') setTool('rotate');
    else if (k === 'r') setTool('scale');
    else if (k === 'l') toggleSpace();
    else if (k === 'f') frameSelected();
  });
  addEventListener('beforeunload', (e) => { if (!sameLayout(L, saved)) { e.preventDefault(); e.returnValue = ''; } });

  fetch('/__project/status', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((s) => {
    writable = !!(s && s.writable);
    statusNote = s ? (s.writable ? '' : '이 PC의 로컬 서버 화면에서만 저장할 수 있어요') : '저장 서버가 없어요 (정적 배포) — JSON 내보내기만 가능';
    renderStatus();
  }).catch(() => { writable = false; statusNote = '저장 서버가 없어요 (정적 배포) — JSON 내보내기만 가능'; renderStatus(); });

  rebuildMarks();
  renderAll();
  return api;
}
