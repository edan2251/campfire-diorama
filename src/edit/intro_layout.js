// 인트로 편집: 미리보기 화면의 글 상자·자료(이미지) 상자를 PPT처럼 끌어 옮기고 크기 조절 (2026-10-29, 사용자 요청 U-16).
// - 상자 끌기 = 옮기기. 모서리 네 점 = 크기(글은 글자까지 같이 커짐, 반대쪽 모서리 고정), 좌우 가운데 점 = 너비만(글 줄바꿈).
// - 처음 끌면 자동 배치(정렬·세로 위치) 상자가 그 자리 그대로 자유 배치(layout.box / media.box, 화면 %)로 바뀜.
//   글 안에 있던 자료를 끌면 자료가 따로 떨어진 상자가 됨.
// - 맞춤선: 화면 가장자리 여백·가운데에 가까우면 붙음(분홍 선). Alt를 누른 채 끌면 붙지 않음.
// - 방향키 = 0.2% 옮기기(Shift = 2%), Esc = 선택 해제. 휴대폰 화면(좁거나 세로)은 자동 배치라 상자를 쓰지 않음.
// 값 저장은 편집기가: onChange(kind, box, live) — live = 끄는 중(이력 없음), 아니면 이력 한 단계 + 다시 그림.

const r2 = (v) => Math.round(v * 100) / 100;

/**
 * app: { root: 인트로 층(#present), pres(): 인트로 런타임, getBox(kind), onChange(kind, box, live), onPick(kind|null) }
 * kind = 'text' | 'media'
 */
