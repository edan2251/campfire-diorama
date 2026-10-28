// 앉기·일어나기 재생 시간 (U-20: 사용자 "너무 느리게 앉고 일어섭니다, 50% 빠르게 — 배속만 말고 자연스럽게").
// 클립(포즈·접촉 검사)은 그대로 두고, 재생 시간만 줄이면서 구간마다 빠르기를 다르게 (시간 곡선 w: 0..1 → 0..1).
//  - 앉기 3.0초 → 2.0초 (1.5배): 몸을 낮추는 앞·가운데는 빠르게, 땅에 닿아 기대는 끝은 덜 빠르게 → 털썩 앉지 않음
//    w(x) = 0.8x + 0.2(1 − (1 − x)²): 처음 원래의 1.8배 → 끝 1.2배
//  - 일어나기 3.17초 → 2.2초 (약 1.44배 — 땅에서 일어나는 힘이 드는 동작이라 50%보다 조금 덜): 짚고 밀어 올리는 처음과 반 걸음 내딛는 끝은
//    원래 빠르기에 가깝게, 몸을 일으키는 가운데만 빠르게. w(x) = 0.7x + 0.3·smoothstep(x): 처음·끝 1.0배 → 가운데 1.66배
export const CLIP_PLAYBACK = {
  SitDown_Ground: { seconds: 2.0, warp: (x) => 0.8 * x + 0.2 * (1 - (1 - x) ** 2) },
  StandUp_Ground: { seconds: 2.2, warp: (x) => 0.7 * x + 0.3 * x * x * (3 - 2 * x) },
};

/** 재생 시간(초, 컨트롤러가 쓰는 길이). 모르는 클립은 원래 길이 */
export const playSeconds = (name, clipSeconds) => CLIP_PLAYBACK[name]?.seconds ?? clipSeconds;
/** 상태 시간 t(초) → 클립 안 시간(초) */
export function clipTimeAt(name, t, clipSeconds) {
  const p = CLIP_PLAYBACK[name];
  if (!p) return Math.min(t, clipSeconds);
  const x = Math.min(1, Math.max(0, t / p.seconds));
  return clipSeconds * Math.min(1, Math.max(0, p.warp(x)));
}
