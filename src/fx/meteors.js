// 유성우 (U-19 · U-20): 가끔 하늘을 비스듬히 가로지르는 부드럽고 반짝이는 별똥별 (혜성은 사용자 의견으로 뺌 — "과한 디자인 말고 반짝이는 빛").
// 실제 3D 공간 안: 섬을 둘러싼 반지름 30 둥근 하늘(돔) 위를 지나감 — 카메라를 따라다니지 않으므로 돌리거나 옮기면 원근·시차가 생김
//   (1차는 카메라를 따라다니는 하늘에 붙여 화면에 붙은 UI처럼 보였음 — 사용자 지적).
// 모양: 반짝이는 머리(작은 빛 + 깜빡이는 네 갈래 빛살) + 지나온 길을 따라 휘는 가는 꼬리 + 꼬리의 반짝이 가루. 꼬리 면·머리는 카메라를 향함.
// U-20 다듬기 (사용자: 제안 1~9 모두):
//   1 속도 리듬: 빠르게 나타나 끝에서 느려지며 사라짐 (경로 시간을 ease-out으로)
//   2 끝에서 '팟': 사라지기 직전 머리가 한 번 밝아지고 작은 빛가루가 흩어짐 (sparks)
//   3 색: 대부분 흰빛, 가끔 옅은 금빛·하늘빛·연분홍
//   4 다양함: 대부분 희미하고 짧게, 가끔(약 12%) 밝고 긴 '주인공' 별똥별
//   5 별 반응: 머리가 지나는 근처 별이 잠깐 반짝 (excite() → fx/sky.js)
//   6 오로라: 켜져 있으면 빈도를 조금 올림 (main.js)
//   7 장면 빛: 밝은 별똥별이 지날 때 옅은 푸른빛이 한 번 스침 (그림자 없는 방향광, 아주 약하게)
//   8 인트로 첫 장면: 시작하고 2초 뒤 주인공 별똥별 하나 (soon(), main.js)
//   9 소원: 지나가는 별똥별을 누르면 한 번 더 반짝이고 "소원" 안내 (hit()·wish(), main.js)
// 움직임: 화면 위쪽 한쪽에서 반대쪽으로 수평에서 15~30° 아래로, 돔을 따라 살짝 아래로 휘는 곡선. 빈도 rate 0..1 = 평균 30초 → 5초.
import * as THREE from 'three';

