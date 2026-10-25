// 섬 윗면 높이 (web/config/island_height.json, blender/scripts/prep_props.py가 실제 섬 모델에서 위→아래 광선으로 만든 격자).
// 캐릭터 루트·소품을 지면 높이에 맞춘다. 섬 밖·빈 칸은 가장 가까운 값(없으면 0).
export function createTerrain(hm) {
  const { nx, nz, heights } = hm;
  const [x0, x1] = hm.x, [z0, z1] = hm.z;
  const at = (i, j) => {
    const r = heights[Math.min(nz - 1, Math.max(0, j))];
    const v = r ? r[Math.min(nx - 1, Math.max(0, i))] : null;
    return v;
  };
  function nearestValid(i, j) {
    for (let r = 1; r < 6; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const v = at(i + di, j + dj); if (v !== null && v !== undefined) return v; }
    return 0;
  }
  return {
    /** 지면 높이 (three y). 쌍선형 보간, 빈 칸은 이웃 값 */
    height(x, z) {
      const fi = ((x - x0) / (x1 - x0)) * (nx - 1), fj = ((z - z0) / (z1 - z0)) * (nz - 1);
      const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
      const q = [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]].map(([a, b]) => { const h = at(a, b); return h === null || h === undefined ? nearestValid(a, b) : h; });
      return (q[0] * (1 - u) + q[1] * u) * (1 - v) + (q[2] * (1 - u) + q[3] * u) * v;
    },
  };
}
