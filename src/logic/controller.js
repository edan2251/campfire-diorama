// 캐릭터 상태 기계 (F04·F03). three.js 없이 시간(dt)만으로 갱신 — 단위 테스트 대상.
// 상태: Standing → Walking → (도착) Standing / (통나무 목표) Aligning → SittingDown → Seated → (지면 요청) StandingUp → Walking.
// 루트 소유: 걷기·정렬의 월드 이동·회전 = 이 컨트롤러. 앉기·일어나기 = 접근 위치에 루트 고정(클립 안 Hips 이동).
// 전환(SittingDown·StandingUp) 중 입력은 pending 하나(마지막 유효 요청)에 저장하고 전환이 끝나면 실행한다. 무효 요청은 기존 목표·pending을 지우지 않는다.
// 방향: yaw 0 = +z를 바라봄, 앞 = (sin yaw, cos yaw). 좌표는 섬 윗면 평면 (x, z), 단위 H.
import { findPath } from './navgrid.js';

export const CLIP_FOR = {
  Standing: 'Idle_Stand', Walking: 'Walk', Aligning: 'Walk',     // 정렬(제자리 회전) 동안 걷기를 느리게 — 발을 디디며 돎 (D-02, 1차는 서기 클립이라 미끄러짐)
  SittingDown: 'SitDown_Ground', Seated: 'Idle_LeanLog', StandingUp: 'StandUp_Ground',
};
const TRANSITIONS = new Set(['SittingDown', 'StandingUp']);

