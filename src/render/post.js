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

// 최종 단계. 톤매핑(ACES)·sRGB를 직접 계산 → 화면에도, 인트로 필터용 중간 버퍼(PRESENT)에도 같은 결과
// (three는 렌더 타깃에 그릴 때 톤매핑을 건너뛰므로 자동 include로는 중간 버퍼 결과가 달라짐). LEGACY_OUT = 예전 자동 경로 (같은 화면인지 검사용)
const FINAL_FS = /* glsl */ `
uniform sampler2D tColor;
uniform float uTemp, uContrast, uSat, uVignette, uGrain, uTime, uAspect, uExposure;
varying vec2 vUv;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// three r160 ACESFilmicToneMapping·sRGBTransferOETF와 같은 식 (톤매핑을 끈 재질에는 three가 함수를 넣지 않아 직접 둠)
vec3 campRRT(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 campACES(vec3 color) {
  const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= uExposure / 0.6;
  color = ACESOutputMat * campRRT(ACESInputMat * color);
  return clamp(color, 0.0, 1.0);
}
vec3 campSRGB(vec3 c) { return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }
void main() {
  vec3 c = texture2D(tColor, vUv).rgb;
  // 색온도 (선형, 밝기 유지): +따뜻하게 / -차갑게
  vec3 wb = vec3(1.0 + 0.16 * uTemp, 1.0 + 0.015 * uTemp, 1.0 - 0.2 * uTemp);
  c *= wb / dot(wb, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(c, 1.0);
#ifdef LEGACY_OUT
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
#else
  gl_FragColor = vec4(campSRGB(campACES(c)), 1.0);
#endif
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

// 인트로 필터 (Presentation Mode, 2026-10-29): 최종 화면(sRGB)을 전시용 그림처럼 — 붓 느낌(Kuwahara)·계조 단순화·하이라이트 누르기·
// 채도·대비·따뜻한/차가운 색 나눔·종이 질감·비네팅·깊이 윤곽선. 인트로가 아닐 때(탐험)는 이 단계를 아예 그리지 않음 → 원래 화질 그대로.
// 번짐 전환(uWash 0→1, 2차 2026-10-29 — 사용자 선택 "붓질이 녹아 번짐"): 그림이 물에 젖은 수채화처럼 녹음. 모닥불(uOrigin)에서 시작한
//   물 번짐이 종이에 스미듯 불규칙한 가장자리로 퍼지고(작은 번짐 몇 개가 뒤따라 생겨 합쳐짐), 번진 자리는 물감이 풀리며 실제 장면이 드러남.
//   가장자리 바깥엔 물감이 밀려 모인 진한 물자국, 안쪽엔 덜 풀린 물감 찌꺼기가 밖으로 끌려 나가며 옅어짐. 해석적 마스크(버퍼 없음).
//   (1차 "빗물 물줄기"는 사용자 의견: 연출이 이상함)
const PRESENT_FS = /* glsl */ `
#include <packing>
uniform sampler2D tColor, tDepth;
uniform vec2 uTexel;
uniform float uAspect, uTime, cameraNear, cameraFar;
uniform float uAmount, uSat, uContrast, uFlatten, uPosterize, uPaint, uOutline, uPaper, uVignette, uWarmth;
uniform float uWash, uSeed, uStreaks;
uniform vec2 uOrigin;
varying vec2 vUv;
float h11(float n) { return fract(sin(n * 127.1 + uSeed * 311.7) * 43758.5453); }
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.1 + 3.7) + 0.15 * vnoise(p * 4.3 + 9.1); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float linDepth(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar); }

