// 자동 품질 (F10): 실제 프레임 간격(ms)을 3초 창으로 평균해 단계를 조절. 오르내림 진동 방지(히스테리시스).
// - 내리기: 평균 > overMs(약 52 fps 미만)인 창이 2번 연속
// - 올리기: 평균 ≤ okMs(약 57 fps 이상)인 창이 6번 연속 + 마지막 변경 뒤 10초 이상
// - 어떤 단계에서 성능 부족으로 내려왔다면 그 단계로 다시 올리기는 냉각 시간 뒤에만 (60초, 반복될 때마다 2배, 최대 300초)
// 화면 주사율 상한 때문에 "여유"는 정확히 잴 수 없으므로 "목표 프레임을 지키는지"만 본다.
export const TIERS = ['low', 'medium', 'high'];

export function createQualityGovernor({ start = 'high', windowSec = 3, downAfter = 2, upAfter = 6, minGapSec = 10, overMs = 19.2, okMs = 17.5, cooldownSec = 60, cooldownMax = 300 } = {}) {
  let tier = TIERS.includes(start) ? start : 'high';
  let acc = 0, n = 0, winStart = null;
  let over = 0, ok = 0;
  let lastChange = -Infinity;
  const blockedUntil = { low: 0, medium: 0, high: 0 };
  const cool = { low: cooldownSec, medium: cooldownSec, high: cooldownSec };
  const history = [];

  function change(to, now, why) {
    history.push({ t: now, from: tier, to, why });
    tier = to; lastChange = now; over = 0; ok = 0;
  }

  return {
    get tier() { return tier; },
    get history() { return history; },
    /** 실행 중 강제(사용자가 자동을 다시 켤 때 시작 단계) */
    reset(t = tier) { tier = t; acc = 0; n = 0; winStart = null; over = 0; ok = 0; lastChange = -Infinity; },
    /** 프레임 하나 (실제 간격 ms, 현재 시각 초). 단계가 바뀌면 새 단계 이름, 아니면 null */
    push(frameMs, now) {
      if (!(frameMs > 0) || frameMs > 1000) return null;          // 탭 복귀 등 비정상 간격은 버림
      if (winStart === null) winStart = now;
      acc += frameMs; n++;
      if (now - winStart < windowSec) return null;
      const avg = acc / n;
      acc = 0; n = 0; winStart = now;
      const i = TIERS.indexOf(tier);
      if (avg > overMs) { over++; ok = 0; } else if (avg <= okMs) { ok++; over = 0; } else { over = 0; ok = 0; }
      if (over >= downAfter && i > 0) {
        blockedUntil[tier] = now + cool[tier];
        cool[tier] = Math.min(cooldownMax, cool[tier] * 2);
        change(TIERS[i - 1], now, `avg ${avg.toFixed(1)}ms`);
        return tier;
      }
      if (ok >= upAfter && i < TIERS.length - 1 && now - lastChange >= minGapSec && now >= blockedUntil[TIERS[i + 1]]) {
        change(TIERS[i + 1], now, `avg ${avg.toFixed(1)}ms`);
        return tier;
      }
      return null;
    },
  };
}