export function createIntroLayout(app) {
  const root = app.root;
  let on = false;
  let picked = null;                    // 'text' | 'media' | null
  let drag = null;                      // { kind, mode, handle, x0, y0, box0, h0, el }
  const guides = [];

  const rr = () => root.getBoundingClientRect();                       // 인트로 층 (편집 모드 화면 나누기에서는 패널 오른쪽 영역)
  const vw = () => rr().width, vh = () => rr().height;
  const edgePct = () => { const e = Math.min(76, Math.max(20, vw() * 0.044)); return { x: (e / vw()) * 100, y: (e * 0.62 / vh()) * 100 }; };
  const slide = () => app.pres().slide;
  const boxEl = (kind) => slide()?.querySelector(`.pr-sec[data-box="${kind}"]`) ?? null;

  function decorate() {
    const s = slide();
    if (!s) return;
    for (const sec of s.querySelectorAll('.pr-sec[data-box]')) {
      sec.classList.toggle('picked', on && sec.dataset.box === picked);
      if (sec.querySelector(':scope > .pr-h')) continue;
      for (const h of ['nw', 'ne', 'sw', 'se', 'w', 'e']) sec.append(Object.assign(document.createElement('i'), { className: `pr-h ${h}` }));
      sec.append(Object.assign(document.createElement('span'), { className: 'pr-boxinfo' }));
    }
    info();
  }
  const mo = new MutationObserver(() => { if (on) decorate(); });
  mo.observe(root.querySelector('.pr-stage') ?? root, { childList: true });   // 장(slide)이 바뀔 때만 — 상자 안 글자 변경은 보지 않음

  function info() {
    const k = picked && boxEl(picked);
    if (!k) return;
    const b = app.getBox(picked);
    const tag = k.querySelector(':scope > .pr-boxinfo');
    const t = b
      ? `${picked === 'text' ? '글' : '자료'} · x ${b.x.toFixed(1)}% y ${b.y.toFixed(1)}% · 너비 ${b.w.toFixed(1)}%${b.scale ? ` · 크기 ${Math.round(b.scale * 100)}%` : ''}`
      : `${picked === 'text' ? '글' : '자료'} · 자동 배치 (끌면 자유 배치)`;
    if (tag && tag.textContent !== t) tag.textContent = t;
  }
  function pick(kind) {
    picked = kind;
    decorate();
    app.onPick?.(kind);
  }

  /** 지금 화면의 상자 자리(%) — 자동 배치 상자를 자유 배치로 바꿀 때 그 자리 그대로 */
  function measure(el, kind) {
    const inner = kind === 'media' && !el.classList.contains('pr-mbox') ? el : el.querySelector(':scope > .pr-in') ?? el;
    const r = el.getBoundingClientRect(), ri = inner.getBoundingClientRect(), o = rr();
    return { x: r2(((r.left - o.left) / o.width) * 100), y: r2(((ri.top - o.top) / o.height) * 100), w: r2((r.width / o.width) * 100), h: (ri.height / o.height) * 100 };
  }

  function setGuides(list) {
    for (const g of guides.splice(0)) g.remove();
    for (const [dir, pos] of list) {
      const g = Object.assign(document.createElement('div'), { className: `pr-guide ${dir}` });
      g.style[dir === 'v' ? 'left' : 'top'] = `${pos}%`;
      root.append(g);
      guides.push(g);
    }
  }
  /** 맞춤선: 왼쪽·가운데·오른쪽 / 위·가운데·아래를 화면 여백·가운데에 붙임 */
  function snap(b, h, free) {
    if (free) { setGuides([]); return b; }
    const E = edgePct(), T = 0.8, lines = [];
    const xs = [E.x, 50, 100 - E.x], ys = [E.y + 5, 50, 100 - E.y - 4];
    let best = null;
    for (const [off, k] of [[0, 0], [b.w / 2, 1], [b.w, 2]]) for (const x of xs) { const d = x - (b.x + off); if (Math.abs(d) < T && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, x, k }; }
    if (best) { b.x = r2(b.x + best.d); lines.push(['v', best.x]); }
    best = null;
    for (const [off] of [[0], [h / 2], [h]]) for (const y of ys) { const d = y - (b.y + off); if (Math.abs(d) < T && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, y }; }
    if (best) { b.y = r2(b.y + best.d); lines.push(['h', best.y]); }
    setGuides(lines);
    return b;
  }
  function apply(el, b) {
    el.style.left = `${b.x}%`; el.style.top = `${b.y}%`; el.style.width = `${b.w}%`;
    if (b.scale) el.style.setProperty('--pr-zoom', b.scale);
  }

  function down(e) {
    if (!on || e.button !== 0 || app.pres().mode !== 'preview') return;
    if (e.target.closest('.pr-demo-b, .pr-sbx-toggle')) return;   // 체험 버튼·패널 버튼은 누르기 (끌기 아님)
    const sec = e.target.closest('.pr-sec[data-box]');
    if (!sec || !root.contains(sec)) return;
    e.preventDefault(); e.stopPropagation();
    const handle = e.target.classList.contains('pr-h') ? [...e.target.classList].find((c) => c !== 'pr-h') : null;
    // 글 안에 들어 있는 자료를 끌면 자료만 따로
    const inMedia = !handle && sec.dataset.box === 'text' && e.target.closest('.pr-media');
    const kind = inMedia ? 'media' : sec.dataset.box;
    pick(kind);
    let el = inMedia ? e.target.closest('.pr-media') : sec;
    let box = app.getBox(kind);
    const m = measure(el, kind);
    if (!box) {                                    // 자동 배치 → 지금 자리 그대로 자유 배치로 바꾸고 다시 그림
      box = kind === 'text' ? { x: m.x, y: m.y, w: m.w, scale: 1 } : { x: m.x, y: m.y, w: m.w };
      app.onChange(kind, box, true);
      app.pres().rerender();
      el = boxEl(kind);
      if (!el) return;
    }
    drag = { kind, handle, x0: e.clientX, y0: e.clientY, box0: { ...box }, h0: m.h, el, moved: false };
    root.classList.add('dragging');
  }
  function move(e) {
    if (!drag) return;
    const dx = ((e.clientX - drag.x0) / vw()) * 100, dy = ((e.clientY - drag.y0) / vh()) * 100;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 3) return;
    drag.moved = true;
    const b0 = drag.box0, b = { ...b0 };
    const H = drag.handle;
    if (!H) {
      b.x = r2(b0.x + dx); b.y = r2(b0.y + dy);
      snap(b, drag.h0, e.altKey);
    } else {
      const west = H.includes('w'), corner = H.length === 2;
      const w = Math.max(8, b0.w + (west ? -dx : dx));
      b.w = r2(w);
      if (west) b.x = r2(b0.x + (b0.w - w));
      if (corner) {
        const f = w / b0.w;
        if (drag.kind === 'text') b.scale = Math.round(Math.min(3, Math.max(0.4, b0.scale * f)) * 1000) / 1000;
        if (H.startsWith('n')) b.y = r2(b0.y + drag.h0 * (1 - f));          // 위 모서리: 아래 변 고정
      }
      setGuides([]);
    }
    drag.box = b;
    apply(drag.el, b);
    app.onChange(drag.kind, b, true);
    info();
  }
  function up() {
    if (!drag) return;
    const d = drag;
    drag = null;
    root.classList.remove('dragging');
    setGuides([]);
    app.onChange(d.kind, d.box ?? app.getBox(d.kind), false);
  }
  function key(e) {
    if (!on || !picked || app.pres().mode !== 'preview') return;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (e.key === 'Escape') { pick(null); return; }
    const step = e.shiftKey ? 2 : 0.2;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    const b = app.getBox(picked);
    if (!d || !b) return;
    e.preventDefault();
    app.onChange(picked, { ...b, x: r2(b.x + d[0]), y: r2(b.y + d[1]) }, false);
  }
  root.addEventListener('pointerdown', down, true);
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
  addEventListener('keydown', key);

  return {
    get picked() { return picked; },
    get dragging() { return !!drag; },
    setOn(v) { on = !!v; app.pres().setLayoutEdit(on); if (!on) { picked = null; setGuides([]); } decorate(); },
    pick,
    decorate,
  };
}
