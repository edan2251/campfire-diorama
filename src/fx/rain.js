// 비 (F07): 빗줄기 + 가림 + 주요 표면 물 튀김. 위치는 GPU에서 시간으로 계산(빗방울마다 고정 난수) → 입자 상태를 CPU가 들고 있지 않음.
// 가림: 위에서 내려다본 직교 카메라로 "가림 물체"(섬 윗면·텐트·통나무·바위·돌 테두리·캐릭터 모자 등, 레이어 OCC_LAYER)를
//   RGBA 실수 텍스처에 그린다 (r,g = 표면 법선 x,z · b = 표면 종류(0 흙·풀, 1 주요 표면) · a = 높이+10).
//   빗방울 머리가 그 높이 아래로 가면 숨기고, 그 순간 그 위치에서 법선 방향으로 짧게 튐. 매 프레임 다시 그려 캐릭터·모자 움직임을 따라감.
// 흙·풀(종류 0)은 일부 방울만 아주 작게 튐(흙 전체 파문 금지). 섬 밖으로 떨어지는 방울은 아래로 계속 떨어짐.
import * as THREE from 'three';

export const OCC_LAYER = 3;
export const RAIN_QUALITY = { high: { drops: 2200, occRes: 256 }, medium: { drops: 1200, occRes: 192 }, low: { drops: 500, occRes: 128 } };

const COMMON = /* glsl */ `
uniform float uTime, uSpeed, uDensity, uLen;
uniform vec2 uWind, uY;
uniform vec4 uBounds;                // minX, maxX, minZ, maxZ
uniform sampler2D uOcc;
attribute vec4 aDrop;                // x01, z01, phase, key
vec4 occAt(vec2 xz) {
  vec2 uv = vec2((xz.x - uBounds.x) / (uBounds.y - uBounds.x), 1.0 - (xz.y - uBounds.z) / (uBounds.w - uBounds.z));
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0, 0.0, 0.0, 0.0);
  return texture2D(uOcc, uv);
}
// 기울기: 바람만큼 위에서 아래로 갈수록 옆으로 밀림
vec2 xzAt(float y) { return vec2(mix(uBounds.x, uBounds.y, aDrop.x), mix(uBounds.z, uBounds.w, aDrop.y)) + uWind * 0.22 * (uY.y - y); }
float headY() { float H = uY.y - uY.x; return uY.y - mod(aDrop.z * H + uTime * uSpeed, H); }
`;

