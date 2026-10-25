// 시뮬레이션 시계: 캐릭터·불·비·오로라·날씨 타이머가 모두 이 시간을 쓴다 (F08 일시 정지, F10 시간 기준 갱신).
// 실제 경과 시간(realDt)을 받아 상한을 둔 dt를 돌려준다 → 탭 복귀처럼 긴 공백에도 입자·캐릭터가 튀지 않음.
// 일시 정지 중에는 dt = 0, 재개해도 정지 동안의 실제 시간은 적용하지 않는다.

export function createClock({ maxDt = 0.1 } = {}) {
  let simTime = 0;
  let paused = false;
  return {
    get time() { return simTime; },
    get paused() { return paused; },
    setPaused(p) { paused = !!p; },
    tick(realDt) {
      const dt = paused ? 0 : Math.min(Math.max(Number.isFinite(realDt) ? realDt : 0, 0), maxDt);
      simTime += dt;
      return dt;
    },
    reset() { simTime = 0; paused = false; },
  };
}
