// 관리자 편집 모드 들어가기 (U-18): 설정 패널 버튼 또는 주소 ?edit → 관리자 번호를 물음. 맞으면 이 탭이 닫힐 때까지 다시 묻지 않음(sessionStorage).
// 번호 확인은 logic/admin_pin.js (해시만 비교). 틀리면 5번마다 30초 기다림. 브라우저 안의 가림막일 뿐이라는 한계는 admin_pin.js 머리말.
import { checkPin, ADMIN_PIN_HASH } from '../logic/admin_pin.js';

const KEY = 'camping.admin.v1', FAIL = 'camping.admin.fail.v1';
const TOKEN = ADMIN_PIN_HASH.slice(0, 16);
const LOCK_AFTER = 5, LOCK_SEC = 30;
const ss = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* 사생활 모드 — 이번 화면만 */ } },
};
let unlockedHere = false;

export const adminUnlocked = () => unlockedHere || ss.get(KEY) === TOKEN;
export function adminLock() { unlockedHere = false; ss.set(KEY, null); }
/** 편집 모드 주소 (지금 주소에 ?edit, 인트로·기타 값은 뺌) */
export function editUrl() {
  const u = new URL(location.href);
  u.search = '?edit';
  return u.toString();
}

/** 관리자 번호 창. 맞으면 true, 취소면 false */
export function askAdminPin({ title = '관리자 편집 모드', cancelLabel = '취소' } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'admin-pin';
    wrap.innerHTML = `
      <form class="admin-box" role="dialog" aria-modal="true" aria-labelledby="adminT">
        <strong id="adminT"></strong>
        <p class="admin-desc">관리자 번호를 아는 사람만 편집 모드를 쓸 수 있어요.</p>
        <input type="password" inputmode="numeric" autocomplete="off" maxlength="8" aria-label="관리자 번호" placeholder="관리자 번호">
        <p class="admin-msg" role="alert"></p>
        <div class="admin-row"><button type="button" class="ghost" data-x></button><button type="submit" class="accent">들어가기</button></div>
      </form>`;
    wrap.querySelector('#adminT').textContent = title;
    wrap.querySelector('[data-x]').textContent = cancelLabel;
    const input = wrap.querySelector('input'), msg = wrap.querySelector('.admin-msg');
    document.body.append(wrap);
    input.focus();
    const done = (v) => { wrap.remove(); removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } };
    addEventListener('keydown', onKey, true);
    wrap.querySelector('[data-x]').addEventListener('click', () => done(false));
    wrap.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = JSON.parse(ss.get(FAIL) || '{"n":0,"until":0}');
      const wait = Math.ceil((f.until - Date.now()) / 1000);
      if (wait > 0) { msg.textContent = `여러 번 틀려서 ${wait}초 뒤에 다시 해 주세요`; return; }
      if (checkPin(input.value)) {
        ss.set(FAIL, null); ss.set(KEY, TOKEN); unlockedHere = true;
        done(true);
        return;
      }
      f.n += 1;
      if (f.n % LOCK_AFTER === 0) f.until = Date.now() + LOCK_SEC * 1000;
      ss.set(FAIL, JSON.stringify(f));
      input.value = '';
      msg.textContent = f.n % LOCK_AFTER === 0 ? `${LOCK_SEC}초 뒤에 다시 해 주세요` : '번호가 맞지 않아요';
      input.focus();
    });
  });
}
