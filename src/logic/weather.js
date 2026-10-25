// 날씨 상태 (F07 비·젖음, F05 불 감쇠). three.js 없이 시간(dt)만으로 갱신 — 단위 테스트 대상.
// 비 상태 기계: off → fadingIn → raining → fadingOut → off. 타이머는 이 객체 하나가 소유한다(중복 타이머 없음).
// 선택 시간(30 / 60 / 'loop') = 켠 뒤 자동으로 그치기 시작할 때까지의 시간.
// 수동 OFF = 바로 fadingOut (새 강수만 줄고, 떨어지던 방울은 입자 쪽에서 끝까지 떨어짐).

export const RAIN_FADE_IN = 4;      // 초: 수초 동안 부드럽게 시작
export const RAIN_FADE_OUT = 5;     // 초: 수초 동안 부드럽게 그침
export const DURATIONS = [30, 60, 'loop'];

export function createRain({ duration = 30 } = {}) {
  let phase = 'off';
  let level = 0;            // 0..1 강수 존재량 (세기는 별도 설정이 곱해짐)
  let elapsed = 0;          // 켠 뒤 지난 시간 (fadingIn·raining 동안만 증가)
  let dur = DURATIONS.includes(duration) ? duration : 30;

  const api = {
    get phase() { return phase; },
    get level() { return level; },
    get duration() { return dur; },
    get on() { return phase === 'fadingIn' || phase === 'raining'; },
    /** 남은 시간(초): 그치기 시작할 때까지. 연속이면 null, 그치는 중·꺼짐이면 0 */
    get remaining() {
      if (!api.on) return 0;
      return dur === 'loop' ? null : Math.max(0, dur - elapsed);
    },
    setOn(on) {
      if (on) {
        if (phase === 'off' || phase === 'fadingOut') { phase = 'fadingIn'; elapsed = 0; }
      } else if (api.on) {
        phase = 'fadingOut';
      }
    },
    toggle() { api.setOn(!api.on); },
    setDuration(d) {
      if (!DURATIONS.includes(d)) return;
      dur = d;
      if (api.on && dur !== 'loop' && elapsed >= dur) phase = 'fadingOut';
    },
    update(dt) {
      if (!(dt > 0)) return api;
      if (api.on) {
        elapsed += dt;
        if (dur !== 'loop' && elapsed >= dur) phase = 'fadingOut';
      }
      if (phase === 'fadingIn') {
        level = Math.min(1, level + dt / RAIN_FADE_IN);
        if (level >= 1) phase = 'raining';
      } else if (phase === 'fadingOut') {
        level = Math.max(0, level - dt / RAIN_FADE_OUT);
        if (level <= 0) { phase = 'off'; elapsed = 0; }
      }
      return api;
    },
    reset() { phase = 'off'; level = 0; elapsed = 0; },
    snapshot() { return { phase, level, elapsed, duration: dur }; },
  };
  return api;
}

// 불 감쇠: 실제 불 = 사용자 기본 세기 × weather × 작은 일렁임(렌더 쪽).
// weather 목표 = 1 − 0.7 × 비 존재량 → 비가 내리는 동안 약 30%(25–35% 범위). 약해질 때 빠르게(8초), 회복은 천천히(40초).
export const FIRE_DROP_TAU = 8;
export const FIRE_RECOVER_TAU = 40;
export const FIRE_RAIN_FLOOR = 0.3;

export function createFireWeather() {
  let weather = 1;
  return {
    get weather() { return weather; },
    target(rainLevel) { return 1 - (1 - FIRE_RAIN_FLOOR) * Math.min(Math.max(rainLevel, 0), 1); },
    update(dt, rainLevel) {
      if (!(dt > 0)) return weather;
      const t = this.target(rainLevel);
      const tau = t < weather ? FIRE_DROP_TAU : FIRE_RECOVER_TAU;
      weather += (t - weather) * (1 - Math.exp(-dt / tau));
      return weather;
    },
    reset() { weather = 1; },
  };
}

/** 실제 불 세기. base = 0이면 날씨 회복과 상관없이 0 (임의로 다시 켜지지 않음) */
export function fireActual(base, weather, flicker = 1) {
  return base <= 0 ? 0 : base * weather * flicker;
}

// 젖음: 표면 종류별로 젖는 속도·마르는 속도가 다르다(마르는 쪽이 더 느림). 비 세기(0..1)에 비례한 목표까지 접근.
export const WET_RATES = {
  cloth: { wet: 25, dry: 150 },      // 텐트 천·옷: 조금 어두워짐 중심
  wood: { wet: 35, dry: 200 },       // 통나무·장작
  stone: { wet: 15, dry: 120 },      // 돌: 얇은 물기
  ground: { wet: 40, dry: 240 },     // 흙·풀
  character: { wet: 20, dry: 150 },
};

export function createWetness() {
  const wet = Object.fromEntries(Object.keys(WET_RATES).map((k) => [k, 0]));
  return {
    values: wet,
    update(dt, rainLevel, intensity = 0.35) {
      if (!(dt > 0)) return wet;
      const target = Math.min(1, Math.max(0, rainLevel) * (0.55 + 1.3 * intensity));
      for (const [k, r] of Object.entries(WET_RATES)) {
        const tau = target > wet[k] ? r.wet : r.dry;
        wet[k] += (target - wet[k]) * (1 - Math.exp(-dt / tau));
      }
      return wet;
    },
    reset() { for (const k of Object.keys(wet)) wet[k] = 0; },
  };
}
