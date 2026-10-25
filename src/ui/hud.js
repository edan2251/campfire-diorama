// 첫 방문 안내·감상/촬영 바로가기 (PUB-02). 설정 패널(panel.js)과 같은 #ui 안 — 캔버스 밖 DOM이라 클릭·드래그가 캐릭터·카메라로 가지 않는다.
// 안내: 첫 방문에 한 번 펼침(닫으면 브라우저에 기억), 도움말 버튼으로 다시 열기. 자세한 조작은 접은 칸 안.
// 촬영 막대: 촬영 모드에서만 — 사진 저장(PNG)·일시 정지/재개·UI 숨기기·감상으로. 기능은 store·app 훅을 그대로 씀(새 상태 없음).
const SEEN_KEY = 'camping.help.seen.v1';

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};

/** app 훅: { savePNG(): Promise, setUIHidden(bool), storage, autoHelp: bool } */
export function createHud(root, store, app) {
  const touch = matchMedia('(pointer: coarse)').matches;
  const QUICK = touch
    ? ['땅을 탭하면 걸어가요', '통나무를 탭하면 기대어 쉬어요', '한 손가락으로 둘러보고, 두 손가락으로 벌려 가까이 보세요']
    : ['땅을 클릭하면 걸어가요', '통나무를 클릭하면 기대어 쉬어요', '드래그로 둘러보고, 휠로 가까이 보세요'];
  const MORE = touch
    ? ['두 손가락으로 끌기: 화면 옮기기', '쉬는 중에 땅을 탭하면 일어나서 걸어가요', '촬영: 오른쪽 위 “촬영” → 사진 저장(PNG)', '설정(아래 시트): 불·별·오로라·비, 카메라, 화면 효과, 품질']
    : ['왼쪽 또는 오른쪽 버튼 드래그: 둘러보기', '휠 버튼 드래그: 화면 옮기기', '쉬는 중에 땅을 클릭하면 일어나서 걸어가요', '촬영: 오른쪽 위 “촬영” → 사진 저장(PNG)', 'UI를 숨긴 뒤에는 Esc 또는 “UI 보이기”로 되돌려요', '설정(⚙): 불·별·오로라·비, 카메라, 화면 효과, 품질'];

  // ---------- 오른쪽 위 바로가기 ----------
  const helpBtn = el('button', { class: 'hud-btn round', type: 'button', 'aria-label': '조작 도움말', 'aria-expanded': 'false', 'aria-controls': 'helpCard', title: '조작 도움말', onclick: () => (helpOpen ? closeHelp() : openHelp(true)) },
    el('span', { 'aria-hidden': 'true' }, '?'));
  const shootBtn = el('button', { class: 'hud-btn', type: 'button', title: '촬영 모드 — 사진 저장(PNG)·일시 정지', onclick: () => store.enterPhoto() },
    el('span', { 'aria-hidden': 'true', class: 'ico' }, '📷'), '촬영');
  const hud = el('div', { class: 'hud' }, helpBtn, shootBtn);

  // ---------- 조작 안내 ----------
  const more = el('details', { class: 'help-more' }, el('summary', {}, '자세한 조작'), el('ul', {}, MORE.map((t) => el('li', {}, t))),
    el('p', { class: 'help-credit' }, '3D 모델: Tripo AI로 제작 · 렌더링: three.js (MIT 라이선스)'));   // 제작 출처 (개인 계정명 없음)
  const closeBtn = el('button', { class: 'help-close', type: 'button', onclick: () => closeHelp() }, '알겠어요');
  const card = el('section', { class: 'help', id: 'helpCard', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'helpTitle', hidden: '' },
    el('h2', { id: 'helpTitle', tabindex: '-1' }, '조작 안내'),
    el('ul', { class: 'help-quick' }, QUICK.map((t) => el('li', {}, t))),
    more, closeBtn);

  // ---------- 촬영 막대 ----------
  const pngBtn = el('button', { class: 'accent', type: 'button', onclick: async () => {
    if (pngBtn.disabled) return;                                      // 연속 클릭 → 한 장만
    pngBtn.disabled = true;
    try { await app.savePNG(); } finally { pngBtn.disabled = false; }
  } }, '사진 저장 (PNG)');
  const pauseBtn = el('button', { type: 'button', 'aria-pressed': 'false', onclick: () => store.setPaused(!store.photo.paused) }, '일시 정지');
  const hideBtn = el('button', { type: 'button', onclick: () => app.setUIHidden(true) }, 'UI 숨기기');
  const backBtn = el('button', { type: 'button', class: 'ghost', onclick: () => store.exitPhoto() }, '감상으로 돌아가기');
  const bar = el('div', { class: 'photobar', role: 'toolbar', 'aria-label': '촬영', hidden: '' },
    el('span', { class: 'photobar-title' }, '촬영 모드'), pngBtn, pauseBtn, hideBtn, backBtn);

  root.append(hud, card, bar);

  let helpOpen = false, returnFocus = null;
  function openHelp(fromButton) {
    helpOpen = true; card.hidden = false; helpBtn.setAttribute('aria-expanded', 'true');
    returnFocus = fromButton ? helpBtn : null;
    if (fromButton) card.querySelector('h2').focus();
  }
  function closeHelp() {
    if (!helpOpen) return;
    helpOpen = false; card.hidden = true; more.open = false; helpBtn.setAttribute('aria-expanded', 'false');
    try { app.storage?.setItem(SEEN_KEY, '1'); } catch { /* 저장 불가(사생활 모드 등) — 다음에 다시 보일 뿐 */ }
    (returnFocus || helpBtn).focus({ preventScroll: true });
    returnFocus = null;
  }
  // Esc: 안내가 열려 있으면 안내만 닫음 (편집기 Esc·UI 보이기보다 먼저, 다른 처리로 넘기지 않음)
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !helpOpen || e.isComposing) return;
    e.stopPropagation(); e.preventDefault();
    closeHelp();
  }, true);

  function refresh() {
    const photo = store.photo.active;
    shootBtn.hidden = photo;
    bar.hidden = !photo;
    pauseBtn.textContent = store.photo.paused ? '재개' : '일시 정지';
    pauseBtn.setAttribute('aria-pressed', String(store.photo.paused));
  }
  store.subscribe((e) => { if (e.type === 'photo' || e.type === 'pause' || e.type === 'reset' || e.type === 'preset') refresh(); });
  refresh();

  // UI 숨김 복원 버튼: PC는 Esc 안내도 같이
  const hint = document.getElementById('uiHint');
  if (hint) hint.textContent = touch ? 'UI 보이기' : 'UI 보이기 (Esc)';

  let seen = false;
  try { seen = app.storage?.getItem(SEEN_KEY) === '1'; } catch { seen = false; }
  if (app.autoHelp && !seen) openHelp(false);

  return { openHelp: () => openHelp(true), closeHelp, get helpOpen() { return helpOpen; }, refresh, SEEN_KEY };
}
