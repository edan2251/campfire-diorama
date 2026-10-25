// 후처리 경로 (F09) — 한 경로만: 장면(HDR 선형 + 깊이) → 접촉 음영(AO, 2026-10-24) → 심도(DOF) → 블룸 → 최종(노출·톤매핑·sRGB·색온도·대비·채도·비네팅·그레인) → 화면.
// 접촉 음영: 그림자를 만드는 광원이 모닥불 하나뿐이고 차가운 환경광(반구광)은 가림이 없어 물체 바로 밑이 주변과 같이 밝았음 → 깊이로 좁은 반경(0.16H) 가림을 계산해 곱함.
//   불꽃처럼 밝은 화소(HDR 밝기 1 이상)·하늘(깊이 1)에는 적용하지 않음. 낮음 품질에서는 끔.
// 노출은 renderer.toneMappingExposure 한곳(= 2^EV). 심도는 카메라 설정(F08)의 값만 받는다(화면 효과 쪽 중복 DOF 없음).
// 가상 카메라: 센서 세로 24 mm, 1 H = 150 mm(가상 축척). 착란원 c(mm) = f²/(N(s−f)) · |d−s|/d → 화면 px = c · (렌더 세로 px / 24).
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export const H_MM = 150;
export const SENSOR_H_MM = 24;
export const POST_QUALITY = { high: { dofTaps: 32, msaa: 4, bloomScale: 1, aoSamples: 12 }, medium: { dofTaps: 16, msaa: 2, bloomScale: 0.75, aoSamples: 8 }, low: { dofTaps: 8, msaa: 0, bloomScale: 0.5, aoSamples: 0 } };
export const AO = { radius: 0.2, intensity: 1.3, bias: 0.02, power: 1.6 };   // bias 0.012 → 0.02: 완만한 곡면의 자기 가림 줄임

/** 렌즈 mm → 세로 화각(°) */
export const lensToFov = (mm) => (2 * Math.atan(SENSOR_H_MM / 2 / mm) * 180) / Math.PI;

/** 착란원 지름(px): 초점 거리 focus, 물체 거리 dist (둘 다 월드 H), 렌즈 mm, 가상 조리개 N, 렌더 세로 px */
export function cocPx(focus, dist, lensMm, fstop, heightPx) {
  const s = focus * H_MM, d = dist * H_MM, f = lensMm;
  if (s <= f || d <= 0) return 0;
  const cMm = ((f * f) / (fstop * (s - f))) * (Math.abs(d - s) / d);
  return cMm * (heightPx / SENSOR_H_MM);
}

const DOF_FS = /* glsl */ `
#include <packing>
uniform sampler2D tColor, tDepth;
uniform float cameraNear, cameraFar, uFocus, uA, uMaxPx;
uniform vec2 uTexel;
varying vec2 vUv;
float viewZ(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar); }
float coc(float d) { return min(uMaxPx, uA * abs(d - uFocus) / max(d, 1e-4)); }
void main() {
  vec3 col = texture2D(tColor, vUv).rgb;
  float d0 = viewZ(vUv), c0 = coc(d0);
  float tot = 1.0;
  // 화소마다 원반을 조금 돌림 (interleaved gradient noise) — 작은 밝은 점에 같은 표본 무늬가 찍히는 것을 고운 잡음으로 (D-06)
  float rot = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
  // Vogel 원반 표본 (단일 패스 보케 근사): 표본의 착란원이 그 거리를 덮을 때만 섞음, 뒤쪽 선명한 표본은 앞으로 번지지 않게 제한
  for (int i = 0; i < TAPS; i++) {
    float fi = float(i) + 0.5;
    float r = uMaxPx * sqrt(fi / float(TAPS));
    float ang = fi * 2.39996323 + rot;
    vec2 tc = vUv + vec2(cos(ang), sin(ang)) * r * uTexel;
    float ds = viewZ(tc);
    float cs = coc(ds);
    if (ds > d0) cs = min(cs, c0 * 2.0);
    float m = smoothstep(r - 1.0, r + 1.0, cs);
    col += mix(col / tot, texture2D(tColor, tc).rgb, m);
    tot += 1.0;
  }
  gl_FragColor = vec4(col / tot, 1.0);
}`;

