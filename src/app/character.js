// 캐릭터 표시 (F03): GLB + AnimationMixer. 컨트롤러(logic/controller.js)가 상태·위치·방향·전환 재생 위치를 소유하고, 여기서는 읽기만 한다.
// 클립 전환은 컨트롤러 transitionId가 바뀔 때만 (같은 클립 재시작 없음). 앉기·일어나기는 한 번 재생, 시간은 컨트롤러 clipTime에 맞춤.
// 섞기: 서기↔걷기 0.25초, 그 밖(경계 자세가 같은 전환) 0.12초. 부드러운 섞기로 앉기·일어나기를 대신하지 않음.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const ONCE = new Set(['SitDown_Ground', 'StandUp_Ground']);
const LOCO = new Set(['Idle_Stand', 'Walk']);

// 가독성·무광 (CP-09 → 2026-10-24 수정): 모자·코트 텍스처가 원래 어두워(텍셀 32%가 밝기 40 미만) 밤에 실루엣만 남음.
// CP-09의 시선 기준 윤곽광(0.32, 지수 2.6)이 모자 윗면·챙 전체에 푸른 띠를 만들어 코팅된 유광처럼 보였음(밝은 쪽 2% 밝기 77.7 → 끄면 27).
// 지금: 무광 재질(거칠기 0.95, 반사 0.25, 금속 0) + 위·앞에서 오는 확산 보조광(자기 색 비례, 반사 없음 = 천처럼) + 실루엣 끝에만 아주 약한 윤곽.
// 화면 노출·다른 소품은 그대로. 젖음(fx/wetness.js)은 이 값 위에서 조금만 매끈해짐.
export const CHAR_LOOK = {
  rimColor: new THREE.Color(0.55, 0.66, 1.0), rim: { value: 0.06 }, rimPow: { value: 5.0 },
  fill: { value: 0.16 }, key: { value: 0.85 }, fillColor: new THREE.Color(0.66, 0.75, 1.0),   // 확산 0.32·0.6·0.85 비교 → 0.85 (약한 불에서도 모자·코트 형태, evidence/CP-11/matte_fill_levels.png)
  roughness: 0.95, specularIntensity: 0.25,
};
function addReadability(m) {
  // 무광: 거칠기 지도는 거의 전부 0.70(179/255)이라 지우고 값으로. 금속도 지도(같은 텍스처, 파랑 0)도 지우고 금속 0 — 원본 GLB는 그대로
  m.roughnessMap = null; m.metalnessMap = null;
  m.metalness = 0; m.roughness = CHAR_LOOK.roughness;
  if ('specularIntensity' in m) m.specularIntensity = CHAR_LOOK.specularIntensity;
  if ('clearcoat' in m) m.clearcoat = 0;
  if ('sheen' in m) m.sheen = 0;
  const U = { uRimColor: { value: CHAR_LOOK.rimColor }, uRim: CHAR_LOOK.rim, uRimPow: CHAR_LOOK.rimPow, uFill: CHAR_LOOK.fill, uKey: CHAR_LOOK.key, uFillColor: { value: CHAR_LOOK.fillColor } };
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uRimColor, uFillColor;
uniform float uRim, uRimPow, uFill, uKey;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        vec3 n = normalize(normal);
        float facing = abs(dot(n, normalize(vViewPosition)));
        // 확산 보조광: 화면 위·앞(시선 공간 고정 방향)에서 오는 무광 빛 — 반사 없이 형태 명암만
        float keyL = max(0.0, dot(n, normalize(vec3(0.25, 0.85, 0.45))));
        totalEmissiveRadiance += diffuseColor.rgb * uFillColor * (uFill + uKey * keyL);
        totalEmissiveRadiance += uRimColor * uRim * pow(1.0 - facing, uRimPow);
      }`);
  };
  m.needsUpdate = true;
}

export async function loadCharacter(url, { walkSpeedRef = 0.85, clipTime = null } = {}) {   // clipTime(name, 상태 시간, 클립 길이) → 클립 안 시간 (U-20 앉기·일어나기 빠르게)
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = new THREE.Group();
  root.name = 'character_root';
  root.add(gltf.scene);
  let headBone = null;
  gltf.scene.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; o.material.shadowSide = THREE.FrontSide; for (const m of [o.material].flat()) if (m && m.isMeshStandardMaterial) addReadability(m); }
    if (o.isBone && /Head$/.test(o.name)) headBone = o;
  });
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const actions = Object.fromEntries(gltf.animations.map((c) => [c.name, mixer.clipAction(c)]));
  const hasWalk = !!actions.Walk;
  let cur = null, curName = null, lastId = -1;
  let lastPos = null;

  function resolve(name) {
    if (name === 'Walk' && !hasWalk) return 'Idle_Stand';       // 걷기 클립이 아직 없을 때 임시 (미끄러져 보임 — 기록에 남김)
    return actions[name] ? name : 'Idle_Stand';
  }

  const onceTime = (name, t, dur) => (clipTime ? clipTime(name, t, dur) : Math.min(t, dur));
  function play(name, t) {
    const next = actions[name];
    const fade = (LOCO.has(name) && LOCO.has(curName)) || name === 'Walk' || curName === 'Walk' ? 0.25 : 0.12;   // 걷기 자세에서 앉기로 넘어갈 때도 부드럽게
    next.enabled = true;
    next.reset();
    next.setEffectiveWeight(1);
    if (ONCE.has(name)) { next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = true; next.time = onceTime(name, t, next.getClip().duration); }
    else next.setLoop(THREE.LoopRepeat, Infinity);
    next.play();
    if (cur && cur !== next) cur.crossFadeTo(next, fade, false);
    cur = next; curName = name;
  }

  return {
    root, mixer, actions, headBone, hasWalk,
    get clip() { return curName; },
    /** 컨트롤러 상태를 반영. dt = 시뮬레이션 시간(일시 정지면 0) */
    update(dt, ctrl, { walkSpeed = walkSpeedRef } = {}) {
      root.position.set(ctrl.pos[0], 0, ctrl.pos[1]);
      root.rotation.y = ctrl.yaw;
      const name = resolve(ctrl.clip);
      if (ctrl.transitionId !== lastId || name !== curName) { play(name, ctrl.clipTime); lastId = ctrl.transitionId; }
      if (ONCE.has(name) && cur) cur.time = onceTime(name, ctrl.clipTime, cur.getClip().duration);   // 컨트롤러 시간과 어긋나지 않게 (재생 곡선 적용)
      // 걷기 재생 속도 = 실제 루트 이동 속도 / 클립 기준 속도 (출발 직후 크게 돌며 천천히 움직일 때 발이 미끄러지지 않게, D-01)
      if (name === 'Walk' && cur && dt > 0 && lastPos) {
        const v = Math.hypot(ctrl.pos[0] - lastPos[0], ctrl.pos[1] - lastPos[1]) / dt;
        const turning = ctrl.state === 'Aligning';
        const target = turning ? 0.45 : Math.min(1.2, Math.max(0.35, v / walkSpeedRef));   // 제자리 회전: 천천히 디딤
        cur.timeScale += (target - cur.timeScale) * Math.min(1, dt * 10);
      }
      lastPos = [ctrl.pos[0], ctrl.pos[1]];
      mixer.update(dt);
    },
  };
}
