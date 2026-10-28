// 인트로 (Presentation Mode) — 현재 디오라마를 배경으로 한 장씩 넘기는 전시형 소개 → "탐험하러 가기"에서 빗물이 필터를 씻어 내며 탐험(Explore)으로.
// 내용·카메라·필터·전환 값은 모두 web/config/presentation.json (logic/presentation_model.js가 읽고 검사). 이 파일에는 문구를 두지 않음.
// 모드: off(탐험) · present(인트로) · wash(씻김 전환 중) · preview(편집기 미리보기: 글·필터만, 카메라·입력은 편집기가).
// 인트로 동안: 장면은 계속 살아 있음(불·연기·별·캐릭터 대기 동작), 캐릭터 이동·쉬기·카메라 조작·날씨·촬영 입력은 막음(화면을 덮는 층이 입력을 받음).
// 상태 관리: 인트로는 카메라만 덮어쓰고(rig.setOverride) 날씨·오로라·불·화면·품질 설정은 건드리지 않음. 탐험으로 갈 때 마지막 섹션 카메라를 감상 카메라로 넘김.
import { visibleSections, effectiveFilter, effectiveTransition, EASE, lerpCamera, FILTER_RANGES } from '../logic/presentation_model.js';

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
const pad = (n) => String(n).padStart(2, '0');
/** 본문 줄바꿈(\n)을 그대로 */
const lines = (text) => text.split('\n').flatMap((ln, i) => (i ? [el('br'), ln] : [ln]));
const FILTER_KEYS = Object.keys(FILTER_RANGES);

/**
 * app: { store, rig, isPortrait(), reducedMotion(), onExplore(), onPresent(), onPresentStop(), lockedEditor? }
 */