vec3 paintAt(vec2 uv) {
  vec3 base = texture2D(tColor, uv).rgb;
#if PAINT_R > 0
  if (uPaint > 0.001) {
    // Kuwahara: 네 사분면 중 색이 가장 고른 쪽의 평균 → 붓으로 칠한 듯 면이 정리되고 경계는 유지
    vec3 m[4]; vec3 s[4];
    for (int k = 0; k < 4; k++) { m[k] = vec3(0.0); s[k] = vec3(0.0); }
    for (int j = 0; j <= PAINT_R; j++) for (int i = 0; i <= PAINT_R; i++) {
      vec3 a = texture2D(tColor, uv + vec2(-float(i), -float(j)) * uTexel).rgb; m[0] += a; s[0] += a * a;
      vec3 b = texture2D(tColor, uv + vec2(float(i), -float(j)) * uTexel).rgb; m[1] += b; s[1] += b * b;
      vec3 c = texture2D(tColor, uv + vec2(-float(i), float(j)) * uTexel).rgb; m[2] += c; s[2] += c * c;
      vec3 d = texture2D(tColor, uv + vec2(float(i), float(j)) * uTexel).rgb; m[3] += d; s[3] += d * d;
    }
    float n = float((PAINT_R + 1) * (PAINT_R + 1));
    float best = 1e9; vec3 col = base;
    for (int k = 0; k < 4; k++) {
      vec3 mu = m[k] / n; vec3 v = abs(s[k] / n - mu * mu);
      float sv = v.r + v.g + v.b;
      if (sv < best) { best = sv; col = mu; }
    }
    base = mix(base, col, uPaint);
  }
#endif
  return base;
}

vec3 stylize(vec2 uv) {
  vec3 c = paintAt(uv);
  float l = luma(c);
  // 하이라이트 누르기·어두운 곳 살짝 들기 (입체감이 강한 반짝임을 그림처럼)
  c -= c * smoothstep(0.55, 1.0, l) * 0.28 * uFlatten;
  c += (vec3(0.055, 0.06, 0.085) - c) * (1.0 - smoothstep(0.0, 0.22, l)) * 0.55 * uFlatten;
  // 계조 단순화 (섞는 양만큼)
  float lv = mix(28.0, 7.0, uPosterize);
  c = mix(c, floor(c * lv + 0.5) / lv, uPosterize * 0.55);
  // 채도·대비
  l = luma(c);
  c = mix(vec3(l), c, 1.0 + uSat);
  c = (c - 0.45) * (1.0 + uContrast) + 0.45;
  // 따뜻한 밝은 곳 / 차가운 어두운 곳
  vec3 warm = vec3(1.06, 1.0, 0.9), cool = vec3(0.93, 0.98, 1.08);
  c *= mix(vec3(1.0), mix(cool, warm, smoothstep(0.15, 0.7, l)), uWarmth);
#if OUTLINE
  if (uOutline > 0.001 && texture2D(tDepth, uv).x < 0.999999) {
    float d0 = linDepth(uv);
    float e = 0.0;
    e = max(e, abs(linDepth(uv + vec2(uTexel.x, 0.0)) - d0));
    e = max(e, abs(linDepth(uv - vec2(uTexel.x, 0.0)) - d0));
    e = max(e, abs(linDepth(uv + vec2(0.0, uTexel.y)) - d0));
    e = max(e, abs(linDepth(uv - vec2(0.0, uTexel.y)) - d0));
    float edge = smoothstep(0.006, 0.025, e / max(d0, 0.1));
    edge *= 1.0 - smoothstep(0.55, 0.85, luma(c));                  // 불꽃처럼 밝은 곳엔 윤곽선 없음 (1차: 불꽃 둘레에 선)
    c = mix(c, vec3(0.07, 0.055, 0.075), edge * uOutline * 0.8);
  }
#endif
  // 종이 질감 (움직이지 않음 — 인쇄된 종이처럼)
  vec2 pp = vUv * vec2(uAspect, 1.0);
  float paper = fbm(pp * 220.0) * 0.6 + fbm(pp * vec2(30.0, 900.0)) * 0.4;
  c *= 1.0 + (paper - 0.5) * 0.22 * uPaper;
  // 비네팅
  vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
  c *= 1.0 - uVignette * 0.55 * smoothstep(0.35, 1.05, length(q) * 1.25);
  return clamp(c, 0.0, 1.0);
}

