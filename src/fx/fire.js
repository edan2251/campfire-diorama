// 모닥불 효과 (F05): 여러 겹 곡면 불꽃 + 잔불(숯) + 드문 불티 + 얇은 연기 + 실제 점광원 1개.
// 모든 양은 하나의 불 상태 actual(= 기본 세기 × 날씨 감쇠 × 일렁임)에서 계산한다. 불티·연기는 광원 없음.
// 일렁임은 0.3–1.2 Hz 느린 사인 합(빠른 무작위 점멸 없음). 바람은 공통 값 하나를 효과마다 다른 시간상수로 따라감.
import * as THREE from 'three';
import { NOISE_GLSL } from './noise.glsl.js';

export const FIRE_QUALITY = {
  high: { tongues: 7, octaves: 3, sparks: 60, smoke: 14, shadow: 1024 },
  medium: { tongues: 5, octaves: 2, sparks: 36, smoke: 10, shadow: 512 },
  low: { tongues: 3, octaves: 1, sparks: 16, smoke: 5, shadow: 0 },
};

/** 느린 일렁임 (1 ± 약 0.1) */
export function flicker(t, amount = 1) {
  const f = 0.05 * Math.sin(2 * Math.PI * 0.71 * t) + 0.035 * Math.sin(2 * Math.PI * 1.13 * t + 1.3) + 0.02 * Math.sin(2 * Math.PI * 0.31 * t + 0.4);
  return 1 + f * amount;
}

const FLAME_VS = /* glsl */ `
uniform float uTime, uHeight, uActual;
uniform vec2 uWind;
attribute float aPhase;
varying vec2 vUv;
varying vec3 vN, vV;
varying float vPhase;
void main() {
  vUv = uv; vPhase = aPhase;
  vec3 p = position;
  float v = uv.y;
  p.y *= uHeight;
  // 위로 갈수록 크게 흔들림 + 바람에 휨 (끝만)
  float sway = v * v;
  p.x += (sin(uTime * 2.3 + aPhase * 6.0 + v * 4.0) * 0.025 + uWind.x * 0.18) * sway * uHeight / 0.5;
  p.z += (cos(uTime * 1.9 + aPhase * 5.0 + v * 3.0) * 0.025 + uWind.y * 0.18) * sway * uHeight / 0.5;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FLAME_FS = /* glsl */ `