export function createPresentation(root, config, app) {
  let cfg = config;
  let list = visibleSections(cfg);
  let mode = 'off';
  let index = 0;
  let lockUntil = 0;
  let cam = null;                       // 지금 카메라 값 (흔들림 제외)
  let camTween = null;                  // { from, to, t0, dur, ease }
  let filterCur = null, filterTween = null;
  let amount = 0, amountTween = null;   // 필터 전체 세기 (들어올 때 0→1)
  let wash = null;                      // { t0, delay, dur, onDone }
  let time = 0;
  // 시계 = update(dt)로 쌓은 실제 시간 (전환·씻김·입력 잠금 모두). performance.now 대신 — 검사용 advance()도 같은 결과, 뒤 탭에서는 멈춤
  const now = () => time;
  const reduced = () => !!app.reducedMotion?.();

  // ---------- DOM ----------
  const cur = el('span', { class: 'pr-cur' }, '01');
  const total = el('span', { class: 'pr-total' }, '05');
  const bar = el('i', { class: 'pr-bar' }, el('b'));
  const name = el('span', { class: 'pr-name' });
  const skip = el('button', { class: 'pr-skip', type: 'button', onclick: () => explore() }, '바로 탐험하기');
  const rail = el('nav', { class: 'pr-rail', 'aria-label': '섹션' });
  const stage = el('div', { class: 'pr-stage' });
  const hint = el('div', { class: 'pr-hint', 'aria-hidden': 'true' });
  const live = el('div', { class: 'pr-live', 'aria-live': 'polite' });
  const scrim = el('div', { class: 'pr-scrim' });
  root.className = 'pr';
  root.hidden = true;
  root.setAttribute('role', 'region');
  root.setAttribute('aria-roledescription', '소개');
  root.setAttribute('aria-label', '작품 소개');
  root.tabIndex = -1;
  root.replaceChildren(scrim, el('header', { class: 'pr-top' }, el('div', { class: 'pr-index' }, cur, bar, total, name), skip), stage, rail, hint, live);
  let article = null;

  function sectionCamera(s) {
    return (app.isPortrait?.() && s.cameraMobile) ? s.cameraMobile : s.camera;
  }
  function renderSection(s, i) {
    const lay = s.layout;
    const media = s.media.layout !== 'none' ? s.media.items.slice(0, { single: 1, compare: 2, cards: 3 }[s.media.layout]).filter((m) => m.src || m.caption) : [];
    const fig = (m, k) => el('figure', { class: 'pr-fig' },
      m.src ? el('img', { src: m.src, alt: m.caption || '', loading: 'lazy', decoding: 'async', onerror: (e) => { e.target.closest('figure').classList.add('noimg'); } }) : el('div', { class: 'pr-ph' }),
      m.caption ? el('figcaption', {}, s.media.layout === 'cards' ? el('span', { class: 'pr-n' }, pad(k + 1)) : null, m.caption) : null);
    const mediaBox = media.length ? el('div', { class: `pr-media m-${s.media.layout}` },
      s.media.layout === 'compare' ? [fig(media[0], 0), el('span', { class: 'pr-arrow', 'aria-hidden': 'true' }, '→'), media[1] ? fig(media[1], 1) : null] : media.map(fig)) : null;
    const cta = s.action ? el('button', { class: 'pr-cta', type: 'button', onclick: () => explore() }, s.action.label) : null;
    const inner = el('div', { class: 'pr-in' },
      s.label ? el('div', { class: 'pr-label' }, s.label) : null,
      s.title ? el('h1', { class: 'pr-title' }, lines(s.title)) : null,
      s.subtitle ? el('p', { class: 'pr-sub' }, s.subtitle) : null,
      s.body ? el('p', { class: 'pr-body' }, lines(s.body)) : null,
      s.keywords.length ? el('ul', { class: 'pr-keys' }, s.keywords.map((k) => el('li', {}, k))) : null,
      mediaBox, cta);
    return el('article', { class: `pr-sec a-${lay.align} v-${lay.vertical}`, style: `--maxw:${lay.maxWidth}px`, 'data-index': i }, inner);
  }
  function chrome() {
    const n = list.length;
    cur.textContent = pad(index + 1);
    total.textContent = pad(n);
    bar.style.setProperty('--p', n > 1 ? index / (n - 1) : 1);
    name.textContent = list[index]?.label ?? '';
    const last = index === n - 1;
    hint.textContent = last ? '' : app.isPortrait?.() ? 'SWIPE ↑' : 'SCROLL ↓';
    skip.hidden = last || mode !== 'present';
    rail.replaceChildren(...list.map((s, i) => el('button', { type: 'button', class: i === index ? 'on' : '', 'aria-label': `${pad(i + 1)} ${s.label || s.title}`, 'aria-current': i === index ? 'step' : null, onclick: () => goto(i) }, el('i'))));
    root.dataset.align = list[index]?.layout.align ?? 'left';
    root.dataset.vertical = list[index]?.layout.vertical ?? 'bottom';
  }
  /** 글 층 바꾸기: 나가는 글은 위(다음)/아래(이전)로, 들어오는 글은 반대쪽에서 */
  function swapContent(dir, dur) {
    const s = list[index];
    const next = renderSection(s, index);
    const old = article;
    root.style.setProperty('--pr-dur', `${reduced() ? 0.01 : dur}s`);
    if (old) {
      old.classList.add(dir >= 0 ? 'leave-up' : 'leave-down');
      old.setAttribute('aria-hidden', 'true');
      setTimeout(() => old.remove(), (reduced() ? 0.05 : dur) * 1000 + 60);
    }
    next.classList.add(dir >= 0 ? 'enter-below' : 'enter-above');
    stage.append(next);
    next.getBoundingClientRect();                       // 시작 위치를 먼저 계산시키고 바로 풀어 전환 (rAF에 기대지 않음 — 뒤 탭에서도 글이 남지 않게)
    next.classList.remove('enter-below', 'enter-above');
    article = next;
    live.textContent = [s.label, s.title].filter(Boolean).join(' — ');
    chrome();
  }

  // ---------- 카메라·필터 보간 ----------
  function aimCamera(s, dur, easing) {
    const to = sectionCamera(s);
    const rc = app.rig.current;
    const from = cam ?? (rc ? { azimuth: rc.azimuth, elevation: rc.elevation, distance: rc.distance, lens: rc.lens, target: rc.target.toArray() } : null);
    if (reduced() || dur <= 0 || !from) { cam = { ...to, target: [...to.target] }; camTween = null; return; }
    camTween = { from: { ...from, target: [...from.target] }, to, t0: now(), dur, ease: EASE[easing] ?? EASE.calm };
  }
  function aimFilter(s, dur) {
    const to = effectiveFilter(cfg, s);
    if (!filterCur || reduced() || dur <= 0) { filterCur = { ...to }; filterTween = null; return; }
    filterTween = { from: { ...filterCur }, to, t0: now(), dur };
  }
  function fadeAmount(to, dur) {
    if (reduced() || dur <= 0) { amount = to; amountTween = null; return; }
    amountTween = { from: amount, to, t0: now(), dur };
  }

  // ---------- 이동 ----------
  function goto(i, { instant = false } = {}) {
    if (mode !== 'present' && mode !== 'preview') return false;
    if (i < 0 || i >= list.length) return false;
    if (mode === 'present' && now() < lockUntil && !instant) return false;
    const dir = i >= index ? 1 : -1;
    const changed = i !== index || !article;
    index = i;
    const s = list[index];
    const tr = effectiveTransition(cfg, s);
    const camDur = instant ? 0 : tr.camera;
    if (mode === 'present') aimCamera(s, camDur, tr.easing);
    aimFilter(s, instant ? 0 : Math.max(0.4, camDur));
    if (changed) swapContent(dir, instant ? 0.01 : tr.content);
    else chrome();
    lockUntil = now() + (instant ? 0 : Math.max(tr.camera, tr.content) * (reduced() ? 0.3 : 0.85) + tr.inputLock);
    return true;
  }
  const next = () => goto(index + 1);
  const prev = () => goto(index - 1);

  function setBodyMode(m) {
    document.body.classList.toggle('present-mode', m === 'present' || m === 'wash');
    document.body.classList.toggle('present-wash', m === 'wash');
    document.body.classList.toggle('present-preview', m === 'preview');
    root.classList.toggle('preview', m === 'preview');
    root.classList.toggle('washing', m === 'wash');
  }

  /** 인트로 시작 (처음 접속 또는 "인트로 다시 보기"). instant = 카메라를 바로 그 자리에(첫 화면) */
  function start(i = 0, { instant = false } = {}) {
    if (!list.length) return false;
    const wasOff = mode === 'off';
    mode = 'present';
    wash = null;
    setBodyMode(mode);
    root.hidden = false;
    app.onPresent?.();
    index = Math.min(Math.max(0, i), list.length - 1);
    if (article) { article.remove(); article = null; }
    if (wasOff && !instant) { const c = app.rig.current; cam = { azimuth: c.azimuth, elevation: c.elevation, distance: c.distance, lens: c.lens, target: c.target.toArray() }; }
    const s = list[index];
    const tr = effectiveTransition(cfg, s);
    aimCamera(s, instant ? 0 : Math.max(tr.camera, 1.4), tr.easing);
    if (instant) cam = { ...sectionCamera(s), target: [...sectionCamera(s).target] };
    aimFilter(s, 0);
    fadeAmount(1, instant ? 0 : 0.9);
    if (instant) amount = 1;
    swapContent(1, instant ? 0.01 : tr.content);
    lockUntil = now() + (instant ? 0.2 : 0.9);
    root.focus({ preventScroll: true });
    return true;
  }

  /** 탐험하러 가기: 빗물이 필터를 씻어 냄 → 탐험. 다른 섹션에서 부르면(바로 탐험하기) 카메라는 마지막 섹션 시점으로 같이 이동 */
  function explore() {
    if (mode !== 'present') return false;
    mode = 'wash';
    setBodyMode(mode);
    const last = list[list.length - 1];
    if (index !== list.length - 1) aimCamera(last, cfg.explore.washDuration * 0.9, 'calm');
    article?.classList.add('leave-up');
    skip.hidden = true;
    const dur = reduced() ? 0.35 : cfg.explore.washDuration;
    wash = { t0: now(), delay: reduced() ? 0 : 0.25, dur };
    return true;
  }
  function finishWash() {
    const finalCam = sectionCamera(list[list.length - 1]);
    wash = null;
    mode = 'off';
    amount = 0; amountTween = null;
    setBodyMode(mode);
    root.hidden = true;
    if (article) { article.remove(); article = null; }
    // 감상 카메라 = 지금 인트로 카메라 (흔들림 제외) → 해제해도 튀지 않음
    const c = cam ?? finalCam;
    app.onExplore?.({ azimuth: c.azimuth, elevation: c.elevation, distance: c.distance, lens: c.lens, target: [...c.target] });
    cam = null; camTween = null;
    app.rig.setOverride(null);
  }

  /** 편집기 미리보기: 글·필터만 (카메라·입력은 편집기·사용자) */
  function preview(i) {
    mode = 'preview';
    setBodyMode(mode);
    root.hidden = false;
    app.rig.setOverride(null);
    cam = null; camTween = null;
    const changed = i !== index || !article;
    index = Math.min(Math.max(0, i), list.length - 1);
    aimFilter(list[index], 0);
    amount = 1; amountTween = null;
    if (changed) { if (article) { article.remove(); article = null; } swapContent(1, 0.01); } else { article?.replaceWith(article = renderSection(list[index], index)); chrome(); }
  }
  /** 바로 끔 (편집기에서 미리보기 끄기 등). 카메라는 놓아줌 */
  function stop() {
    mode = 'off'; wash = null; amount = 0; amountTween = null; cam = null; camTween = null;
    setBodyMode(mode);
    root.hidden = true;
    if (article) { article.remove(); article = null; }
    app.rig.setOverride(null);
  }

  // ---------- 입력 (인트로 중에만) ----------
  let wheelAcc = 0, wheelLast = 0;
  root.addEventListener('wheel', (e) => {
    if (mode === 'preview') return;
    e.preventDefault();
    if (mode !== 'present') return;
    const t = now();
    if (t - wheelLast > 0.25) wheelAcc = 0;          // 한 번의 휠 동작(관성 포함)을 한 번으로
    wheelLast = t;
    if (t < lockUntil) { wheelAcc = 0; return; }
    wheelAcc += Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY * (e.deltaMode === 1 ? 32 : 1) : 0;
    if (wheelAcc > 40) { wheelAcc = 0; next(); } else if (wheelAcc < -40) { wheelAcc = 0; prev(); }
  }, { passive: false });
  let touch = null;
  root.addEventListener('touchstart', (e) => { if (mode === 'present' && e.touches.length === 1) touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: now() }; }, { passive: true });
  root.addEventListener('touchmove', (e) => { if (mode === 'present' && !e.target.closest('button')) e.preventDefault(); }, { passive: false });   // 당겨서 새로고침·스크롤 막기
  root.addEventListener('touchend', (e) => {
    if (!touch || mode !== 'present') { touch = null; return; }
    const tt = e.changedTouches[0];
    const dx = tt.clientX - touch.x, dy = tt.clientY - touch.y;
    touch = null;
    if (Math.abs(dy) < 40 || Math.abs(dy) < Math.abs(dx) * 1.2) return;
    if (dy < 0) next(); else prev();                   // 위로 쓸면 다음
  });
  addEventListener('keydown', (e) => {
    if (mode !== 'present' || e.isComposing) return;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    const k = e.key || e.code;                         // 일부 입력기·도구는 key가 비어 있음 → code로
    let handled = true;
    if (k === 'ArrowDown' || k === 'PageDown' || (k === ' ' && t?.tagName !== 'BUTTON') || k === 'ArrowRight') next();
    else if (k === 'ArrowUp' || k === 'PageUp' || k === 'ArrowLeft') prev();
    else if (k === 'Home') goto(0);
    else if (k === 'End') goto(list.length - 1);
    else if (k === 'Escape') handled = !!app.onEscape?.();                 // 편집기에서 재생 중일 때만 (일반 방문자는 Esc로 인트로가 꺼지지 않음)
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // ---------- 매 프레임 ----------
  function update(realDt) {
    time += realDt;
    const t = now();
    if (amountTween) {
      const k = Math.min(1, (t - amountTween.t0) / amountTween.dur);
      amount = amountTween.from + (amountTween.to - amountTween.from) * EASE.calm(k);
      if (k >= 1) amountTween = null;
    }
    if (filterTween) {
      const k = EASE.calm(Math.min(1, (t - filterTween.t0) / filterTween.dur));
      for (const key of FILTER_KEYS) filterCur[key] = filterTween.from[key] + (filterTween.to[key] - filterTween.from[key]) * k;
      if (k >= 1) filterTween = null;
    }
    if (mode === 'present' || mode === 'wash') {
      if (camTween) {
        const k = Math.min(1, (t - camTween.t0) / camTween.dur);
        cam = lerpCamera(camTween.from, camTween.to, camTween.ease(k));
        if (k >= 1) camTween = null;
      }
      if (cam) {
        const d = reduced() ? 0 : cfg.ambient.drift;      // 아주 느린 숨쉬기 (지정 시점을 유지하며 살아 있는 느낌)
        app.rig.setOverride({ ...cam, azimuth: cam.azimuth + d * Math.sin(time * 0.13), elevation: Math.max(0, cam.elevation + d * 0.4 * Math.sin(time * 0.17 + 1.3)) });
      }
    }
    if (wash && t - wash.t0 >= wash.delay + wash.dur) finishWash();
  }
  /** 후처리에 넘길 값 (null = 필터 단계 없음) */
  function renderState() {
    if (mode === 'off' || !filterCur) return null;
    let w = -1;
    if (wash) w = Math.max(0, Math.min(1, (now() - wash.t0 - wash.delay) / wash.dur));
    return { amount, wash: w, filter: filterCur, seed: cfg.explore.seed, streaks: cfg.explore.streaks };
  }
  /** 섹션 카메라의 심도(있으면) */
  function dof() {
    if (mode !== 'present' && mode !== 'wash') return null;
    const c = sectionCamera(list[index]);
    return c?.dof?.on ? c.dof : null;
  }
  /** 화면 효과: 블룸을 필터 값만큼 (씻기는 동안 원래로) */
  function screen(base) {
    if (mode === 'off' || !filterCur) return base;
    let k = amount;
    if (wash) k *= 1 - Math.max(0, Math.min(1, (now() - wash.t0 - wash.delay) / wash.dur));
    const bloom = (base.bloom ?? 0.35) * (1 + ((filterCur.bloom ?? 1) - 1) * k * (filterCur.strength ?? 1));
    return { ...base, bloom };
  }

  return {
    get mode() { return mode; },
    get active() { return mode !== 'off'; },
    get blocking() { return mode === 'present' || mode === 'wash'; },
    get index() { return index; },
    get count() { return list.length; },
    get config() { return cfg; },
    get camera() { return cam; },
    start, goto, next, prev, explore, preview, stop, update, renderState, dof, screen,
    /** 설정 바꾸기 (편집기 실시간 미리보기·가져오기). 지금 섹션을 다시 그림 */
    setConfig(c, { keepIndex = true } = {}) {
      cfg = c;
      list = visibleSections(cfg);
      if (!keepIndex) index = 0;
      index = Math.min(index, Math.max(0, list.length - 1));
      if (mode === 'off') return;
      const s = list[index];
      if (!s) return;
      aimFilter(s, 0.3);
      if (article) { const n = renderSection(s, index); article.replaceWith(n); article = n; }
      chrome();
    },
  };
}