const STREAK_VS = /* glsl */ `
${COMMON}
attribute float aEnd;                // 0 = 머리(아래), 1 = 꼬리(위)
uniform vec3 uFirePos;
uniform float uFireI;
varying float vA;
varying vec3 vWarm;
void main() {
  float y = headY();
  vec2 xz = xzAt(y);
  vec4 o = occAt(xz);
  float hOcc = o.a - 10.0;           // 가림 높이 (없으면 -10)
  float yy = y + aEnd * uLen;
  float hidden = step(aDrop.w, uDensity) < 0.5 ? 1.0 : 0.0;
  if (y < hOcc) {                    // 머리가 표면 아래: 꼬리도 아래면 숨김, 아니면 표면에서 자름
    if (yy < hOcc) hidden = 1.0; else if (aEnd < 0.5) yy = hOcc;
  }
  vec2 pxz = xzAt(yy);
  vec3 p = vec3(pxz.x, yy, pxz.y);
  vA = (1.0 - hidden) * (aEnd < 0.5 ? 1.0 : 0.15);
  float d = distance(p, uFirePos);
  vWarm = vec3(1.0, 0.55, 0.25) * uFireI * 0.6 / (1.0 + d * d * 2.5);   // 불 가까운 빗줄기는 따뜻하게 빛을 받음
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  if (hidden > 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const STREAK_FS = /* glsl */ `
uniform float uAlpha;
varying float vA;
varying vec3 vWarm;
void main() { gl_FragColor = vec4(vec3(0.55, 0.62, 0.75) * 0.6 + vWarm, vA * uAlpha); }`;

const SPLASH_VS = /* glsl */ `
${COMMON}
uniform float uPx, uGroundShare;
varying float vA, vK, vSeed;
void main() {
  float y = headY();
  // 이 방울이 지나는 xz에서 가림 표면 높이 (머리 xz로 근사)
  vec2 xz0 = xzAt(y);
  vec4 o = occAt(xz0);
  float hOcc = o.a - 10.0;
  float H = uY.y - uY.x;
  float fallToHit = uY.y - hOcc;                                   // 표면까지 떨어지는 거리
  float fall = mod(aDrop.z * H + uTime * uSpeed, H);
  float el = (fall - fallToHit) / uSpeed;                          // 닿은 뒤 지난 시간(초)
  float dur = 0.22;
  bool ground = o.b < 0.5;
  bool show = hOcc > -9.0 && el >= 0.0 && el <= dur && aDrop.w < uDensity && (!ground || fract(aDrop.w * 37.0) < uGroundShare);
  vec3 n = vec3(o.r, sqrt(max(0.0, 1.0 - o.r * o.r - o.g * o.g)), o.g);
  float k = el / dur;
  vK = k;
  vSeed = fract(aDrop.w * 13.7);
  vec3 p = vec3(xz0.x, hOcc, xz0.y) + n * (ground ? 0.008 : 0.014);     // 표면 법선 쪽으로 조금 띄운 자리에서 (물방울 모양은 조각 셰이더)
  vA = show ? (1.0 - k) * (ground ? 0.45 : 1.0) : 0.0;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = show ? max(2.0, (ground ? 0.03 : 0.05) * uPx / max(0.3, -mv.z)) : 0.0;
  if (!show) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
// 물 튀김: 작은 물방울 5개가 위·옆으로 튀었다 떨어짐 (1차 고리 모양은 동그란 표시처럼 보였음, D-03) + 아주 옅은 바닥 고리
const SPLASH_FS = /* glsl */ `
uniform float uAlpha;
varying float vA, vK, vSeed;
void main() {
  vec2 c = gl_PointCoord - vec2(0.5, 0.62);
  c.y = -c.y;                                                     // 위쪽 = +y
  float drops = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float ang = 0.35 + fi * 0.6 + vSeed * 0.8;                    // 위쪽 반원 쪽으로 퍼짐
    vec2 dir = vec2(cos(ang), sin(ang) * 1.2);
    vec2 p = dir * (0.08 + 0.34 * vK) + vec2(0.0, -0.55 * vK * vK);   // 튀었다가 떨어짐
    float rad = 0.07 * (1.0 - 0.6 * vK);
    drops += smoothstep(rad, rad * 0.3, length(c - p));
  }
  float ring = smoothstep(0.42, 0.34, length(vec2(c.x, c.y * 3.0 + 0.1))) * smoothstep(0.18, 0.3 + 0.12 * vK, length(vec2(c.x, c.y * 3.0 + 0.1))) * 0.35;
  gl_FragColor = vec4(vec3(0.78, 0.85, 0.97), clamp(drops + ring, 0.0, 1.0) * vA * uAlpha);
}`;

const OCC_VS = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
varying vec3 vWN;
varying float vY;
void main() {
  #include <skinbase_vertex>
  #include <begin_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <skinning_vertex>
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vY = wp.y;
  vWN = normalize(mat3(modelMatrix) * objectNormal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const OCC_FS = /* glsl */ `
uniform float uClass;
varying vec3 vWN;
varying float vY;
void main() {
  vec3 n = normalize(vWN);
  if (n.y < 0.0) n = -n;                                     // 위에서 보는 면 기준 (얇은 천은 양면)
  gl_FragColor = vec4(n.x, n.z, uClass, vY + 10.0);
}`;

/** 가림 물체 등록: 오브젝트(와 자식 메시)를 가림 레이어에 넣고 표면 종류 지정 (0 흙·풀, 1 주요 표면) */
export function markOccluder(obj, rainClass = 1) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.layers.enable(OCC_LAYER);
    o.userData.rainClass = rainClass;
    const prev = o.onBeforeRender;
    o.onBeforeRender = function (r, s, c, g, m, grp) {
      if (m && m.userData && m.userData.isRainOcc) { m.uniforms.uClass.value = o.userData.rainClass; m.uniformsNeedUpdate = true; }
      if (prev) prev.call(this, r, s, c, g, m, grp);
    };
  });
}