const AO_FS = /* glsl */ `
uniform sampler2D tDepth;
uniform mat4 uProj, uInvProj;
uniform float uRadius, uIntensity, uBias, uPower;
uniform vec2 uTexel;
varying vec2 vUv;
vec3 viewPos(vec2 uv) { float d = texture2D(tDepth, uv).x; vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return v.xyz / v.w; }
void main() {
  float d = texture2D(tDepth, vUv).x;
  if (d >= 0.999999) { gl_FragColor = vec4(1.0, -1e4, 0.0, 1.0); return; }
  vec3 P = viewPos(vUv);
  vec3 Pr = viewPos(vUv + vec2(uTexel.x, 0.0)), Pl = viewPos(vUv - vec2(uTexel.x, 0.0));
  vec3 Pu = viewPos(vUv + vec2(0.0, uTexel.y)), Pd = viewPos(vUv - vec2(0.0, uTexel.y));
  vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;     // 가장자리에서는 가까운 쪽 이웃으로 법선 (테두리 번짐 방지)
  vec3 dy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
  vec3 N = normalize(cross(dx, dy));
  vec3 Tn = normalize(abs(N.y) < 0.99 ? cross(N, vec3(0.0, 1.0, 0.0)) : cross(N, vec3(1.0, 0.0, 0.0)));
  vec3 Bn = cross(N, Tn);
  // 표본 회전: 4×4 반복 무늬 (적용 단계의 4×4 흐림이 정확히 지움). 2026-10-25: 화소별 무작위 회전 + 3×3 흐림은 텐트 주름에 점무늬(자글자글)를 남겼음
  vec2 cell = mod(floor(gl_FragCoord.xy), 4.0);
  float rot = (cell.x * 4.0 + cell.y + 0.5) / 16.0 * 6.2831853;
  float occ = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    float fi = (float(i) + 0.5) / float(SAMPLES);
    float ang = float(i) * 2.39996323 + rot;
    float r = sqrt(fi);
    vec3 hdir = Tn * cos(ang) * r + Bn * sin(ang) * r + N * (sqrt(max(0.0, 1.0 - fi)) * 0.55 + 0.1);   // 옆쪽까지 (옆에 선 물체의 가림)
    vec3 S = P + hdir * uRadius * mix(0.25, 1.0, fi * fi);
    vec4 cs = uProj * vec4(S, 1.0);
    vec2 suv = cs.xy / cs.w * 0.5 + 0.5;
    float sz = viewPos(suv).z;
    float range = smoothstep(0.0, 1.0, uRadius / max(1e-4, abs(P.z - sz)));
    occ += step(S.z + uBias, sz) * range;
  }
  gl_FragColor = vec4(pow(clamp(1.0 - occ / float(SAMPLES) * uIntensity, 0.0, 1.0), uPower), P.z, 0.0, 1.0);
}`;
// 접촉 음영 적용: 반 해상도 AO를 깊이 차이로 가려 3×3 흐림 → 장면 색에 곱함 (밝은 화소 제외)
const AO_APPLY_FS = /* glsl */ `
uniform sampler2D tColor, tAO, tDepth;
uniform mat4 uInvProj;
uniform vec2 uAOTexel;
uniform float uDebug;
varying vec2 vUv;
float viewZ(vec2 uv) { float d = texture2D(tDepth, uv).x; vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return v.z / v.w; }
void main() {
  vec3 col = texture2D(tColor, vUv).rgb;
  if (texture2D(tDepth, vUv).x >= 0.999999) { gl_FragColor = vec4(col, 1.0); return; }   // 하늘: 그대로 (깊이 1에서 시선 깊이가 무한대 → 가중치 0이 되어 검게 되던 문제)
  float z0 = viewZ(vUv);
  float sum = 0.0, wsum = 0.0;
  for (int y = -2; y <= 1; y++) for (int x = -2; x <= 1; x++) {                       // 4×4 (회전 무늬 한 주기)
    vec4 a = texture2D(tAO, vUv + (vec2(float(x), float(y)) + 0.5) * uAOTexel);
    float w = 1.0 / (1.0 + abs(a.g - z0) * 60.0);
    sum += a.r * w; wsum += w;
  }
  float ao = wsum > 1e-3 ? sum / wsum : texture2D(tAO, vUv).r;
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  ao = mix(ao, 1.0, smoothstep(0.8, 3.0, l));
  gl_FragColor = uDebug > 0.5 ? vec4(vec3(ao) * 0.5, 1.0) : vec4(col * ao, 1.0);   // uDebug: 접촉 음영 값만 보기 (검사용)
}`;