uniform float uTime, uActual, uCore;
uniform int uOct;
varying vec2 vUv;
varying vec3 vN, vV;
varying float vPhase;
${NOISE_GLSL}
vec3 ramp(float k) {
  vec3 c0 = vec3(0.55, 0.06, 0.015), c1 = vec3(1.0, 0.32, 0.05), c2 = vec3(1.0, 0.68, 0.24), c3 = vec3(1.0, 0.92, 0.72);
  return k < 0.4 ? mix(c0, c1, k / 0.4) : (k < 0.75 ? mix(c1, c2, (k - 0.4) / 0.35) : mix(c2, c3, (k - 0.75) / 0.25));
}
void main() {
  float u = vUv.x, v = vUv.y;
  float across = 1.0 - abs(2.0 * u - 1.0);                       // 면 가운데 1, 가장자리 0
  float n = fbm3(vec3(u * 3.2 + vPhase * 11.0, v * 2.6 - uTime * 1.45, uTime * 0.35 + vPhase * 3.0), uOct);
  float body = smoothstep(0.0, 0.55, across) * (1.08 - v);        // 위로 갈수록 얇아짐
  float d = body * 1.15 + n * 0.62 - v * 0.18;
  float mask = smoothstep(0.18, 0.5, d);                          // 끝은 노이즈로 갈라져 사라짐
  mask *= smoothstep(0.0, 0.07, v);                               // 밑동은 장작 속으로
  float facing = abs(dot(normalize(vN), normalize(vV)));
  mask *= smoothstep(0.04, 0.38, facing);                         // 면이 옆으로 보이면 흐려짐 (평면 노출 방지)
  float heat = clamp(d * 0.75 + uCore * 0.3 - v * 0.35, 0.0, 1.0);
  vec3 col = ramp(heat) * (0.5 + 1.5 * heat * heat) * (0.35 + 0.65 * uActual);     // 1차(1.2 + 3.2h²)는 하얗게 타 형태가 안 읽힘
  gl_FragColor = vec4(col, mask * clamp(uActual * 1.4, 0.0, 1.0));
}`;

const COAL_FS = /* glsl */ `
uniform float uTime, uGlow;
varying vec3 vP, vN;
${NOISE_GLSL}
void main() {
  float n = snoise(vP * 26.0 + vec3(0.0, uTime * 0.25, 0.0)) * 0.5 + 0.5;
  float crack = smoothstep(0.55, 0.85, n);
  float pulse = 0.75 + 0.25 * sin(uTime * 0.9 + vP.x * 40.0);
  float up = clamp(vN.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 base = vec3(0.045, 0.03, 0.025);
  vec3 glow = mix(vec3(0.9, 0.12, 0.02), vec3(1.0, 0.45, 0.08), crack) * (0.6 + 2.4 * crack) * pulse;
  gl_FragColor = vec4(base + glow * uGlow * (0.35 + 0.65 * up), 1.0);
}`;

const SPARK_VS = /* glsl */ `
attribute float aLife, aSize, aSeed;
uniform float uPx;
varying float vLife, vSeed;
void main() {
  vLife = aLife; vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.5, aSize * uPx / max(0.4, -mv.z)) * step(0.0, aLife);
}`;
const SPARK_FS = /* glsl */ `
uniform float uTime;
varying float vLife, vSeed;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  if (r > 0.5) discard;
  float a = smoothstep(0.5, 0.0, r);
  float fade = smoothstep(0.0, 0.15, vLife) * smoothstep(1.0, 0.6, vLife);
  float tw = 0.7 + 0.3 * sin(uTime * 9.0 + vSeed * 40.0);
  vec3 col = mix(vec3(1.0, 0.75, 0.35), vec3(1.0, 0.3, 0.05), vLife) * 4.0;
  gl_FragColor = vec4(col * tw, a * fade);
}`;

const SMOKE_VS = /* glsl */ `
attribute float aLife, aSize, aSeed;
uniform float uPx;
varying float vLife, vSeed, vH;
void main() {
  vLife = aLife; vSeed = aSeed; vH = position.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPx * (1.0 / max(0.4, -mv.z)) * step(0.0, aLife);
}`;
const SMOKE_FS = /* glsl */ `
uniform float uTime, uAmount, uTopFade;
varying float vLife, vSeed, vH;
${NOISE_GLSL}
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  if (r > 0.5) discard;
  float n = snoise(vec3(c * 3.0, uTime * 0.15 + vSeed * 10.0)) * 0.5 + 0.5;
  float a = smoothstep(0.5, 0.1, r) * (0.55 + 0.45 * n);
  float life = smoothstep(0.0, 0.25, vLife) * smoothstep(1.0, 0.45, vLife);
  a *= life * uAmount * (1.0 - smoothstep(uTopFade - 0.5, uTopFade, vH));   // 높이 1.6H 근처부터 거의 투명
  vec3 col = mix(vec3(0.42, 0.3, 0.22), vec3(0.26, 0.28, 0.33), smoothstep(0.4, 1.1, vH));
  gl_FragColor = vec4(col, a * 0.11);
}`;

function tongueGeometry(radius, arc, segU = 14, segV = 18) {
  // 원뿔 둘레에 휘어진 세로 면 (위로 갈수록 반지름이 줄어 끝이 모임). 높이는 1 (uHeight로 늘림)
  const pos = [], uv = [], nor = [], idx = [];
  for (let j = 0; j <= segV; j++) {
    const v = j / segV;
    const r = radius * (1 - 0.82 * Math.pow(v, 1.15)) + 0.004;
    for (let i = 0; i <= segU; i++) {
      const u = i / segU;
      const a = (u - 0.5) * arc;
      pos.push(Math.sin(a) * r, v, Math.cos(a) * r);
      nor.push(Math.sin(a), 0.25, Math.cos(a));
      uv.push(u, v);
    }
  }
  for (let j = 0; j < segV; j++) for (let i = 0; i < segU; i++) {
    const a = j * (segU + 1) + i, b = a + 1, c = a + segU + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// 실제 장작 모델(높이 0.28H, 폭 0.42H)에 맞춤: 불꽃이 장작 위로 솟게 높이 0.42 → 0.56, 밑동 반지름 0.13 → 0.15 (2026-10-23 20:55)
export function createFire({ position = new THREE.Vector3(), quality = 'high', baseRadius = 0.15, flameHeight = 0.56, lightIntensity = 2.8, lightDecay = 1.5 } = {}) {
  const group = new THREE.Group();
  group.name = 'fire';
  group.position.copy(position);
  let Q = FIRE_QUALITY[quality];
  const uniforms = { uTime: { value: 0 }, uActual: { value: 1 }, uWind: { value: new THREE.Vector2() }, uOct: { value: Q.octaves } };

  // ---------- 불꽃 ----------
  const flames = new THREE.Group();
  group.add(flames);
  function buildFlames() {
    for (const m of [...flames.children]) { m.geometry.dispose(); m.material.dispose(); flames.remove(m); }
    const n = Q.tongues;
    for (let k = 0; k <= n; k++) {
      const core = k === n;                                         // 마지막 = 가운데 작은 중심 면(카메라 쪽으로 돌림)
      const phase = (k * 0.618034) % 1;
      const ang = k * 2.39996;
      const r = core ? baseRadius * 0.45 : baseRadius * (0.55 + 0.45 * ((k * 0.37) % 1));
      const geo = tongueGeometry(r, core ? Math.PI * 1.1 : Math.PI * (0.7 + 0.4 * phase));
      geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(new Array(geo.attributes.position.count).fill(phase), 1));
      const mat = new THREE.ShaderMaterial({
        vertexShader: FLAME_VS, fragmentShader: FLAME_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { ...uniforms, uHeight: { value: flameHeight }, uCore: { value: core ? 1 : 0 } },
      });
      const m = new THREE.Mesh(geo, mat);
      m.userData = { core, ang, h0: flameHeight * (core ? 0.62 : 0.7 + 0.3 * ((k * 0.53) % 1)), off: core ? 0 : baseRadius * 0.28 };
      m.rotation.y = ang;
      m.position.set(Math.sin(ang) * m.userData.off, 0.02, Math.cos(ang) * m.userData.off);
      m.renderOrder = 10;
      m.frustumCulled = false;
      flames.add(m);
    }
  }
  buildFlames();

  // ---------- 잔불 (숯·장작 틈 발광) — 임시 형태, 최종 장작 에셋이 오면 그 재질에 같은 셰이더 조각을 붙임 ----------
  const coalMat = new THREE.ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uGlow: { value: 1 } },
    vertexShader: 'varying vec3 vP, vN; void main(){ vP = position; vN = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: COAL_FS,
  });
  const coals = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4, rr = baseRadius * (0.2 + 0.6 * ((i * 0.41) % 1));
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.035 + 0.02 * ((i * 0.7) % 1), 1), coalMat);
    m.position.set(Math.sin(a) * rr, 0.02, Math.cos(a) * rr);
    m.scale.y = 0.6;
    coals.add(m);
  }
  group.add(coals);

  // ---------- 불티 ----------
  const sparkMax = 60;
  const sp = { pos: new Float32Array(sparkMax * 3), life: new Float32Array(sparkMax).fill(-1), size: new Float32Array(sparkMax), seed: new Float32Array(sparkMax), vel: new Float32Array(sparkMax * 3), dur: new Float32Array(sparkMax) };
  for (let i = 0; i < sparkMax; i++) sp.seed[i] = Math.random();
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sp.pos, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeo.setAttribute('aLife', new THREE.BufferAttribute(sp.life, 1).setUsage(THREE.DynamicDrawUsage));
  sparkGeo.setAttribute('aSize', new THREE.BufferAttribute(sp.size, 1));
  sparkGeo.setAttribute('aSeed', new THREE.BufferAttribute(sp.seed, 1));
  const pxU = { value: 600 };
  const sparks = new THREE.Points(sparkGeo, new THREE.ShaderMaterial({ vertexShader: SPARK_VS, fragmentShader: SPARK_FS, uniforms: { uTime: uniforms.uTime, uPx: pxU }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sparks.frustumCulled = false;
  sparks.renderOrder = 11;
  group.add(sparks);
  let sparkAcc = 0;

  // ---------- 연기 ----------
  const smokeMax = 14;
  const sm = { pos: new Float32Array(smokeMax * 3), life: new Float32Array(smokeMax).fill(-1), size: new Float32Array(smokeMax), seed: new Float32Array(smokeMax), dur: new Float32Array(smokeMax) };
  for (let i = 0; i < smokeMax; i++) sm.seed[i] = Math.random();
  const smokeGeo = new THREE.BufferGeometry();
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(sm.pos, 3).setUsage(THREE.DynamicDrawUsage));
  smokeGeo.setAttribute('aLife', new THREE.BufferAttribute(sm.life, 1).setUsage(THREE.DynamicDrawUsage));
  smokeGeo.setAttribute('aSize', new THREE.BufferAttribute(sm.size, 1).setUsage(THREE.DynamicDrawUsage));
  smokeGeo.setAttribute('aSeed', new THREE.BufferAttribute(sm.seed, 1));
  const smokeU = { uTime: uniforms.uTime, uPx: pxU, uAmount: { value: 1 }, uTopFade: { value: 1.6 } };
  const smoke = new THREE.Points(smokeGeo, new THREE.ShaderMaterial({ vertexShader: SMOKE_VS, fragmentShader: SMOKE_FS, uniforms: smokeU, transparent: true, depthWrite: false }));
  smoke.frustumCulled = false;
  smoke.renderOrder = 9;
  group.add(smoke);
  let smokeAcc = 0;

  // ---------- 광원 ----------
  // 감쇠 지수 1.5: 물리값 2는 돌 테두리(0.36H)가 캐릭터(0.75H)보다 4배 이상 밝아 타 버림 → 연출상 완만하게
  const light = new THREE.PointLight(0xff9b52, lightIntensity, 0, lightDecay);
  light.position.set(0, flameHeight * 0.6, 0);
  light.castShadow = Q.shadow > 0;
  light.shadow.mapSize.set(Q.shadow || 512, Q.shadow || 512);
  light.shadow.bias = -0.0015;
  light.shadow.normalBias = 0.004;               // 2026-10-24: 0.02는 작은 디오라마에 비해 커서 돌·물체 밑동과 그림자 사이에 밝은 틈 → 0.004 (0.003까지 줄무늬 없음 확인)
  light.shadow.radius = 3;
  light.shadow.camera.near = 0.05;
  light.shadow.camera.far = 12;
  group.add(light);

  const wind = { flame: new THREE.Vector2(), spark: new THREE.Vector2(), smoke: new THREE.Vector2() };
  const follow = (v, target, tau, dt) => { const k = 1 - Math.exp(-dt / tau); v.x += (target.x - v.x) * k; v.y += (target.y - v.y) * k; };

  const api = {
    group, light,
    get quality() { return quality; },
    setQuality(q) {
      if (!FIRE_QUALITY[q] || q === quality) return;
      quality = q; Q = FIRE_QUALITY[q];
      uniforms.uOct.value = Q.octaves;
      buildFlames();
      light.castShadow = Q.shadow > 0;
      if (Q.shadow) { light.shadow.mapSize.set(Q.shadow, Q.shadow); light.shadow.map?.dispose(); light.shadow.map = null; }
    },
    /** 깊이 1에서 월드 1의 화면 픽셀 = 렌더 높이(px) / (2·tan(fov/2)). 화면 크기·DPR·렌즈가 바뀔 때 */
    setPixelScale(px) { pxU.value = px; },
    /**
     * dt·time = 시뮬레이션 시간(일시 정지면 dt 0). actual = 실제 불 세기(0이면 모두 꺼짐).
     * opts: { wind: Vector2 (x,z), sparks 0..1, smoke 0..1, sparksOff, smokeOff }
     */
    update(dt, time, actual, opts = {}) {
      const on = actual > 0.001;
      uniforms.uTime.value = time;
      uniforms.uActual.value = Math.min(actual, 1.5);
      const w = opts.wind ?? new THREE.Vector2();
      follow(wind.flame, w, 0.35, dt); follow(wind.spark, w, 1.2, dt); follow(wind.smoke, w, 3.0, dt);
      uniforms.uWind.value.copy(wind.flame);
      flames.visible = on;
      const a = Math.min(actual, 1.5);
      for (const m of flames.children) {
        m.material.uniforms.uHeight.value = m.userData.h0 * (0.4 + 0.6 * Math.min(a, 1.2));
      }
      coalMat.uniforms.uGlow.value = on ? 0.35 + 0.65 * Math.min(a, 1) : 0;
      light.visible = on;
      light.intensity = lightIntensity * a;
      // 광원 위치도 같은 불 상태로 아주 조금 움직임 (그림자가 살아 있게, 느리게)
      light.position.set(0.012 * Math.sin(time * 1.3), flameHeight * (0.42 + 0.18 * Math.min(a, 1)) + 0.01 * Math.sin(time * 0.9 + 1), 0.012 * Math.cos(time * 1.1));

      // 불티: 생성률 ∝ 불 세기 (드묾: 1.0에서 초당 약 5개)
      const sparkCap = opts.sparksOff ? 0 : Q.sparks;
      sparkAcc += dt * 5.0 * a * (opts.sparks ?? 0.5) * 2;
      for (let i = 0; i < sparkMax; i++) {
        if (sp.life[i] >= 0) {
          sp.life[i] += dt / sp.dur[i];
          if (sp.life[i] >= 1) { sp.life[i] = -1; continue; }
          const j = i * 3;
          sp.vel[j] += (Math.sin(time * 3 + sp.seed[i] * 50) * 0.6 + wind.spark.x * 1.5) * dt;
          sp.vel[j + 2] += (Math.cos(time * 2.6 + sp.seed[i] * 31) * 0.6 + wind.spark.y * 1.5) * dt;
          sp.vel[j + 1] -= 0.25 * dt;
          sp.pos[j] += sp.vel[j] * dt; sp.pos[j + 1] += sp.vel[j + 1] * dt; sp.pos[j + 2] += sp.vel[j + 2] * dt;
        } else if (sparkAcc >= 1 && on && i < sparkCap) {
          sparkAcc -= 1;
          const j = i * 3, ang = Math.random() * 6.283, rr = Math.random() * baseRadius * 0.6;
          sp.pos[j] = Math.sin(ang) * rr; sp.pos[j + 1] = 0.12 + Math.random() * 0.1; sp.pos[j + 2] = Math.cos(ang) * rr;
          sp.vel[j] = (Math.random() - 0.5) * 0.15; sp.vel[j + 1] = 0.55 + Math.random() * 0.45; sp.vel[j + 2] = (Math.random() - 0.5) * 0.15;
          sp.life[i] = 0; sp.dur[i] = 0.9 + Math.random() * 1.1; sp.size[i] = 0.012 + Math.random() * 0.014;   // 월드 크기(H)
        }
      }
      sparkAcc = Math.min(sparkAcc, 2);
      sparkGeo.attributes.position.needsUpdate = true;
      sparkGeo.attributes.aLife.needsUpdate = true;
      sparkGeo.attributes.aSize.needsUpdate = true;

      // 연기: 얇게, 불이 약할 때도 조금 (비 맞은 불은 연기가 약간 늘어남 — opts.smokeBoost)
      const smokeCap = opts.smokeOff ? 0 : Q.smoke;
      smokeU.uAmount.value = Math.min(1, 0.35 + 0.65 * a) * (opts.smoke ?? 0.4) * 2.2 * (1 + (opts.smokeBoost ?? 0));
      smokeAcc += dt * (smokeCap / 5.5) * (on ? 1 : 0);
      for (let i = 0; i < smokeMax; i++) {
        if (sm.life[i] >= 0) {
          sm.life[i] += dt / sm.dur[i];
          if (sm.life[i] >= 1) { sm.life[i] = -1; continue; }
          const j = i * 3, L = sm.life[i];
          sm.pos[j] += (wind.smoke.x * 0.9 + 0.03 * Math.sin(time * 0.5 + sm.seed[i] * 9)) * dt;
          sm.pos[j + 2] += (wind.smoke.y * 0.9 + 0.03 * Math.cos(time * 0.4 + sm.seed[i] * 7)) * dt;
          sm.pos[j + 1] += (0.22 - 0.08 * L) * dt;
          sm.size[i] = 0.18 + 0.55 * L;
        } else if (smokeAcc >= 1 && i < smokeCap) {
          smokeAcc -= 1;
          const j = i * 3;
          sm.pos[j] = (Math.random() - 0.5) * 0.06; sm.pos[j + 1] = flameHeight * 0.75; sm.pos[j + 2] = (Math.random() - 0.5) * 0.06;
          sm.life[i] = 0; sm.dur[i] = 4.5 + Math.random() * 2.5; sm.size[i] = 0.18;
        }
      }
      smokeAcc = Math.min(smokeAcc, 2);
      smokeGeo.attributes.position.needsUpdate = true;
      smokeGeo.attributes.aLife.needsUpdate = true;
      smokeGeo.attributes.aSize.needsUpdate = true;
    },
    /** 전체 초기화: 남은 불티·연기 제거 */
    clearParticles() { sp.life.fill(-1); sm.life.fill(-1); sparkAcc = 0; smokeAcc = 0; },
  };
  return api;
}
