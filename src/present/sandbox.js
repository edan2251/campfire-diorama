// 인트로 체험 패널 (U-18, 섹션 sandbox kind 'layout') — "직접 수정하기 어려운 배치" 사례를 실제 장면에서 해 보게 함.
// ① 글로 시키기: 예시 명령이 타자 치듯 써지고, 실행하면 물체가 그대로 움직임(logic/command.js 규칙 해석 — AI 아님)
// ② 직접 옮기기: 편집 모드처럼 기즈모(이동·회전·크기)로 끌어 옮김. 물체 클릭 = 고르기
// ③ 글 상자: PPT처럼 글 상자를 만들어 끌고, 모서리로 크기, 두 번 눌러 글 고치기
// 모두 미리보기 — 닫거나 섹션을 떠나면 물체는 원래 자리, 글 상자는 지워짐. 배치 파일·저장 설정은 건드리지 않음.
import { parseCommand, describeSteps } from '../logic/command.js';
import { EASE } from '../logic/presentation_model.js';

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
const TYPE_CPS = 16;                       // 예시 명령 타자 속도 (글자/초)
const TWEEN = 0.9;                         // 글 명령 실행 때 옮겨 가는 시간 (초)
const SCALE_RANGE = [0.3, 3];              // 처음 크기의 몇 배까지 (미리보기)
const TOOLS = [['translate', '이동'], ['rotate', '회전'], ['scale', '크기']];

/**
 * app: { THREE, scene, camera, world(pivotOf·units), terrain, edge(x, z): 섬 윗면 타원 기준 거리(1 = 가장자리), names(): [{ id, name }], loadControls(): Promise<TransformControls 클래스> }
 */