float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
// 번짐 하나: 중심 c, 반경 r. 반경에 비례하는 큰 꽃잎 모양 굴곡 + 종이 결의 잔 굴곡 → 원이 아닌 수채 번짐 가장자리. 음수 = 번진 안쪽
float bloom(vec2 p, vec2 c, float r, float s) {
  vec2 d = p - c; float L = length(d); vec2 dir = d / max(L, 1e-4);
  float lobe = (fbm(dir * 1.7 + s * 13.1) - 0.5) * 0.7 + (fbm(dir * 4.3 + s * 5.7) - 0.5) * 0.3;
  return L - r * (1.0 + lobe * 0.75);
}
vec2 washField(vec2 p, float t) {                                       // (거리 f, 큰 번짐 반경)
  vec2 o = uOrigin * vec2(uAspect, 1.0);
  vec2 corner = vec2(o.x < uAspect * 0.5 ? uAspect : 0.0, o.y < 0.5 ? 1.0 : 0.0);
  float maxR = length(corner - o) * 1.4 + 0.08;                         // 굴곡이 안쪽으로 들어가도 끝엔 화면 전체
  // 아주 작은 점에서 천천히 스며 나와 점점 넓게 (시작 속도 0). 1차: 너무 빨라 0.34에 거의 전체, 2차: 처음 순간에 툭 터지는 느낌 → 사용자 의견
  float g = mix(pow(t, 1.8), t * t * (3.0 - 2.0 * t), 0.5);
  float R = maxR * g;
  float f = bloom(p, o, R, uSeed);
  for (int i = 0; i < 12; i++) {                                         // 뒤따라 떨어진 작은 번짐들 → 큰 번짐과 부드럽게 합쳐짐
    if (float(i) >= uStreaks) break;
    float fi = float(i) + uSeed * 7.0;
    vec2 c = vec2(mix(0.08, 0.92, h11(fi * 3.1)) * uAspect, mix(0.1, 0.9, h11(fi * 5.3 + 1.0)));
    float st = mix(0.18, 0.6, h11(fi * 7.7 + 2.0));
    float r = pow(max(0.0, t - st), 1.4) * mix(0.5, 0.95, h11(fi * 9.1 + 3.0));   // 작은 번짐도 0에서 천천히
    if (r > 0.0) f = smin(f, bloom(p, c, r, fi), 0.09);
  }
  float fib = smoothstep(0.02, 0.25, R);                                // 번짐이 작을 땐 잔털도 작게 (작은 점에 잔털이 크면 튀는 듯 보임)
  f += ((fbm(p * 26.0 + uSeed) - 0.5) * 0.022 + (fbm(p * vec2(8.0, 70.0)) - 0.5) * 0.012) * fib;   // 종이 섬유 따라 번진 잔털
  return vec2(f, R);
}

