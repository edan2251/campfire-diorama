// 하늘 (F06): 짙은 남색 그라데이션 + 별(크기·밝기 다름, 일부만 느리게 반짝임) + 오로라 커튼(먼 청록·보라, 기본 OFF).
// 오로라 level(0..1)은 호출자가 4–6초 페이드로 보간해 넘긴다. 불보다 눈에 띄지 않게 밝기 상한을 낮게 둔다.
import * as THREE from 'three';
import { NOISE_GLSL } from './noise.glsl.js';

export const SKY_QUALITY = { high: { stars: 1600, ribbons: 3, octaves: 3 }, medium: { stars: 1000, ribbons: 2, octaves: 2 }, low: { stars: 500, ribbons: 1, octaves: 1 } };

const DOME_FS = /* glsl */ `
varying vec3 vDir;
uniform float uAurora;
void main() {
  float h = normalize(vDir).y;
  vec3 zen = vec3(0.004, 0.006, 0.022), hor = vec3(0.016, 0.022, 0.06), low = vec3(0.006, 0.007, 0.018);
  vec3 c = h > 0.0 ? mix(hor, zen, pow(h, 0.6)) : mix(hor, low, pow(-h, 0.5));
  c += vec3(0.0, 0.012, 0.01) * uAurora * smoothstep(0.0, 0.4, h) * smoothstep(0.9, 0.3, h);   // 오로라가 켜지면 하늘이 아주 조금 물듦
  gl_FragColor = vec4(c, 1.0);
}`;

const STAR_VS = /* glsl */ `
attribute float aMag, aTw, aSeed;
uniform float uTime, uIntensity, uTwinkle, uPx;
varying float vB;
void main() {
  float tw = aTw > 0.5 ? 1.0 + uTwinkle * 0.45 * sin(uTime * (0.6 + aSeed * 1.2) + aSeed * 60.0) : 1.0;
  vB = (0.18 + 0.82 * aMag) * uIntensity * tw;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w * 0.99999;      // 항상 가장 먼 곳
  gl_PointSize = (1.1 + 2.4 * aMag) * uPx;
}`;
const STAR_FS = /* glsl */ `
varying float vB;
void main() {
  float r = length(gl_PointCoord - 0.5);
  if (r > 0.5) discard;
  float a = smoothstep(0.5, 0.0, r);
  gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * vB * 2.2, a);
}`;

const AURORA_VS = /* glsl */ `
uniform float uTime, uSpeed;
attribute float aRibbon;
varying vec2 vUv;
varying float vRib;
void main() {
  vUv = uv; vRib = aRibbon;
  vec3 p = position;
  float t = uTime * uSpeed;
  // 느린 커튼 변형: 가로 방향으로 휘는 큰 물결 두 개
  float w = sin(uv.x * 6.0 + t * 0.35 + aRibbon * 2.0) * 2.2 + sin(uv.x * 13.0 - t * 0.22 + aRibbon) * 0.9;
  p += normalize(vec3(p.x, 0.0, p.z)) * w * (0.4 + 0.6 * uv.y);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
}`;
const AURORA_FS = /* glsl */ `
uniform float uTime, uSpeed, uLevel, uGain;
uniform int uOct;
varying vec2 vUv;
varying float vRib;
${NOISE_GLSL}
void main() {
  float t = uTime * uSpeed;
  // 세로 빛줄기(빠르게 흐르는 가는 줄) + 밝은 부분 이동(느리게) — 서로 다른 속도
  float rays = fbm3(vec3(vUv.x * 46.0 + vRib * 7.0, vUv.y * 1.2, t * 0.55), uOct) * 0.5 + 0.5;
  float drift = snoise(vec2(vUv.x * 3.0 - t * 0.12 + vRib * 3.0, vRib)) * 0.5 + 0.5;
  // 아래 가장자리를 물결치게(가로 위치마다 높이가 다름) + 위쪽 끝도 들쭉날쭉 → 띠 대신 커튼 (1차: 화면 위 균일한 띠, D-05)
  float lower = 0.04 + 0.16 * (snoise(vec2(vUv.x * 4.0 + vRib * 5.0, t * 0.08)) * 0.5 + 0.5);
  float upper = 0.55 + 0.4 * (snoise(vec2(vUv.x * 2.5 - vRib * 3.0, t * 0.05 + 4.0)) * 0.5 + 0.5);
  float yy = (vUv.y - lower) / max(0.05, upper - lower);
  float base = smoothstep(0.0, 0.06, yy) * pow(clamp(1.0 - yy, 0.0, 1.0), 1.3);
  float side = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
  float fold = 0.55 + 0.45 * pow(abs(sin(vUv.x * 18.0 + vRib * 2.0 + t * 0.1)), 3.0);   // 커튼 주름: 접힌 곳이 더 밝게
  float a = base * side * pow(rays, 2.0) * (0.35 + 0.9 * drift) * fold;
  vec3 col = mix(vec3(0.12, 0.95, 0.6), vec3(0.2, 0.75, 0.85), smoothstep(0.1, 0.45, yy));
  col = mix(col, vec3(0.62, 0.3, 0.95), smoothstep(0.45, 0.95, yy));
  gl_FragColor = vec4(col * a * uLevel * uGain, 1.0);     // 불보다 눈에 띄지 않게 (1차 0.55는 불과 경쟁, CP-04 0.36)
}`;