export function createRain({ quality = 'high', bounds = { minX: -3.6, maxX: 3.6, minZ: -3.1, maxZ: 3.1 }, top = 6.0, bottom = -2.5 } = {}) {
  let Q = RAIN_QUALITY[quality];
  const MAX = RAIN_QUALITY.high.drops;
  const group = new THREE.Group();
  group.name = 'rain';

  // 빗방울 고정 난수 (같은 seed → 같은 비)
  let s = 12345;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const drops = new Float32Array(MAX * 4);
  for (let i = 0; i < MAX; i++) drops.set([rnd(), rnd(), rnd(), rnd()], i * 4);

  const occRT = new THREE.WebGLRenderTarget(Q.occRes, Q.occRes, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
  const occCam = new THREE.OrthographicCamera(bounds.minX, bounds.maxX, bounds.maxZ, bounds.minZ, 0.1, 30);
  occCam.position.set(0, 15, 0);
  occCam.up.set(0, 0, -1);
  occCam.lookAt(0, 0, 0);
  occCam.layers.set(OCC_LAYER);
  // 위에서 볼 때 화면 위 = -z 가 되도록 맞춤 → occAt의 uv.y = 1 - (z - minZ)/(maxZ - minZ)
  const occMat = new THREE.ShaderMaterial({ vertexShader: OCC_VS, fragmentShader: OCC_FS, uniforms: { uClass: { value: 0 } }, side: THREE.DoubleSide });
  occMat.userData.isRainOcc = true;

  const U = {
    uTime: { value: 0 }, uSpeed: { value: 7.5 }, uDensity: { value: 0 }, uLen: { value: 0.16 }, uWind: { value: new THREE.Vector2() },
    uY: { value: new THREE.Vector2(bottom, top) }, uBounds: { value: new THREE.Vector4(bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ) },
    uOcc: { value: occRT.texture }, uAlpha: { value: 0.5 }, uFirePos: { value: new THREE.Vector3() }, uFireI: { value: 0 },
    uPx: { value: 1000 }, uGroundShare: { value: 0.12 },
  };

  // 빗줄기: 방울마다 선분 하나 (정점 2개가 같은 난수)
  const sd = new Float32Array(MAX * 2 * 4), end = new Float32Array(MAX * 2);
  for (let i = 0; i < MAX; i++) { sd.set(drops.subarray(i * 4, i * 4 + 4), i * 8); sd.set(drops.subarray(i * 4, i * 4 + 4), i * 8 + 4); end[i * 2] = 0; end[i * 2 + 1] = 1; }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 2 * 3), 3));
  lg.setAttribute('aDrop', new THREE.BufferAttribute(sd, 4));
  lg.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  lg.setDrawRange(0, Q.drops * 2);
  const streaks = new THREE.LineSegments(lg, new THREE.ShaderMaterial({ vertexShader: STREAK_VS, fragmentShader: STREAK_FS, uniforms: U, transparent: true, depthWrite: false }));
  streaks.frustumCulled = false;
  streaks.renderOrder = 12;
  group.add(streaks);

  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
  pg.setAttribute('aDrop', new THREE.BufferAttribute(drops, 4));
  pg.setDrawRange(0, Q.drops);
  const splashes = new THREE.Points(pg, new THREE.ShaderMaterial({ vertexShader: SPLASH_VS, fragmentShader: SPLASH_FS, uniforms: U, transparent: true, depthWrite: false }));
  splashes.frustumCulled = false;
  splashes.renderOrder = 12;
  group.add(splashes);

  const api = {
    group, occRT, occCam, bounds: U.uBounds.value,
    setQuality(q) {
      if (!RAIN_QUALITY[q]) return;
      Q = RAIN_QUALITY[q];
      lg.setDrawRange(0, Q.drops * 2);
      pg.setDrawRange(0, Q.drops);
      occRT.setSize(Q.occRes, Q.occRes);
    },
    setPixelScale(px) { U.uPx.value = px; },
    setSplashes(on) { splashes.visible = !!on; },
    /** 가림 높이 지도를 다시 그림 (비가 보일 때만 매 프레임) */
    renderOcclusion(renderer, scene) {
      const prevRT = renderer.getRenderTarget(), prevOv = scene.overrideMaterial, prevBg = scene.background;
      const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
      const prevAuto = renderer.shadowMap.autoUpdate;
      renderer.shadowMap.autoUpdate = false;                 // 가림 지도 그릴 때 그림자 맵을 다시 그리지 않음
      scene.overrideMaterial = occMat;
      scene.background = null;
      renderer.setRenderTarget(occRT);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, false);
      renderer.render(scene, occCam);
      renderer.setRenderTarget(prevRT);
      renderer.setClearColor(prevClear, prevAlpha);
      scene.overrideMaterial = prevOv;
      scene.background = prevBg;
      renderer.shadowMap.autoUpdate = prevAuto;
    },
    /** level = 비 존재량(페이드 포함), intensity = 사용자 세기, wind = Vector2(x,z), fire = {pos, actual} */
    update(time, { level = 0, intensity = 0.35, wind = new THREE.Vector2(), fire = null } = {}) {
      U.uTime.value = time;
      U.uDensity.value = level * (0.2 + 0.8 * intensity);     // 보이는 방울 비율
      U.uSpeed.value = 6.5 + 2.0 * intensity;
      U.uAlpha.value = 0.32 + 0.3 * intensity;
      U.uWind.value.copy(wind);
      if (fire) { U.uFirePos.value.copy(fire.pos); U.uFireI.value = fire.actual; }
      group.visible = level > 0.001;
    },
  };
  return api;
}
