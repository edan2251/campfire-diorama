// 젖음 표현 (F07 R-24, CP-09 보완): 재질 종류별 젖은 정도(logic/weather.js createWetness, 젖는 속도 > 마르는 속도)를 화소마다 반영.
// 젖으면 어두워지고(기본색 곱) 조금 매끈해짐(거칠기 곱). 천·옷은 광택 없이 어두워지기만.
// 모든 표면이 비 가림 지도(fx/rain.js occRT, 위에서 본 가장 높은 표면 높이)를 읽어, 자기 위로 0.05~0.15H 넘게 다른 표면이 있으면 덜 젖음:
//   모자 챙 아래 얼굴·텐트 안쪽·통나무 아랫면·텐트 아래 흙은 거의 마른 채, 모자 윗면·지붕·통나무 윗면·드러난 흙은 젖음 (CP-08까지는 흙만 이렇게, 나머지는 재질 전체가 같이 젖었음).
// 재질은 장면 물체 이름으로 분류. 셰이더 상수만 바꾸므로 원래 값이 누적되지 않음.
const KIND_BY_NAME = [
  [/^grass|^island/, 'ground'], [/^tent/, 'cloth'], [/^log|^firewood|^guitar$/, 'wood'],
  [/^stone_ring|^rock/, 'stone'], [/^guitar_case/, 'cloth'], [/^character/, 'character'],
];
// 종류별: 최대 어두워짐, 최대 거칠기 감소 비율, 가려진 곳에 남는 젖음 비율
const LOOK = { ground: [0.32, 0.45, 0.12], cloth: [0.28, 0.0, 0.2], wood: [0.35, 0.5, 0.25], stone: [0.3, 0.6, 0.25], character: [0.22, 0.1, 0.15] };   // 캐릭터 옷·모자: 젖어도 거칠기 0.95 → 0.86까지만 (비닐처럼 번들거리지 않게, 2026-10-24)

function kindOf(obj) {
  for (let o = obj; o; o = o.parent) for (const [re, k] of KIND_BY_NAME) if (re.test(o.name || '')) return k;
  return null;
}

/**
 * roots: 젖을 물체들(장면 소품 그룹·캐릭터), rain: fx/rain.js createRain 결과
 * 반환 { count, kinds, apply(wetValues), reset(), hasWet(values) }
 */
export function createWetSurfaces(roots, rain) {
  const common = { uOcc: { value: rain.occRT.texture }, uBounds: { value: rain.bounds } };
  const perKind = {};
  for (const [k, [dark, gloss, share]] of Object.entries(LOOK)) perKind[k] = { uWet: { value: 0 }, uDark: { value: dark }, uGloss: { value: gloss }, uShare: { value: share } };
  const seen = new Set();
  const kinds = {};
  for (const root of roots) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      const kind = kindOf(o);
      if (!kind) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m || seen.has(m) || !m.isMeshStandardMaterial) continue;
        seen.add(m);
        kinds[kind] = (kinds[kind] ?? 0) + 1;
        const U = { ...common, ...perKind[kind] };
        const prev = m.onBeforeCompile;
        m.onBeforeCompile = (sh, r) => {
          if (prev) prev(sh, r);
          Object.assign(sh.uniforms, U);
          sh.vertexShader = sh.vertexShader
            .replace('#include <common>', `#include <common>
varying vec3 vWetPos;`)
            .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vWetPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', `#include <common>
varying vec3 vWetPos;
uniform sampler2D uOcc;
uniform vec4 uBounds;
uniform float uWet, uDark, uGloss, uShare;`)
            .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        if (uWet > 0.0) {
          vec2 ouv = vec2((vWetPos.x - uBounds.x) / (uBounds.y - uBounds.x), 1.0 - (vWetPos.z - uBounds.z) / (uBounds.w - uBounds.z));
          float hOcc = texture2D(uOcc, ouv).a - 10.0;
          float covered = smoothstep(0.05, 0.15, hOcc - vWetPos.y);   // 위에 다른 표면(모자 챙·지붕·통나무 윗면 등)이 있으면 가려짐
          float w = uWet * mix(1.0, uShare, covered);
          diffuseColor.rgb *= 1.0 - uDark * w;
          roughnessFactor *= 1.0 - uGloss * w;
        }`);
        };
        m.customProgramCacheKey = () => `wet-${kind}`;
        m.needsUpdate = true;
      }
    });
  }
  return {
    count: seen.size, kinds,
    /** wet = createWetness().values (종류별 0..1) */
    apply(wet) { for (const [k, U] of Object.entries(perKind)) U.uWet.value = wet[k] ?? 0; },
    reset() { for (const U of Object.values(perKind)) U.uWet.value = 0; },
    /** 아직 젖은 표면이 있는지 (비가 그친 뒤에도 가림 지도를 갱신할지) */
    hasWet(wet) { return Object.values(wet).some((v) => v > 0.01); },
  };
}