void main() {
  vec2 uv = vUv;
  float washed = 0.0, ring = 0.0, wet = 0.0;
  vec2 shift = vec2(0.0);
  if (uWash >= 0.0) {
    float t = clamp(uWash, 0.0, 1.0);
    vec2 p = vec2(vUv.x * uAspect, vUv.y);
    vec2 wf = washField(p, t);
    float f = wf.x;
    float band = clamp(wf.y * 0.7, 0.015, 0.2);                         // 젖은 띠 폭도 번짐 크기에 맞춰 (처음엔 좁게)
    float ramp = smoothstep(0.0, 0.3, t);                               // 물자국·찌꺼기·굴절은 천천히 짙어짐
    vec2 n = vec2(dFdx(f), dFdy(f)); n /= max(length(n), 1e-6);         // 번짐 바깥쪽 방향(화면)
    washed = 1.0 - smoothstep(-0.03, 0.004, f);
    float melt = smoothstep(-band, 0.0, f) * (1.0 - smoothstep(0.0, 0.004, f));   // 막 젖은 안쪽 띠: 물감이 풀리는 중
    float resid = melt * melt * (0.45 + 0.45 * fbm(p * 9.0 + uSeed)) * ramp;        // 덜 풀린 물감 찌꺼기(얼룩덜룩)
    washed = min(washed, 1.0 - resid);
    shift = -n * melt * 0.03 * ramp;                                          // 찌꺼기는 바깥(가장자리)으로 끌려감
    float ro = 1.0 - smoothstep(0.0, 0.07, f);
    ring = ro * ro * smoothstep(-0.01, 0.004, f) * (0.6 + 0.4 * fbm(p * 24.0)) * ramp;   // 가장자리 바깥으로 넓게 모인 물감 = 물자국 (1차: 가는 선 → 금처럼 보임)
    wet = smoothstep(-0.14, -0.01, f) * (1.0 - smoothstep(0.0, 0.01, f)) * (1.0 - smoothstep(0.85, 1.0, t)); // 갓 젖은 안쪽 = 물기로 살짝 밝고 맑게 → 마르며 사라짐
#if REFRACT
    uv += n * vec2(1.0 / uAspect, 1.0) * smoothstep(-0.03, 0.0, f) * (1.0 - smoothstep(0.0, 0.01, f)) * 0.0025 * ramp;
#endif
    float fade = 1.0 - smoothstep(0.9, 1.0, t);
    ring *= fade;
    if (t >= 1.0) { washed = 1.0; ring = 0.0; wet = 0.0; shift = vec2(0.0); }
  }
  vec3 orig = texture2D(tColor, uv).rgb;
  float k = uAmount * (1.0 - washed);
  vec3 o = orig;
  if (k > 0.001) {
    vec3 s = stylize(uv + shift * vec2(1.0 / uAspect, 1.0));
    float sl = luma(s);
    s = mix(s, mix(vec3(sl), s, 1.35) * 0.62, ring * 0.7);              // 진한 물자국(조금 더 짙고 진한 색)
    o = mix(orig, s, k);
  }
  o += (vec3(0.022, 0.026, 0.036) + o * 0.06) * wet;                 // (2차: 더 밝게 하면 번진 자리가 뿌연 얼룩처럼 보임)
  gl_FragColor = vec4(clamp(o, 0.0, 1.0), 1.0);
}`;

const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
/** 인트로 필터 품질: 붓 느낌 반경·윤곽선·굴절 (모바일·낮음 품질은 가볍게) */
export const PRESENT_QUALITY = { high: { paintR: 3, outline: 1, refract: 1 }, medium: { paintR: 2, outline: 1, refract: 1 }, low: { paintR: 0, outline: 0, refract: 0 } };   // 1차 반경 2는 1600px 화면에서 거의 안 보임

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
    uniforms: { tColor: { value: null }, uTemp: { value: 0 }, uContrast: { value: 0 }, uSat: { value: 0 }, uVignette: { value: 0.12 }, uGrain: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1 }, uExposure: { value: 1 } },
    depthTest: false, depthWrite: false,
  });
  const finalQuad = new FullScreenQuad(finalMat);
  // 인트로 필터: 최종 결과를 중간 버퍼(sRGB 8비트)에 그린 뒤 필터·씻김을 거쳐 화면으로. 인트로가 아니면 쓰지 않음
  const ldrRT = new THREE.WebGLRenderTarget(1, 1);
  let PQ = PRESENT_QUALITY[quality] ?? PRESENT_QUALITY.high;
  const presentMat = new THREE.ShaderMaterial({
    defines: { PAINT_R: PQ.paintR, OUTLINE: PQ.outline, REFRACT: PQ.refract }, vertexShader: VS, fragmentShader: PRESENT_FS,
    uniforms: { tColor: { value: ldrRT.texture }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uTime: { value: 0 },
      cameraNear: { value: 0.05 }, cameraFar: { value: 400 },
      uAmount: { value: 0 }, uSat: { value: 0 }, uContrast: { value: 0 }, uFlatten: { value: 0 }, uPosterize: { value: 0 }, uPaint: { value: 0 }, uOutline: { value: 0 },
      uPaper: { value: 0 }, uVignette: { value: 0 }, uWarmth: { value: 0 }, uWash: { value: -1 }, uSeed: { value: 7 }, uStreaks: { value: 5 }, uOrigin: { value: new THREE.Vector2(0.5, 0.5) } },
    depthTest: false, depthWrite: false,
  });
  presentMat.toneMapped = false;
  const presentQuad = new FullScreenQuad(presentMat);
  const legacyFinalMat = finalMat.clone();                          // 검사용: 예전 자동 톤매핑 경로 (debugLegacyFinal)
  legacyFinalMat.defines = { LEGACY_OUT: 1 };
  const legacyQuad = new FullScreenQuad(legacyFinalMat);
  finalMat.toneMapped = false;
  const info = { dofPx: 0, dofOn: false, aoOn: false, presentOn: false };

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
      PQ = PRESENT_QUALITY[q];
      Object.assign(presentMat.defines, { PAINT_R: PQ.paintR, OUTLINE: PQ.outline, REFRACT: PQ.refract }); presentMat.needsUpdate = true;
      api.setSize(w, h);
    },
    debugLegacyFinal: false,
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
      ldrRT.setSize(w, h);
      presentMat.uniforms.uTexel.value.set(1 / w, 1 / h);
      presentMat.uniforms.uAspect.value = w / h;
    },
    /**
     * dof: { on, focus (월드 H), fstop, maxBlur 0..1 } — 렌즈 mm는 camera.fov에서 역산
     * screen: settings.screen, time: 그레인용
     */
    render(scene, camera, { dof = null, screen = {}, time = 0, ao = true, present = null } = {}) {
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
      finalMat.uniforms.uExposure.value = renderer.toneMappingExposure;
      finalMat.uniforms.tColor.value = src.texture;
      finalMat.uniforms.uTemp.value = screen.temperature ?? 0;
      finalMat.uniforms.uContrast.value = screen.contrast ?? 0;
      finalMat.uniforms.uSat.value = screen.saturation ?? 0;
      finalMat.uniforms.uVignette.value = screen.vignette ?? 0.12;
      finalMat.uniforms.uGrain.value = screen.grain && screen.grain.on ? screen.grain.amount : 0;
      finalMat.uniforms.uTime.value = time;
      if (api.debugLegacyFinal) {
        for (const k of Object.keys(finalMat.uniforms)) legacyFinalMat.uniforms[k].value = finalMat.uniforms[k].value;
        renderer.setRenderTarget(null);
        legacyQuad.render(renderer);
        return;
      }
      // present = { amount 0..1, wash -1(없음)|0..1, filter{...}, seed, streaks(작은 번짐 수), origin[u,v](번짐 시작점) }
      info.presentOn = !!(present && (present.amount > 0.001 || present.wash >= 0));
      if (!info.presentOn) {
        renderer.setRenderTarget(null);
        finalQuad.render(renderer);
        return;
      }
      renderer.setRenderTarget(ldrRT);
      finalQuad.render(renderer);
      const f = present.filter ?? {}, u = presentMat.uniforms;
      u.tDepth.value = sceneRT.depthTexture;
      u.cameraNear.value = camera.near; u.cameraFar.value = camera.far;
      u.uTime.value = time;
      u.uAmount.value = present.amount * (f.strength ?? 1);
      u.uSat.value = f.saturation ?? 0; u.uContrast.value = f.contrast ?? 0; u.uFlatten.value = f.flatten ?? 0;
      u.uPosterize.value = f.posterize ?? 0; u.uPaint.value = f.paint ?? 0; u.uOutline.value = f.outline ?? 0;
      u.uPaper.value = f.paper ?? 0; u.uVignette.value = f.vignette ?? 0; u.uWarmth.value = f.warmth ?? 0;
      u.uWash.value = present.wash ?? -1; u.uSeed.value = present.seed ?? 7; u.uStreaks.value = present.streaks ?? 5;
      if (present.origin) u.uOrigin.value.set(present.origin[0], present.origin[1]);
      renderer.setRenderTarget(null);
      presentQuad.render(renderer);
    },
  };
  return api;
}
