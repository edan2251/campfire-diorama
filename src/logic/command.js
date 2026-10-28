// 글 명령 → 배치 동작 (인트로 체험 패널 ① "글로 시키기", U-18). AI가 아니라 정해진 낱말만 알아듣는 간단한 규칙 해석기.
// 예: "바위 1을 오른쪽으로 0.6만큼 옮기고 Y축으로 45도 돌려 줘", "텐트 1.2배로 키워 줘", "1번 바위 앞으로 0.3"
// 방향은 화면 기준: 오른쪽·왼쪽 = 화면 가로, 앞(가까이) = 카메라 쪽, 뒤(멀리) = 안쪽. 거리 단위 = 장면 단위(캐릭터 키 = 1).
// 돌리기: "N도"(+ = 위에서 볼 때 시계 반대), "오른쪽으로 돌려" = 시계 방향. 크기: "N배", "크게"(1.3배), "작게"(0.75배).

const NUM = /-?\d+(?:\.\d+)?/;
const DIRS = [['오른쪽', 'right'], ['왼쪽', 'left'], ['가까이', 'near'], ['앞', 'near'], ['멀리', 'far'], ['뒤', 'far'], ['위', 'up'], ['아래', 'down']];
export const DEFAULTS = { move: 0.5, rotate: 45, grow: 1.3, shrink: 0.75 };
export const LIMITS = { move: 3, scale: [0.3, 3] };

/** 물체 이름 규칙: "바위 1" → 바위·1 ("1번 바위", "바위1번"도), 나머지는 이름 그대로 (띄어쓰기 무시) */
function namePatterns(name) {
  const m = /^(\D+?)\s*(\d+)$/.exec(name);
  if (m) return [new RegExp(`${m[1]}\\s*${m[2]}(?!\\d)(\\s*번)?`, 'g'), new RegExp(`(?<!\\d)${m[2]}\\s*번\\s*${m[1]}`, 'g')];
  return [new RegExp(name.replace(/\s+/g, '\\s*'), 'g')];
}
/** names = [{ id, name }] → 문장에서 가장 먼저 나온 물체 id + 이름을 지운 문장(물체 번호를 거리로 잘못 읽지 않게) */
function findTarget(text, names) {
  let best = null, rest = text;
  for (const { id, name } of [...names].sort((a, b) => b.name.length - a.name.length)) {   // 긴 이름 먼저 ("풀 10"이 "풀 1"로 읽히지 않게)
    for (const re of namePatterns(name)) {
      re.lastIndex = 0;
      const hit = re.exec(rest);
      if (hit && (!best || hit.index < best.index)) best = { id, index: hit.index };
      rest = rest.replace(re, (h) => '@'.padEnd(h.length, ' '));   // 같은 길이로 덮어 위치(먼저 나온 순서)를 지킴
    }
  }
  return { id: best?.id ?? null, rest };
}

/**
 * 해석. 반환 { target: id | null, steps: [{ type: 'move', dir, amount } | { type: 'rotate', deg } | { type: 'scale', factor }], unknown: [알아듣지 못한 부분], vertical: bool }
 */
export function parseCommand(text, names) {
  const src = String(text ?? '').trim();
  const found = findTarget(src, names);
  const out = { target: found.id, steps: [], unknown: [], vertical: false };
  // 마디 나누기: 쉼표, "그리고", "다음", "…하고", "…고 "
  const parts = found.rest.split(/\s*(?:,|그리고|다음에?|하고|(?<=[가-힣])고\s)\s*/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const num = part.match(NUM)?.[0];
    const n = num === undefined ? null : Number(num);
    const dir = DIRS.find(([w]) => part.includes(w))?.[1] ?? null;
    if (/\d\s*(도|°)|회전|돌려|돌리|돌아/.test(part)) {
      let deg = /\d\s*(도|°)/.test(part) && n !== null ? n : DEFAULTS.rotate;
      if (dir === 'right') deg = -Math.abs(deg);                  // 오른쪽으로 돌려 = 시계 방향
      else if (dir === 'left') deg = Math.abs(deg);
      out.steps.push({ type: 'rotate', deg });
    } else if (/\d\s*배|키워|키우|크게|작게|줄여|줄이/.test(part)) {
      let factor = /\d\s*배/.test(part) && n !== null ? n : /작게|줄여|줄이/.test(part) ? DEFAULTS.shrink : DEFAULTS.grow;
      factor = Math.min(LIMITS.scale[1], Math.max(LIMITS.scale[0], factor));
      out.steps.push({ type: 'scale', factor });
    } else if (dir === 'up' || dir === 'down') {
      out.vertical = true;                                          // 땅에 붙어 있는 물체라 위·아래는 하지 않음
    } else if (dir) {
      out.steps.push({ type: 'move', dir, amount: Math.min(LIMITS.move, Math.abs(n ?? DEFAULTS.move)) });
    } else {
      const left = part.replace(/@\s*(을|를|은|는|이|가)?/g, '').replace(/좀|해\s*줘|해\s*주세요|주세요|줘|옮겨|이동|움직여|\s/g, '');
      if (left) out.unknown.push(part.replace(/@\s*/g, '').trim());
    }
  }
  return out;
}

const DIR_NAME = { right: '오른쪽', left: '왼쪽', near: '앞(가까이)', far: '뒤(멀리)' };
const r2 = (v) => Math.round(v * 100) / 100;
/** 사람이 읽는 요약: "오른쪽 0.6 · 45° 돌림 · 1.2배" */
export function describeSteps(steps) {
  return steps.map((s) => (s.type === 'move' ? `${DIR_NAME[s.dir]} ${r2(s.amount)}` : s.type === 'rotate' ? `${r2(s.deg)}° 돌림` : `${r2(s.factor)}배`)).join(' · ');
}