const R = 30;                                    // 돔 반지름 (카메라 거리 최대 16보다 바깥, 별 하늘보다 안쪽)
const CENTER = new THREE.Vector3(0, 0, 0);       // 섬 가운데
const MAX = 5;
const SEG = 30;
const STEP = 1 / 60;                             // 경로를 미리 계산해 두는 시간 간격
const SPARKS = 72;
const TINTS = [[1, 0.86, 0.58], [0.66, 0.85, 1], [1, 0.74, 0.86]];   // 옅은 금빛 · 하늘빛 · 연분홍 (나머지는 흰빛)
const WHITE = [1, 0.97, 0.9];
const TAIL_VS = `
attribute float aU; attribute float aS;
varying float vU; varying float vS;
void main(){ vU = aU; vS = aS; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// 값은 모두 0..1로 자름 — 보간 오차로 pow(음수)=NaN이면 블룸이 검은 네모로 번짐 (1차에서 발견)
const TAIL_FS = `
uniform float uAlpha; uniform float uTime; uniform float uSeed; uniform vec3 uTint;
varying float vU; varying float vS;
float h1(float x){ return fract(sin(x * 91.7 + uSeed * 47.3) * 43758.5453); }
void main(){
  float t = clamp(vU, 0.0, 1.0), s = clamp(vS, -1.0, 1.0);
  float across = exp(-s * s * 4.0);
  float fade = pow(1.0 - t, 1.7);
  float h = h1(floor(t * 46.0));
  float tw = 0.5 + 0.5 * sin(uTime * 17.0 + h * 40.0);
  float speck = step(0.8, h) * tw * exp(-s * s * 9.0) * smoothstep(0.06, 0.3, t) * (1.0 - t);
  float a = clamp((across * fade * 0.85 + speck * 1.1) * uAlpha, 0.0, 1.0);
  vec3 col = mix(uTint, mix(uTint, vec3(0.62, 0.8, 1.0), 0.6), smoothstep(0.0, 0.85, t));
  gl_FragColor = vec4(col * a * 1.5, a);
}`;
const HEAD_FS = `
uniform float uAlpha; uniform float uTime; uniform float uSeed; uniform float uFlash; uniform vec3 uTint;
varying vec2 vUv;
void main(){
  vec2 p = clamp(vUv, 0.0, 1.0) * 2.0 - 1.0;
  float r2 = dot(p, p);
  float core = exp(-r2 * 70.0), halo = exp(-r2 * 9.0) * (0.28 + 0.5 * uFlash);
  float rays = exp(-abs(p.y) * 46.0) * exp(-abs(p.x) * 3.2) + exp(-abs(p.x) * 46.0) * exp(-abs(p.y) * 3.2);
  float tw = 0.55 + 0.45 * sin(uTime * 21.0 + uSeed * 9.0);
  float a = clamp((core * 1.2 + halo + rays * (0.75 * tw + uFlash)) * uAlpha, 0.0, 1.0);
  gl_FragColor = vec4(mix(vec3(1.0), uTint, 0.5) * a * (1.6 + uFlash), a);
}`;
const HEAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const SPARK_VS = `
attribute float aA; attribute vec3 aC;
uniform float uPx;
varying float vA; varying vec3 vC;
void main(){ vA = aA; vC = aC; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp((2.0 + 3.0 * aA) * uPx * 52.0 / max(1.0, -mv.z), 0.0, 16.0); }`;
const SPARK_FS = `
varying float vA; varying vec3 vC;
void main(){ float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard; float a = clamp(smoothstep(0.5, 0.0, r) * vA, 0.0, 1.0); gl_FragColor = vec4(vC * a * 1.8, a); }`;
const mat = (vs, fs, u) => new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
const ease = (x) => x * x * (3 - 2 * x);

export function createMeteors({ seed = 11 } = {}) {
  let rnd = seed;
  const rand = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
  const group = new THREE.Group();
  group.name = 'meteors';
  const pool = [];
  for (let i = 0; i < MAX; i++) {
    const g = new THREE.BufferGeometry();
    const u = new Float32Array((SEG + 1) * 2), sd = new Float32Array((SEG + 1) * 2), idx = [];
    for (let k = 0; k <= SEG; k++) {
      u[k * 2] = u[k * 2 + 1] = k / SEG; sd[k * 2] = -1; sd[k * 2 + 1] = 1;
      if (k < SEG) { const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEG + 1) * 6), 3));
    g.setAttribute('aU', new THREE.BufferAttribute(u, 1));
    g.setAttribute('aS', new THREE.BufferAttribute(sd, 1));
    g.setIndex(idx);
    const tint = new THREE.Vector3(...WHITE);
    const tu = { uAlpha: { value: 0 }, uTime: { value: 0 }, uSeed: { value: rand() }, uTint: { value: tint } };
    const tail = new THREE.Mesh(g, mat(TAIL_VS, TAIL_FS, tu));
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    hg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2));
    hg.setIndex([0, 1, 2, 2, 1, 3]);
    const hu = { uAlpha: { value: 0 }, uTime: { value: 0 }, uSeed: { value: rand() }, uFlash: { value: 0 }, uTint: { value: tint } };
    const head = new THREE.Mesh(hg, mat(HEAD_VS, HEAD_FS, hu));
    for (const m of [tail, head]) { m.frustumCulled = false; m.renderOrder = -7; m.visible = false; group.add(m); }
    pool.push({ tail, head, tu, hu, tint, life: 0, dur: 0, path: [], w: 1, size: 1, bright: 1, tailT: 0.5, hero: false, popped: false, wished: 0, alpha: 0, H: new THREE.Vector3(), D: new THREE.Vector3() });
  }
  // 끝의 빛가루
  const sp = { pos: new Float32Array(SPARKS * 3), a: new Float32Array(SPARKS), c: new Float32Array(SPARKS * 3), v: Array.from({ length: SPARKS }, () => new THREE.Vector3()), life: new Float32Array(SPARKS), max: new Float32Array(SPARKS) };
  const spG = new THREE.BufferGeometry();
  spG.setAttribute('position', new THREE.BufferAttribute(sp.pos, 3));
  spG.setAttribute('aA', new THREE.BufferAttribute(sp.a, 1));
  spG.setAttribute('aC', new THREE.BufferAttribute(sp.c, 3));
  const spU = { uPx: { value: 1 } };
  const sparks = new THREE.Points(spG, mat(SPARK_VS, SPARK_FS, spU));
  sparks.frustumCulled = false; sparks.renderOrder = -6;
  group.add(sparks);
  // 장면 빛 (7): 그림자 없는 옅은 푸른 방향광 — 밝은 별똥별 쪽에서
  const light = new THREE.DirectionalLight(0xbcd2ff, 0);
  light.castShadow = false;
  group.add(light, light.target);

  let wait = 5 + rand() * 6;                     // 처음 하나는 조금 뒤에
  const queue = [];
  let lastRate = 0, time = 0, thick = 1;           // thick = 인트로 그림 필터 동안 굵고 밝게 (붓 느낌 필터가 가는 선을 지움)
  const up = new THREE.Vector3(0, 1, 0);
  const interval = (rate) => 30 - 25 * Math.min(1, Math.max(0, rate));

  /** 경로 미리 계산 (월드 좌표): 시작 p·방향 d에서 각속도 w(라디안/초)로, 아래쪽으로 kappa만큼씩 휘며 */
  function makePath(p, d, w, kappa, dur) {
    const out = [];
    const P = p.clone(), D = d.clone();
    const n = Math.ceil((dur + 0.1) / STEP) + 1;
    for (let i = 0; i < n; i++) {
      out.push(P.clone().multiplyScalar(R).add(CENTER));
      P.addScaledVector(D, w * STEP).normalize();
      const down = up.clone().negate().addScaledVector(P, P.y);
      down.addScaledVector(D, -down.dot(D));
      if (down.lengthSq() > 1e-10) D.addScaledVector(down.normalize(), kappa * STEP);
      D.addScaledVector(P, -D.dot(P)).normalize();
    }
    return out;
  }
  // (1) 속도 리듬: 실제 시간 → 경로 시간. 처음 빠르고 끝에서 느려짐 (전체 길이는 같음)
  const warp = (s, t) => { const k = Math.min(1, Math.max(0, t / s.dur)); return s.dur * (1 - Math.pow(1 - k, 1.8)); };
  const at = (s, t, out = new THREE.Vector3()) => {
    const f = warp(s, t) / STEP, i = Math.min(s.path.length - 2, Math.floor(f));
    return out.copy(s.path[i]).lerp(s.path[i + 1], Math.min(1, f - i));
  };

  const ray = new THREE.Raycaster();
  function domeDir(camera, nx, ny) {
    ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
    const o = ray.ray.origin.clone().sub(CENTER), d = ray.ray.direction;
    const b = o.dot(d), c = o.lengthSq() - R * R;
    const t = -b + Math.sqrt(Math.max(0, b * b - c));
    return o.addScaledVector(d, t).normalize();
  }
  function spawn(q, camera) {
    const s = pool.find((x) => x.life <= 0);
    if (!s) return;
    const p = domeDir(camera, q.nx, q.ny);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(q.side);
    right.addScaledVector(p, -right.dot(p)).normalize();
    // '아래' = 화면 아래(카메라 위쪽의 반대)를 그 자리 접선으로 → 각도가 화면에서 그대로 보임 (월드 아래로 하면 내려다보는 카메라에서 너무 가파름)
    const down = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).negate();
    down.addScaledVector(p, -down.dot(p)).addScaledVector(right, -down.dot(right)).normalize();
    const d = right.multiplyScalar(Math.cos(q.slope)).addScaledVector(down, Math.sin(q.slope)).normalize();
    // (4) 대부분 희미하고 짧게, 가끔 밝고 긴 주인공
    const hero = q.hero ?? rand() < 0.12;
    s.hero = hero;
    s.dur = hero ? 2.4 + rand() * 0.5 : 1.1 + rand() * 0.8;
    s.path = makePath(p, d, hero ? 0.36 + rand() * 0.08 : 0.3 + rand() * 0.14, 0.12 + rand() * 0.16, s.dur);
    s.w = hero ? 1.45 : 0.75 + rand() * 0.25;
    s.size = hero ? 1.5 : 0.75 + rand() * 0.3;
    s.bright = hero ? 1.5 : 0.45 + Math.pow(rand(), 1.5) * 0.55;
    s.tailT = hero ? 0.85 : 0.45;
    // (3) 색: 대부분 흰빛, 가끔 옅은 금빛·하늘빛·연분홍
    s.tint.set(...(rand() < 0.65 ? WHITE : TINTS[Math.floor(rand() * TINTS.length)]));
    s.popped = false; s.wished = 0;
    s.life = s.dur;
    s.tail.visible = s.head.visible = true;
  }
  function burst(now, { hero, delay = 0 } = {}) {
    const side = rand() < 0.5 ? 1 : -1;
    const n = hero ? 1 : rand() < 0.2 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      queue.push({
        at: now + delay + i * (0.4 + rand() * 0.8),
        nx: -side * (hero ? 0.35 + rand() * 0.3 : 0.12 + rand() * 0.6),
        ny: hero ? 0.5 + rand() * 0.2 : 0.3 + rand() * 0.5,                // 주인공은 섬 위 하늘(화면 위쪽)에서 — 가운데는 섬·텐트에 가려지기 쉬움
        side, slope: ((hero ? 8 + rand() * 7 : 15 + rand() * 15) * Math.PI) / 180, hero,   // 주인공은 완만하게 → 하늘에 오래 머묾
      });
    }
  }
  // (2) 끝의 '팟': 머리에서 빛가루 흩어짐
  function pop(s, n) {
    s.popped = true;
    const T = s.D;
    for (let k = 0, made = 0; k < SPARKS && made < n; k++) {
      if (sp.life[k] > 0) continue;
      made++;
      const r = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
      sp.v[k].copy(T).multiplyScalar(0.8 + rand() * 1.2).addScaledVector(r, 0.5 + rand() * 1.1);
      sp.pos[k * 3] = s.H.x; sp.pos[k * 3 + 1] = s.H.y; sp.pos[k * 3 + 2] = s.H.z;
      sp.max[k] = sp.life[k] = 0.45 + rand() * 0.5;
      const c = rand() < 0.5 ? [1, 1, 1] : [s.tint.x, s.tint.y, s.tint.z];
      sp.c.set(c, k * 3);
    }
  }

  const v = new THREE.Vector3(), v2 = new THREE.Vector3(), tan = new THREE.Vector3(), sdv = new THREE.Vector3(), toCam = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  function draw(s, age, alpha, flash, camera) {
    const cam = camera.position;
    const pos = s.tail.geometry.attributes.position.array;
    const tailT = Math.min(s.tailT, age + 0.02);
    for (let k = 0; k <= SEG; k++) {
      const u = k / SEG;
      at(s, age - u * tailT, v);
      at(s, age - Math.min(1, u + 1 / SEG) * tailT - (k === SEG ? 0.01 : 0), v2);
      tan.subVectors(v, v2);
      if (tan.lengthSq() < 1e-12) tan.copy(s.D);
      sdv.crossVectors(tan, toCam.subVectors(cam, v)).normalize();
      const half = (0.065 * s.w * Math.pow(1 - u, 0.8) + 0.003) * thick;
      const i = k * 6;
      pos[i] = v.x - sdv.x * half; pos[i + 1] = v.y - sdv.y * half; pos[i + 2] = v.z - sdv.z * half;
      pos[i + 3] = v.x + sdv.x * half; pos[i + 4] = v.y + sdv.y * half; pos[i + 5] = v.z + sdv.z * half;
    }
    s.tail.geometry.attributes.position.needsUpdate = true;
    at(s, age, s.H);
    s.D.subVectors(s.H, at(s, age - 0.03, v2)).normalize();
    toCam.subVectors(cam, s.H).normalize();
    a.crossVectors(toCam, up).normalize(); b.crossVectors(a, toCam).normalize();
    const hs = 0.34 * s.size * (1 + flash * 0.8) * (0.5 + 0.5 * thick);
    const hp = s.head.geometry.attributes.position.array;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([x, y], i) => {
      hp[i * 3] = s.H.x + (a.x * x + b.x * y) * hs; hp[i * 3 + 1] = s.H.y + (a.y * x + b.y * y) * hs; hp[i * 3 + 2] = s.H.z + (a.z * x + b.z * y) * hs;
    });
    s.head.geometry.attributes.position.needsUpdate = true;
    s.tu.uAlpha.value = alpha; s.hu.uAlpha.value = alpha; s.hu.uFlash.value = flash;
    s.tu.uTime.value = s.hu.uTime.value = time;
  }

  const api = {
    group,
    /** 매 프레임. camera = 지금 카메라, rate = 빈도, level = 밝기·켜짐(0 = 새로 안 만듦), pixelRatio = 빛가루 크기 */
    update(dt, { camera, rate = 0.4, level = 1, pixelRatio = 1, filter = 0 } = {}) {
      time += dt;
      thick = 1 + 1.3 * filter;
      spU.uPx.value = pixelRatio;
      if (rate > lastRate + 0.2) wait = Math.min(wait, 0.5 + rand());
      lastRate = rate;
      if (level > 0.02) {
        wait -= dt;
        if (wait <= 0) { burst(time); wait = interval(rate) * (0.5 + rand()); }
      }
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].at <= time) { const q = queue.splice(i, 1)[0]; if (level > 0.02) spawn(q, camera); }
      let glow = 0;
      for (const s of pool) {
        if (s.life <= 0) { s.alpha = 0; continue; }
        s.life -= dt;
        if (s.life <= 0) { s.tail.visible = s.head.visible = false; s.alpha = 0; continue; }
        const age = s.dur - s.life, k = age / s.dur;
        // 나타남 0.2초 → 그대로 → 0.8~0.88에서 한 번 밝아짐('팟') → 0.88부터 빠르게 사라짐
        const flash = Math.max(0, 1 - Math.abs(k - 0.84) / 0.05) * (s.hero ? 1.3 : 0.8) + s.wished;
        const fadeOut = k > 0.86 ? ease(Math.max(0, 1 - (k - 0.86) / 0.14)) : 1;
        s.alpha = s.bright * level * ease(Math.min(1, age / 0.2)) * fadeOut * (1 + s.wished * 0.6) * (1 + 0.5 * (thick - 1));
        s.wished = Math.max(0, s.wished - dt * 1.5);
        draw(s, age, s.alpha, flash, camera);
        if (!s.popped && k >= 0.84) pop(s, s.hero ? 16 : 7);
        glow += s.alpha * (s.hero ? 0.32 : 0.05) * (1 + flash);
      }
      // 빛가루
      let any = false;
      for (let k = 0; k < SPARKS; k++) {
        if (sp.life[k] <= 0) { sp.a[k] = 0; continue; }
        any = true;
        sp.life[k] -= dt;
        sp.v[k].multiplyScalar(Math.exp(-dt * 2.2)).y -= dt * 0.6;
        sp.pos[k * 3] += sp.v[k].x * dt; sp.pos[k * 3 + 1] += sp.v[k].y * dt; sp.pos[k * 3 + 2] += sp.v[k].z * dt;
        const f = Math.max(0, sp.life[k] / sp.max[k]);
        sp.a[k] = f * f * level * (0.6 + 0.4 * Math.sin(time * 30 + k));
      }
      sparks.visible = any;
      if (any) { spG.attributes.position.needsUpdate = true; spG.attributes.aA.needsUpdate = true; spG.attributes.aC.needsUpdate = true; }
      // (7) 장면 빛: 가장 밝은 별똥별 쪽에서 아주 옅게
      const lead = pool.reduce((m, s) => (s.alpha > (m?.alpha ?? 0) ? s : m), null);
      light.intensity = Math.min(0.35, glow);                         // 아주 옅게 (환경광 1.5·윤곽광 1.25에 비해)
      if (lead) light.position.copy(lead.H);
    },
    get active() { return pool.filter((s) => s.life > 0).length; },
    /** (5) 별 반응용: 지금 머리들의 방향(카메라에서)과 세기 [{ dir, w }] */
    excite(camera) {
      const out = [];
      for (const s of pool) if (s.life > 0 && s.alpha > 0.02) out.push({ dir: s.H.clone().sub(camera.position).normalize(), w: Math.min(1.5, s.alpha * (s.hero ? 1.2 : 0.8)) });
      return out;
    },
    /** (8) delay초 뒤 하나 (hero = 주인공) */
    soon(delay, { hero = false } = {}) { burst(time, { hero, delay }); },
    /** (9) 화면 점(px)이 지나가는 별똥별 위인지 — 머리·꼬리 선에서 tol px 안. 맞으면 그 별똥별 */
    hit(x, y, camera, rect, tol = 34) {
      const P = (w) => { const q = w.clone().project(camera); return q.z > 1 ? null : [rect.left + ((q.x + 1) / 2) * rect.width, rect.top + ((1 - q.y) / 2) * rect.height]; };
      let best = null, bd = tol;
      for (const s of pool) {
        if (s.life <= 0 || s.alpha < 0.05) continue;
        const age = s.dur - s.life;
        let prev = null;
        for (let k = 0; k <= 6; k++) {
          const p = P(at(s, age - (k / 6) * Math.min(s.tailT, age), new THREE.Vector3()));
          if (p && prev) {
            const dx = p[0] - prev[0], dy = p[1] - prev[1], L2 = dx * dx + dy * dy || 1;
            const t = Math.max(0, Math.min(1, ((x - prev[0]) * dx + (y - prev[1]) * dy) / L2));
            const d = Math.hypot(x - (prev[0] + dx * t), y - (prev[1] + dy * t));
            if (d < bd) { bd = d; best = s; }
          }
          prev = p;
        }
      }
      return best;
    },
    /** (9) 소원: 그 별똥별이 한 번 더 밝게 반짝이고 빛가루 */
    wish(s) { if (!s) return false; s.wished = 1.2; s.bright = Math.max(s.bright, 1.1); pop(s, 12); return true; },
    /** 검사·체험용: 바로 하나 (다음 update에서 나타남) */
    burst(opts) { burst(time, opts); },
    clear() { for (const s of pool) { s.life = 0; s.alpha = 0; s.tail.visible = s.head.visible = false; } queue.length = 0; sp.life.fill(0); light.intensity = 0; },
  };
  return api;
}
