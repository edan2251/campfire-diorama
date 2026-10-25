// 탭/드래그 판정 (F04 입력 원칙). DOM 없이 좌표·시간만 받아 테스트 가능.
// - 탭 = 누른 뒤 이동 ≤ moveThreshold(CSS px) 그리고 maxDuration 이내에 뗌, 다른 손가락 없음 → 이동/상호작용 명령
// - 드래그(카메라 회전)·핀치(거리)·UI 위에서 시작한 포인터·취소된 포인터는 탭이 아님 (드래그 뒤 놓기 무시)
// - 다중 터치가 시작되면 지금 눌린 모든 포인터의 탭 후보를 취소

export function createTapDetector({ moveThreshold = 8, maxDuration = 500 } = {}) {
  const ptrs = new Map();   // id → { x0, y0, t0, x, y, dragged, ui, cancelled }
  let multi = false;        // 이번 제스처 동안 손가락 2개 이상이었는지 (모두 뗄 때까지 유지)

  return {
    get active() { return ptrs.size; },
    /** 반환: 'ignored'(UI 위) | 'pending' */
    down(id, x, y, t, { overUI = false } = {}) {
      ptrs.set(id, { x0: x, y0: y, t0: t, x, y, dragged: false, ui: overUI, cancelled: false });
      if (ptrs.size > 1) { multi = true; for (const p of ptrs.values()) p.cancelled = true; }
      return overUI ? 'ignored' : 'pending';
    },
    /** 반환: 'drag'(카메라 쪽으로 넘길 움직임) | 'none' */
    move(id, x, y) {
      const p = ptrs.get(id);
      if (!p) return 'none';
      p.x = x; p.y = y;
      if (!p.dragged && Math.hypot(x - p.x0, y - p.y0) > moveThreshold) p.dragged = true;
      return p.dragged && !p.ui ? 'drag' : 'none';
    },
    /** 반환: { type: 'tap', x, y } | null */
    up(id, x, y, t) {
      const p = ptrs.get(id);
      ptrs.delete(id);
      if (!p) return null;
      const wasMulti = multi;
      if (ptrs.size === 0) multi = false;
      if (p.ui || p.cancelled || wasMulti || p.dragged) return null;
      if (Math.hypot(x - p.x0, y - p.y0) > moveThreshold) return null;
      if (t - p.t0 > maxDuration) return null;
      return { type: 'tap', x, y };
    },
    cancel(id) { ptrs.delete(id); if (ptrs.size === 0) multi = false; },
    reset() { ptrs.clear(); multi = false; },
  };
}