export function createSandbox(root, app) {
  const { THREE } = app;
  let cfg = null, tab = 'command', target = null;
  const orig = new Map();                  // id → { pos, rx, yaw, rz, scale, dy } 처음 상태
  let tween = null;                        // { id, from, to, t }
  let typing = null;                       // { text, i, acc }
  let tc = null, tcLoading = null;
  let ring = null, tagH = 0.5;
  const boxes = [];

  // ---------- DOM ----------
  const out = el('p', { class: 'pr-sbx-out', 'aria-live': 'polite' });
  const input = el('input', { type: 'text', class: 'pr-sbx-in', 'aria-label': '명령 문장', spellcheck: 'false', autocomplete: 'off',
    onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); run(); } }, oninput: () => { typing = null; } });
  const runBtn = el('button', { type: 'button', class: 'pr-sbx-run', onclick: () => run() }, '실행 ↵');
  const note = el('p', { class: 'pr-sbx-note' });
  const chips = el('div', { class: 'pr-sbx-chips', role: 'group', 'aria-label': '물체 고르기' });
  const tools = el('div', { class: 'pr-sbx-tools', role: 'group', 'aria-label': '도구' },
    TOOLS.map(([m, t]) => el('button', { type: 'button', 'data-m': m, onclick: () => setTool(m) }, t)));
  const body = el('div', { class: 'pr-sbx-body' });
  const tabsRow = el('div', { class: 'pr-sbx-tabs', role: 'tablist' });
  const TABS = [['command', '① 글로 시키기'], ['direct', '② 직접 옮기기'], ['text', '③ 글 상자']];
  for (const [id, t] of TABS) tabsRow.append(el('button', { type: 'button', role: 'tab', 'data-t': id, onclick: () => setTab(id) }, t));
  const title = el('strong', { class: 'pr-sbx-title' });
  const panel = el('section', { class: 'pr-sbx', hidden: true, 'data-noswipe': '', 'aria-label': '체험 패널' },
    el('header', {}, title, el('button', { type: 'button', class: 'pr-sbx-x', 'aria-label': '닫기', onclick: () => close() }, '×')),
    tabsRow, body);
  const layer = el('div', { class: 'pr-sbx-layer', hidden: true, 'data-noswipe': '' });   // ② 기즈모·물체 고르기 입력 (화면 전체, 글 아래)
  const tag = el('div', { class: 'pr-sbx-tag', hidden: true, 'aria-hidden': 'true' });
  const guides = [el('div', { class: 'pr-guide v', hidden: true }), el('div', { class: 'pr-guide h', hidden: true })];
  root.insertBefore(layer, root.querySelector('.pr-stage'));
  root.append(panel, tag, ...guides);

  // ---------- 물체 ----------
  const nameOf = (id) => app.names().find((n) => n.id === id)?.name ?? id;
  const unit = (id) => app.world.units.get(id) ?? null;
  function remember(id) {
    const u = unit(id);
    if (!u || orig.has(id)) return;
    const e = new THREE.Euler().setFromQuaternion(u.quaternion, 'YXZ');
    orig.set(id, { pos: u.position.clone(), rx: e.x, yaw: e.y, rz: e.z, scale: u.scale.x, dy: u.position.y - app.terrain.height(u.position.x, u.position.z),
      edge: Math.max(0.85, app.edge(u.position.x, u.position.z)) });   // 섬 가장자리 한계 = 처음 자리 또는 윗면 85% 중 바깥
  }
  function stateOf(id) {
    const u = unit(id);
    const e = new THREE.Euler().setFromQuaternion(u.quaternion, 'YXZ');
    return { x: u.position.x, z: u.position.z, yaw: e.y, scale: u.scale.x };
  }
  /** 땅에 붙여 놓기 (처음 높이 차이 유지, 섬 가장자리를 넘으면 안쪽으로) */
  function place(id, s) {
    const u = unit(id), o = orig.get(id);
    const k = app.edge(s.x, s.z) / o.edge;
    const p = k > 1 ? [s.x / k, s.z / k] : [s.x, s.z];
    u.position.set(p[0], app.terrain.height(p[0], p[1]) + o.dy, p[1]);
    u.rotation.set(o.rx, s.yaw, o.rz, 'YXZ');
    u.scale.setScalar(Math.min(o.scale * SCALE_RANGE[1], Math.max(o.scale * SCALE_RANGE[0], s.scale)));
  }
  function restoreAll() {
    for (const [id, o] of orig) { const u = unit(id); if (!u) continue; u.position.copy(o.pos); u.rotation.set(o.rx, o.yaw, o.rz, 'YXZ'); u.scale.setScalar(o.scale); }
    orig.clear();
  }
  function pick(id) {
    if (!unit(id)) return;
    target = id;
    remember(id);
    const box = new THREE.Box3().setFromObject(unit(id));
    tagH = Math.max(0.15, box.max.y - unit(id).position.y);
    const r = Math.max(0.12, Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.6);
    if (!ring) {
      ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe9b67c, transparent: true, opacity: 0.8, depthWrite: false }));
      ring.renderOrder = 40;
      app.scene.add(ring);
    }
    ring.scale.setScalar(r);
    ring.visible = true;
    if (tc?.object) tc.attach(unit(id));
    renderChips();
  }

  // ---------- ① 글로 시키기 ----------
  function run() {
    typing = null;
    const r = parseCommand(input.value, app.names());
    const id = r.target ?? target;
    if (!r.target && /나무/.test(input.value)) { say('장면에 나무는 없어요 — 바위 1~4, 텐트, 기타 케이스, 풀 1~9로 해 보세요', 'warn'); return; }
    if (!id || !unit(id)) { say('어떤 물체인지 모르겠어요 — 예: "바위 1을 오른쪽으로 0.5 옮겨 줘"', 'warn'); return; }
    if (!r.steps.length) { say(r.vertical ? '물체는 땅에 붙어 있어서 위·아래로는 옮기지 않아요' : `알아듣지 못했어요${r.unknown.length ? ` ("${r.unknown[0]}")` : ''} — 방향·거리·각도·배수로 말해 주세요`, 'warn'); return; }
    pick(id);
    const s = stateOf(id), to = { ...s };
    const cam = app.camera;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).setY(0).normalize();
    const far = new THREE.Vector3(); cam.getWorldDirection(far); far.setY(0).normalize();
    const V = { right, left: right.clone().negate(), far, near: far.clone().negate() };
    for (const st of r.steps) {
      if (st.type === 'move') { to.x += V[st.dir].x * st.amount; to.z += V[st.dir].z * st.amount; }
      else if (st.type === 'rotate') to.yaw += (st.deg * Math.PI) / 180;
      else to.scale *= st.factor;
    }
    tween = { id, from: s, to, t: 0 };
    say(`${nameOf(id)} → ${describeSteps(r.steps)}${r.unknown.length ? ` (못 알아들은 부분: "${r.unknown[0]}")` : ''}`, 'ok');
  }
  function say(t, kind) { out.textContent = t; out.className = `pr-sbx-out ${kind ?? ''}`; }

  // ---------- ② 직접 옮기기 ----------
  async function ensureTC() {
    if (tc) return tc;
    tcLoading ??= app.loadControls().then((TC) => {
      tc = new TC(app.camera, layer);
      tc.setSize(1.25);                                   // 편집 모드(0.85)보다 크게 — 처음 써 보는 사람도 잡기 쉽게
      tc.showY = false;                                   // 이동: 땅 위 (X·Z 평면)
      app.scene.add(tc);
      let s0 = 1;
      tc.addEventListener('mouseDown', () => { s0 = target ? unit(target).scale.x : 1; });
      tc.addEventListener('objectChange', () => {
        if (!target || !tc.dragging) return;
        const u = unit(target);
        const e = new THREE.Euler().setFromQuaternion(u.quaternion, 'YXZ');
        const comps = [u.scale.x, u.scale.y, u.scale.z];
        const sUni = comps.reduce((a, b) => (Math.abs(b - s0) > Math.abs(a - s0) ? b : a), s0);   // 균일 크기 = 가장 많이 바뀐 축
        place(target, { x: u.position.x, z: u.position.z, yaw: e.y, scale: sUni });
      });
      return tc;
    });
    return tcLoading;
  }
  function setTool(m) {
    if (!tc) return;
    tc.setMode(m);
    tc.showX = m !== 'rotate'; tc.showZ = m !== 'rotate'; tc.showY = m === 'rotate';   // 회전 = Y축 고리만, 이동 = 땅 위 X·Z
    tc.setSpace(m === 'translate' ? 'world' : 'local');
    for (const b of tools.children) b.classList.toggle('on', b.dataset.m === m);
  }
  // 물체 클릭 = 고르기 (기즈모를 끄는 중이 아닐 때, 거의 움직이지 않은 클릭)
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  layer.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  layer.addEventListener('pointerup', (e) => {
    if (!down || tc?.dragging || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return; }
    down = null;
    const r = layer.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, app.camera);
    const ids = new Set(app.names().map((n) => n.id));
    for (const h of ray.intersectObject(app.world.group, true)) {
      let o = h.object; while (o && !o.userData?.unitId) o = o.parent;
      if (o && ids.has(o.userData.unitId)) { pick(o.userData.unitId); return; }
    }
  });
  function renderChips() {
    const quick = ['rock0', 'rock1', 'rock2', 'rock3', 'tent', 'guitar_case'];
    chips.replaceChildren(...app.names().filter((n) => quick.includes(n.id) || n.id === target).map((n) =>
      el('button', { type: 'button', class: n.id === target ? 'on' : '', onclick: () => pick(n.id) }, n.name)));
  }

  // ---------- ③ 글 상자 (PPT처럼) ----------
  let picked = null, drag = null;
  function addBox() {
    if (boxes.length >= 5) { say('글 상자는 5개까지예요', 'warn'); return; }
    const w = Math.min(320, innerWidth * 0.5);
    const b = el('div', { class: 'pr-play', 'data-noswipe': '', style: `left:${innerWidth / 2 - w / 2 + boxes.length * 24}px;top:${innerHeight * 0.38 + boxes.length * 24}px;width:${w}px;--s:1` },
      el('div', { class: 'pr-play-t', spellcheck: 'false' }, cfg?.boxText || '여기에 글을 써 보세요'),
      ...['nw', 'ne', 'sw', 'se', 'w', 'e'].map((h) => el('i', { class: `pr-h ${h}` })));
    b.addEventListener('pointerdown', (e) => boxDown(e, b));
    b.addEventListener('dblclick', () => editBox(b));
    root.append(b);
    boxes.push(b);
    pickBox(b);
  }
  function pickBox(b) { picked = b; for (const x of boxes) x.classList.toggle('picked', x === b); }
  function editBox(b) {
    const t = b.querySelector('.pr-play-t');
    t.contentEditable = 'true';
    t.focus();
    getSelection()?.selectAllChildren(t);
    const done = () => { t.contentEditable = 'false'; t.removeEventListener('blur', done); };
    t.addEventListener('blur', done);
  }
  function boxDown(e, b) {
    if (e.button !== 0) return;
    const t = b.querySelector('.pr-play-t');
    if (t.isContentEditable) return;                     // 글 고치는 중: 글자 고르기
    e.preventDefault(); e.stopPropagation();
    pickBox(b);
    const h = e.target.classList.contains('pr-h') ? [...e.target.classList].find((c) => c !== 'pr-h') : null;
    const r = b.getBoundingClientRect();
    drag = { b, h, x0: e.clientX, y0: e.clientY, l: r.left, t: r.top, w: r.width, hgt: r.height, s: +b.style.getPropertyValue('--s') || 1 };
    b.setPointerCapture?.(e.pointerId);
  }
  function boxMove(e) {
    if (!drag) return;
    const d = drag, dx = e.clientX - d.x0, dy = e.clientY - d.y0, b = d.b;
    if (!d.h) {
      let l = d.l + dx, t = d.t + dy;
      const cx = l + d.w / 2, cy = t + d.hgt / 2, snapV = !e.altKey && Math.abs(cx - innerWidth / 2) < 8, snapH = !e.altKey && Math.abs(cy - innerHeight / 2) < 8;
      if (snapV) l = innerWidth / 2 - d.w / 2;
      if (snapH) t = innerHeight / 2 - d.hgt / 2;
      guides[0].hidden = !snapV; guides[0].style.left = '50%';
      guides[1].hidden = !snapH; guides[1].style.top = '50%';
      b.style.left = `${l}px`; b.style.top = `${t}px`;
      return;
    }
    const west = d.h.includes('w'), corner = d.h.length === 2;
    const w = Math.max(90, d.w + (west ? -dx : dx));
    b.style.width = `${w}px`;
    if (west) b.style.left = `${d.l + d.w - w}px`;
    if (corner) {
      const s = Math.min(4, Math.max(0.4, d.s * (w / d.w)));
      b.style.setProperty('--s', s.toFixed(3));
      if (d.h.startsWith('n')) b.style.top = `${d.t + d.hgt - b.getBoundingClientRect().height}px`;   // 위 모서리: 아래 변 고정
    }
  }
  function boxUp() { if (!drag) return; drag = null; for (const g of guides) g.hidden = true; }
  addEventListener('pointermove', boxMove);
  addEventListener('pointerup', boxUp);
  addEventListener('pointercancel', boxUp);
  addEventListener('keydown', (e) => {
    if (!cfg || !picked || drag) return;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) { if (e.key === 'Escape' && t.isContentEditable) t.blur(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); picked.remove(); boxes.splice(boxes.indexOf(picked), 1); picked = null; }
  }, true);
  root.addEventListener('pointerdown', (e) => { if (picked && !e.target.closest('.pr-play') && !e.target.closest('.pr-sbx')) pickBox(null); });
  function clearBoxes() { for (const b of boxes) b.remove(); boxes.length = 0; picked = null; }

  // ---------- 탭 ----------
  function setTab(id) {
    tab = id;
    for (const b of tabsRow.children) { const on = b.dataset.t === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
    say('');
    const reset = el('button', { type: 'button', class: 'ghost', onclick: () => { tween = null; restoreAll(); if (target) pick(target); say('처음 자리로 돌렸어요'); } }, '처음 자리로');
    if (id === 'command') {
      body.replaceChildren(el('div', { class: 'pr-sbx-cmd' }, input, runBtn), out, note, el('div', { class: 'pr-sbx-row' }, reset));
      note.textContent = cfg?.notes.command ?? '';
      if (!input.value && cfg?.command) typing = { text: cfg.command, i: 0, acc: 0 };
    } else if (id === 'direct') {
      body.replaceChildren(chips, tools, out, note, el('div', { class: 'pr-sbx-row' }, reset));
      note.textContent = cfg?.notes.direct ?? '';
      renderChips();
    } else {
      body.replaceChildren(el('div', { class: 'pr-sbx-row' },
        el('button', { type: 'button', class: 'pr-sbx-run', onclick: () => addBox() }, '+ 글 상자'),
        el('button', { type: 'button', class: 'ghost', onclick: () => clearBoxes() }, '모두 지우기')), out, note);
      note.textContent = cfg?.notes.text ?? '';
    }
    const direct = id === 'direct';
    layer.hidden = !direct;
    root.classList.toggle('sbx-direct', direct);
    if (direct) ensureTC().then(() => { if (tab !== 'direct' || !cfg) return; if (target) tc.attach(unit(target)); setTool(tc.mode ?? 'translate'); });
    else if (tc?.object) tc.detach();
  }

  // ---------- 열기·닫기 ----------
  function open(c) {
    cfg = c;
    title.textContent = c.title;
    panel.hidden = false;
    root.classList.add('sbx-open');
    if (!target || !unit(target)) target = c.target;
    pick(target);
    input.value = '';
    setTab('command');
  }
  function close() {
    if (!cfg) return;
    cfg = null; tween = null; typing = null;
    panel.hidden = true; layer.hidden = true; tag.hidden = true;
    root.classList.remove('sbx-open', 'sbx-direct');
    if (tc?.object) tc.detach();
    if (ring) ring.visible = false;
    restoreAll();
    clearBoxes();
    target = null;
    for (const g of guides) g.hidden = true;
  }

  /** 매 프레임: 타자·옮겨 가기·고리·이름표 */
  const v = new THREE.Vector3();
  function update(dt) {
    if (!cfg) return;
    if (typing) {
      typing.acc += dt * TYPE_CPS;
      const n = Math.min(typing.text.length, Math.floor(typing.acc));
      if (n !== typing.i) { typing.i = n; input.value = typing.text.slice(0, n); }
      if (n >= typing.text.length) { typing = null; runBtn.classList.add('pulse'); setTimeout(() => runBtn.classList.remove('pulse'), 2400); }
    }
    if (tween) {
      tween.t = Math.min(1, tween.t + dt / TWEEN);
      const k = EASE.calm(tween.t), a = tween.from, b = tween.to;
      place(tween.id, { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, yaw: a.yaw + (b.yaw - a.yaw) * k, scale: a.scale + (b.scale - a.scale) * k });
      if (tween.t >= 1) tween = null;
    }
    const u = target && unit(target);
    if (u && ring) {
      ring.position.set(u.position.x, app.terrain.height(u.position.x, u.position.z) + 0.015, u.position.z);
      ring.visible = tab === 'command';                      // 기즈모·글 상자를 쓰는 동안은 고리를 숨김
      ring.material.opacity = 0.55 + 0.3 * Math.sin(performance.now() / 260);
      const o = orig.get(target);
      v.set(u.position.x, u.position.y + tagH * (u.scale.x / (o?.scale || 1)) + 0.08, u.position.z).project(app.camera);
      tag.hidden = v.z > 1 || tab === 'text';
      tag.textContent = nameOf(target);
      tag.style.left = `${((v.x + 1) / 2) * innerWidth}px`;
      tag.style.top = `${((1 - v.y) / 2) * innerHeight}px`;
    }
  }

  return {
    get isOpen() { return !!cfg; },
    get target() { return target; },
    get tab() { return tab; },
    toggle(c) { if (cfg) close(); else open(c); return !!cfg; },
    open, close, update, setTab, run, addBox,
    /** 검사용 */
    setCommand(t) { typing = null; input.value = t; },
  };
}