export function wrapAngle(a) {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

export function createController({
  grid, rest, clips = { SitDown_Ground: 3.0, StandUp_Ground: 3.167 },
  speed = 0.85, turnRate = 2 * Math.PI, arriveRadius = 0.05, alignTime = 0.35, initial = 'Seated',
}) {
  // rest = { approach: [x, z], yaw } — 통나무 앞 접근 위치(루트)와 앉았을 때 몸 방향(불 쪽)
  let state = initial;
  let pos = [...rest.approach];
  let yaw = initial === 'Seated' ? rest.yaw : 0;
  let path = null;            // 남은 경유점 [[x,z]...] (첫 점 = 다음 목표)
  let goal = null;            // { type: 'ground', point } | { type: 'log' }
  let pending = null;         // 전환 중 저장한 마지막 유효 요청
  let stateTime = 0;          // 현재 상태에서 지난 시간 (전환 클립 재생 위치)
  let transitionId = 0;       // 상태가 바뀔 때만 증가 — 렌더 쪽은 이 값이 바뀔 때만 클립을 새로 시작
  let alignFrom = null;
  let alignDur = alignTime;
  const events = [];

  const setState = (s) => {
    if (s === state) return;
    events.push({ type: 'state', from: state, to: s });
    state = s; stateTime = 0; transitionId++;
  };

  /** 요청 유효성 검사: 경로를 구할 수 있으면 { ok, path } (출발점 = from) */
  function plan(req, from) {
    const to = req.type === 'log' ? rest.approach : req.point;
    const r = findPath(grid, from, to);
    if (!r.ok) return r;
    return { ...r, path: req.type === 'log' ? [...r.path.slice(0, -1), [...rest.approach]] : r.path };
  }

  function startWalk(req, from) {
    const r = plan(req, from);
    if (!r.ok) return r;
    goal = req;
    path = r.path.slice(1);
    if (!path.length) path = [r.goal];
    setState('Walking');
    return r;
  }

  function arrive() {
    path = null;
    if (goal && goal.type === 'log') {
      alignFrom = { pos: [...pos], yaw };
      // 제자리 회전 시간은 돌 각도에 비례 (약 240°/s, 0.3–0.9초). 1차 고정 0.35초는 106° 회전이 급했음
      alignDur = Math.min(0.9, Math.max(alignTime, Math.abs(wrapAngle(rest.yaw - yaw)) / 4.2));
      setState('Aligning');
    }
    else { goal = null; setState('Standing'); }
  }

  const api = {
    get state() { return state; },
    get pos() { return pos; },
    get yaw() { return yaw; },
    get path() { return path; },
    get goal() { return goal; },
    get pending() { return pending; },
    get clip() { return CLIP_FOR[state]; },
    /** 전환 클립 재생 위치(초). 대기·걷기 클립은 렌더 쪽 시간으로 반복 */
    get clipTime() { return stateTime; },
    get transitionId() { return transitionId; },
    get inTransition() { return TRANSITIONS.has(state); },
    drainEvents() { return events.splice(0); },

    /**
     * 요청: { type: 'ground', point: [x, z] } | { type: 'log' }.
     * 반환 { accepted, reason? }. 무효면 아무 상태도 바꾸지 않는다.
     */
    request(req) {
      if (!req || (req.type !== 'log' && req.type !== 'ground')) return { accepted: false, reason: 'bad-request' };
      // 지면 요청은 유한한 [x, z]만 (1차: 빈 목표가 들어오면 경로 계산에서 예외 — CP-06에서 발견)
      if (req.type === 'ground' && !(Array.isArray(req.point) && req.point.length === 2 && req.point.every(Number.isFinite))) return { accepted: false, reason: 'bad-request' };
      if (TRANSITIONS.has(state)) {
        // 전환 중: 지금 위치가 아니라 전환이 끝나는 접근 위치에서 경로가 있는지 확인하고 저장만
        if (req.type === 'ground') {
          const r = plan(req, rest.approach);
          if (!r.ok) return { accepted: false, reason: r.reason };
        }
        pending = req;
        return { accepted: true, queued: true };
      }
      if (state === 'Seated') {
        if (req.type === 'log') return { accepted: false, reason: 'already-seated' };
        const r = plan(req, rest.approach);
        if (!r.ok) return { accepted: false, reason: r.reason };
        pending = req;
        setState('StandingUp');
        return { accepted: true, queued: true };
      }
      if (state === 'Aligning') {
        if (req.type === 'log') return { accepted: true, reason: 'same-goal' };
        // 아직 앉기 클립 전: 바로 걷기로 바꿀 수 있음
      }
      if (state === 'Walking' && req.type === 'log' && goal && goal.type === 'log') return { accepted: true, reason: 'same-goal' };
      if (req.type === 'log' && Math.hypot(pos[0] - rest.approach[0], pos[1] - rest.approach[1]) <= arriveRadius) {
        goal = req; arrive();
        return { accepted: true };
      }
      const r = startWalk(req, pos);
      return r.ok ? { accepted: true } : { accepted: false, reason: r.reason };
    },

    update(dt) {
      if (!(dt > 0)) return api;
      stateTime += dt;
      if (state === 'Walking' && path) {
        let budget = speed * dt;
        while (budget > 0 && path.length) {
          const [tx, tz] = path[0];
          const dx = tx - pos[0], dz = tz - pos[1];
          const dist = Math.hypot(dx, dz);
          if (dist > 1e-6) {
            const want = Math.atan2(dx, dz);
            const err = wrapAngle(want - yaw);
            const turn = Math.sign(err) * Math.min(Math.abs(err), turnRate * dt);
            yaw = wrapAngle(yaw + turn);
            // 크게 돌아야 할 때는 천천히 (옆걸음·제자리 미끄러짐 방지)
            const k = Math.max(0.25, Math.cos(Math.min(Math.abs(wrapAngle(want - yaw)), Math.PI / 2)));
            const step = Math.min(dist, budget * k);
            pos = [pos[0] + (dx / dist) * step, pos[1] + (dz / dist) * step];
            budget -= step / k;
            if (step < dist - 1e-9) break;
          }
          path.shift();
        }
        if (!path.length) arrive();
      } else if (state === 'Aligning') {
        const t = Math.min(1, stateTime / alignDur);
        const e = t * t * (3 - 2 * t);
        pos = [alignFrom.pos[0] + (rest.approach[0] - alignFrom.pos[0]) * e, alignFrom.pos[1] + (rest.approach[1] - alignFrom.pos[1]) * e];
        yaw = wrapAngle(alignFrom.yaw + wrapAngle(rest.yaw - alignFrom.yaw) * e);
        if (t >= 1) { pos = [...rest.approach]; yaw = rest.yaw; goal = null; setState('SittingDown'); }
      } else if (state === 'SittingDown') {
        pos = [...rest.approach]; yaw = rest.yaw;
        if (stateTime >= clips.SitDown_Ground) {
          // 앉기 클립 끝 = 착석 자세 G. 지면 요청이 남아 있으면 같은 G에서 바로 일어나기 (통나무 요청은 이미 충족)
          if (pending && pending.type === 'ground') setState('StandingUp');
          else { pending = null; setState('Seated'); }
        }
      } else if (state === 'StandingUp') {
        pos = [...rest.approach]; yaw = rest.yaw;
        if (stateTime >= clips.StandUp_Ground) {
          const p = pending; pending = null;
          if (!p || !startWalk(p, pos).ok) setState('Standing');     // 경로는 요청 때 이미 검사 — 실패는 드묾
        }
      }
      return api;
    },

    /** 전체 초기화: 착석 상태·접근 위치로 (요청·경로 모두 비움) */
    reset() {
      pos = [...rest.approach]; yaw = rest.yaw; path = null; goal = null; pending = null;
      state = 'Seated'; stateTime = 0; transitionId++;
      events.push({ type: 'reset' });
    },
    snapshot() { return { state, pos: [...pos], yaw, goal, pending, path: path && path.map((p) => [...p]), clip: CLIP_FOR[state], clipTime: stateTime }; },
  };
  return api;
}