function ribbonGeometry(radius, y0, height, a0, a1, rib, seg = 96) {
  const pos = [], uv = [], rb = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg, a = a0 + (a1 - a0) * u;
    for (let j = 0; j <= 1; j++) {
      pos.push(Math.sin(a) * radius, y0 + height * j, Math.cos(a) * radius);
      uv.push(u, j);
      rb.push(rib);
    }
  }
  for (let i = 0; i < seg; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aRibbon', new THREE.Float32BufferAttribute(rb, 1));
  g.setIndex(idx);
  return g;
}

export const AURORA_GAIN = 0.24;   // CP-09: 0.36은 오로라 프리셋에서 밝은 띠(최고 밝기 199)가 불과 경쟁 → 0.24 (최고 166~180, 불 235)

export function createSky({ quality = 'high', seed = 7 } = {}) {
  let Q = SKY_QUALITY[quality];
  const group = new THREE.Group();
  group.name = 'sky';
  const domeU = { uAurora: { value: 0 } };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 16), new THREE.ShaderMaterial({
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader: DOME_FS, uniforms: domeU, side: THREE.BackSide, depthWrite: false,
  }));
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  group.add(dome);

  // 별 (고정 난수로 같은 하늘)
  let rnd = seed;
  const rand = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
  const N = SKY_QUALITY.high.stars;
  const pos = new Float32Array(N * 3), mag = new Float32Array(N), tw = new Float32Array(N), sd = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const z = rand() * 2 - 1, th = rand() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    pos.set([Math.cos(th) * r * 70, z * 70, Math.sin(th) * r * 70], i * 3);
    mag[i] = Math.pow(rand(), 3.2);                // 대부분 어둡고 소수만 밝게
    tw[i] = rand() < 0.22 ? 1 : 0;                  // 일부만 반짝임
    sd[i] = rand();
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sg.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
  sg.setAttribute('aTw', new THREE.BufferAttribute(tw, 1));
  sg.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
  sg.setDrawRange(0, Q.stars);
  const starU = { uTime: { value: 0 }, uIntensity: { value: 0.6 }, uTwinkle: { value: 0.35 }, uPx: { value: 1 } };
  const stars = new THREE.Points(sg, new THREE.ShaderMaterial({ vertexShader: STAR_VS, fragmentShader: STAR_FS, uniforms: starU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  stars.frustumCulled = false;
  stars.renderOrder = -9;
  group.add(stars);

  // 오로라: 섬 뒤쪽 먼 하늘(-z 쪽)에 커튼 띠
  const auroraU = { uTime: { value: 0 }, uSpeed: { value: 0.3 }, uLevel: { value: 0 }, uOct: { value: Q.octaves }, uGain: { value: AURORA_GAIN } };
  const aur = new THREE.Group();
  const aMat = new THREE.ShaderMaterial({ vertexShader: AURORA_VS, fragmentShader: AURORA_FS, uniforms: auroraU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  // [반지름, 아래 높이, 세로 길이, 시작각, 끝각] — 1차(아래 4–9, 반지름 52–60)는 화면 위로 잘려 띠처럼 보임 → 낮고 길게
  // CP-09: 기본 구도(22° 내려다봄)에서는 오로라가 화면 위 밖이라 켜도 안 보임(덮는 면적 0%) → 6 낮춤: 기본 구도 화면 위 약 1/4에 얇은 띠
  const RIBS = [[42, -8, 19, Math.PI * 0.62, Math.PI * 1.3], [48, -6, 16, Math.PI * 0.84, Math.PI * 1.52], [38, -9, 13, Math.PI * 1.02, Math.PI * 1.42]];
  RIBS.forEach((r, k) => { const m = new THREE.Mesh(ribbonGeometry(...r, k), aMat); m.frustumCulled = false; m.renderOrder = -8; aur.add(m); });
  const applyRibbons = () => aur.children.forEach((m, k) => { m.visible = k < Q.ribbons; });
  applyRibbons();
  group.add(aur);

  return {
    group, aurora: aur, auroraU,
    setQuality(q) {
      if (!SKY_QUALITY[q]) return;
      Q = SKY_QUALITY[q];
      sg.setDrawRange(0, Q.stars);
      auroraU.uOct.value = Q.octaves;
      applyRibbons();
    },
    setPixelRatio(pr) { starU.uPx.value = pr; },
    /** level = 오로라 실제 양(페이드 보간 결과), intensity·speed = 사용자 설정 */
    update(time, { starIntensity = 0.6, twinkle = 0.35, auroraLevel = 0, auroraIntensity = 0.25, auroraSpeed = 0.3 } = {}) {
      starU.uTime.value = time;
      starU.uIntensity.value = starIntensity;
      starU.uTwinkle.value = twinkle;
      auroraU.uTime.value = time;
      auroraU.uSpeed.value = 0.4 + 1.6 * auroraSpeed;
      const lv = auroraLevel * auroraIntensity / 0.25;            // 0.25 = 기본 켜짐 세기
      auroraU.uLevel.value = lv;
      aur.visible = lv > 0.002;
      domeU.uAurora.value = lv;
    },
  };
}