const FINAL_FS = /* glsl */ `
uniform sampler2D tColor;
uniform float uTemp, uContrast, uSat, uVignette, uGrain, uTime, uAspect;
varying vec2 vUv;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec3 c = texture2D(tColor, vUv).rgb;
  // 색온도 (선형, 밝기 유지): +따뜻하게 / -차갑게
  vec3 wb = vec3(1.0 + 0.16 * uTemp, 1.0 + 0.015 * uTemp, 1.0 - 0.2 * uTemp);
  c *= wb / dot(wb, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  vec3 o = gl_FragColor.rgb;
  float l = dot(o, vec3(0.2126, 0.7152, 0.0722));
  o = mix(vec3(l), o, 1.0 + uSat);
  o = (o - 0.45) * (1.0 + uContrast) + 0.45;
  vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
  o *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(q) * 1.25);
  float g = hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 131.0) - 0.5;
  o += g * uGrain * 0.09 * (0.35 + 0.65 * (1.0 - abs(l - 0.5) * 2.0));
  gl_FragColor = vec4(clamp(o, 0.0, 1.0), 1.0);
}`;

const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export function createPost(renderer, { quality = 'high' } = {}) {
  let Q = POST_QUALITY[quality];
  let w = 1, h = 1;
  const makeSceneRT = () => {
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: Q.msaa });
    rt.depthTexture = new THREE.DepthTexture(w, h);
    rt.depthTexture.type = THREE.UnsignedIntType;
    return rt;
  };
  let sceneRT = makeSceneRT();
  const dofRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
  const dofMat = new THREE.ShaderMaterial({
    defines: { TAPS: Q.dofTaps }, vertexShader: VS, fragmentShader: DOF_FS,
    uniforms: { tColor: { value: null }, tDepth: { value: null }, cameraNear: { value: 0.05 }, cameraFar: { value: 400 }, uFocus: { value: 5 }, uA: { value: 0 }, uMaxPx: { value: 0 }, uTexel: { value: new THREE.Vector2() } },
    depthTest: false, depthWrite: false,
  });
  const dofQuad = new FullScreenQuad(dofMat);
  const aoRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const aoOutRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const aoMat = new THREE.ShaderMaterial({
    defines: { SAMPLES: Math.max(1, Q.aoSamples) }, vertexShader: VS, fragmentShader: AO_FS,
    uniforms: { tDepth: { value: null }, uProj: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() }, uRadius: { value: AO.radius }, uIntensity: { value: AO.intensity }, uBias: { value: AO.bias }, uPower: { value: AO.power }, uTexel: { value: new THREE.Vector2() } },
    depthTest: false, depthWrite: false,
  });
  const aoQuad = new FullScreenQuad(aoMat);
  const aoApplyMat = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: AO_APPLY_FS,
    uniforms: { tColor: { value: null }, tAO: { value: aoRT.texture }, tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uAOTexel: { value: new THREE.Vector2() }, uDebug: { value: 0 } },
    depthTest: false, depthWrite: false,
  });
  const aoApplyQuad = new FullScreenQuad(aoApplyMat);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.45, 1.0);
  const finalMat = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FINAL_FS,
    uniforms: { tColor: { value: null }, uTemp: { value: 0 }, uContrast: { value: 0 }, uSat: { value: 0 }, uVignette: { value: 0.12 }, uGrain: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1 } },
    depthTest: false, depthWrite: false,
  });
  const finalQuad = new FullScreenQuad(finalMat);
  const info = { dofPx: 0, dofOn: false, aoOn: false };

  const api = {
    get sceneRT() { return sceneRT; },
    aoUniforms: aoMat.uniforms, aoApplyUniforms: aoApplyMat.uniforms,
    info,
    setQuality(q) {
      if (!POST_QUALITY[q] || POST_QUALITY[q] === Q) return;
      Q = POST_QUALITY[q];
      sceneRT.dispose(); sceneRT = makeSceneRT();
      dofMat.defines.TAPS = Q.dofTaps; dofMat.needsUpdate = true;
      aoMat.defines.SAMPLES = Math.max(1, Q.aoSamples); aoMat.needsUpdate = true;
      api.setSize(w, h);
    },
    /** 실제 렌더 픽셀 크기 */
    setSize(width, height) {
      w = Math.max(1, Math.round(width)); h = Math.max(1, Math.round(height));
      sceneRT.setSize(w, h);
      dofRT.setSize(w, h);
      bloom.setSize(Math.round(w * Q.bloomScale), Math.round(h * Q.bloomScale));
      const aw = Math.max(1, Math.round(w / 2)), ah = Math.max(1, Math.round(h / 2));
      aoRT.setSize(aw, ah); aoOutRT.setSize(w, h);
      aoMat.uniforms.uTexel.value.set(1 / aw, 1 / ah);
      aoApplyMat.uniforms.uAOTexel.value.set(1 / aw, 1 / ah);
      dofMat.uniforms.uTexel.value.set(1 / w, 1 / h);
      finalMat.uniforms.uAspect.value = w / h;
    },
    /**
     * dof: { on, focus (월드 H), fstop, maxBlur 0..1 } — 렌즈 mm는 camera.fov에서 역산
     * screen: settings.screen, time: 그레인용
     */
    render(scene, camera, { dof = null, screen = {}, time = 0, ao = true } = {}) {
      renderer.setRenderTarget(sceneRT);
      renderer.clear();
      renderer.render(scene, camera);
      let src = sceneRT;
      info.aoOn = !!(ao && Q.aoSamples > 0);
      if (info.aoOn) {
        aoMat.uniforms.tDepth.value = sceneRT.depthTexture;
        aoMat.uniforms.uProj.value.copy(camera.projectionMatrix);
        aoMat.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
        renderer.setRenderTarget(aoRT);
        aoQuad.render(renderer);
        aoApplyMat.uniforms.tColor.value = sceneRT.texture;
        aoApplyMat.uniforms.tDepth.value = sceneRT.depthTexture;
        aoApplyMat.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
        renderer.setRenderTarget(aoOutRT);
        aoApplyQuad.render(renderer);
        src = aoOutRT;
      }
      info.dofOn = !!(dof && dof.on);
      if (info.dofOn) {
        const lensMm = SENSOR_H_MM / 2 / Math.tan((camera.fov * Math.PI) / 360);
        const s = dof.focus * H_MM, f = lensMm;
        const A = s > f ? ((f * f) / (dof.fstop * (s - f))) * (h / SENSOR_H_MM) : 0;   // coc(d) = A·|d−s|/d (d·s 같은 단위라 비율)
        const maxPx = (dof.maxBlur ?? 0.5) * h * 0.022;
        dofMat.uniforms.tColor.value = src.texture;
        dofMat.uniforms.tDepth.value = sceneRT.depthTexture;
        dofMat.uniforms.cameraNear.value = camera.near;
        dofMat.uniforms.cameraFar.value = camera.far;
        dofMat.uniforms.uFocus.value = dof.focus;
        dofMat.uniforms.uA.value = A;
        dofMat.uniforms.uMaxPx.value = maxPx;
        info.dofPx = maxPx;
        renderer.setRenderTarget(dofRT);
        dofQuad.render(renderer);
        src = dofRT;
      }
      const b = screen.bloom ?? 0.35;
      if (b > 0.001) {
        bloom.strength = b * 0.9;
        bloom.render(renderer, null, src, 0, false);               // 입력 위에 가산 합성
      }
      renderer.toneMappingExposure = Math.pow(2, screen.exposure ?? 0);
      finalMat.uniforms.tColor.value = src.texture;
      finalMat.uniforms.uTemp.value = screen.temperature ?? 0;
      finalMat.uniforms.uContrast.value = screen.contrast ?? 0;
      finalMat.uniforms.uSat.value = screen.saturation ?? 0;
      finalMat.uniforms.uVignette.value = screen.vignette ?? 0.12;
      finalMat.uniforms.uGrain.value = screen.grain && screen.grain.on ? screen.grain.amount : 0;
      finalMat.uniforms.uTime.value = time;
      renderer.setRenderTarget(null);
      finalQuad.render(renderer);
    },
  };
  return api;
}
