// 진입점: 장면·캐릭터·상호작용·효과·카메라·설정 패널(·편집 모드)을 조립한다.
// 상태: store(사용자 설정, 저장) · runtime(보간 중 실제 값: 불·비·오로라) · controller(캐릭터 상태·위치) · clock(시뮬레이션 시간, 일시 정지).
// 배치: web/config/layout.json(v2) 하나 — 장면·이동 영역·충돌체·통나무 클릭 영역·불 위치가 모두 applyLayout(L)에서 같이 바뀐다 (F12).
// 모드: 감상(view) · 촬영(photo) · 편집(edit, `?edit`, 동작 테스트 중에는 감상과 같은 입력). 입력은 모드마다 따로 처리.
import * as THREE from 'three';
import { createClock } from './logic/clock.js';
import { createStore } from './logic/store.js';
import { buildNavGrid } from './logic/navgrid.js';
import { createController } from './logic/controller.js';
import { createTapDetector } from './logic/input.js';
import { createQualityGovernor } from './logic/quality.js';
import { restFromLayout, obstaclesFromLayout, footprintsFromLayout, outlineFromLayout, logHitVolume } from './logic/layout.js';
import { parseLayout, REST } from './logic/layout_model.js';
import { checkLayout } from './logic/layout_check.js';
import { createRain as createRainState, createFireWeather, fireActual, createWetness } from './logic/weather.js';
import { createWetSurfaces } from './fx/wetness.js';
import { createFire, flicker, FIRE_QUALITY } from './fx/fire.js';
import { createSky } from './fx/sky.js';
import { createRain, markOccluder } from './fx/rain.js';
import { createPost, H_MM } from './render/post.js';
import { buildTempScene } from './scene/temp_scene.js';
import { loadProps, buildWorld, PROP_NAMES } from './scene/world.js';
import { createTerrain } from './logic/terrain.js';
import { loadCharacter, CHAR_LOOK } from './app/character.js';
import { createCameraRig } from './app/camera_rig.js';
import { createPanel } from './ui/panel.js';
import { createHud } from './ui/hud.js';
import { parsePresentation, defaultPresentation } from './logic/presentation_model.js';
import { createPresentation } from './present/presentation.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
// 로딩·실패 화면 (index.html의 __boot, PUB-03): 실제 단계만 표시, 첫 프레임을 그린 뒤 닫음. 원문 오류는 콘솔에만
const boot = window.__boot || { step() {}, fail(k, e) { console.error(e); }, done() {} };
const bootError = (kind, message, cause) => Object.assign(new Error(message), { kind, cause });
const Q = new URLSearchParams(location.search);
const DEBUG = Q.has('debug');
const EDIT = Q.has('edit');
const DEV = Q.has('dev');                 // 개발 모드: 에셋을 못 불러오면 임시 도형으로 대신 (표시와 함께, W-23)
const TIME_SCALE = Math.min(8, Math.max(0.1, +(Q.get('timescale') || 1)));   // 기록 영상용 (기본 1)
const toast = (() => { let t = 0; return (text, ms = 1800) => { const e = $('toast'); e.textContent = text; e.hidden = false; clearTimeout(t); t = setTimeout(() => { e.hidden = true; }, ms); }; })();
const QNAME = { high: '높음', medium: '중간', low: '낮음' };
const RES_SCALE = { high: 1, medium: 0.85, low: 0.7 };
const getJSON = async (url) => {
  let r;
  try { r = await fetch(url, { cache: 'no-store' }); } catch (e) { throw bootError('asset', `${url} 받기 실패`, e); }
  if (!r.ok) throw bootError('asset', `${url} ${r.status}`);
  return r.json();
};
/** WebGL을 만들 수 있는지 먼저 확인 (불가하면 품질을 낮춰도 해결되지 않으므로 바로 안내) */
function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

try {
  boot.step('설정을 읽는 중…');
  // ---------- 상태 ----------
  let storage = null;
  try { storage = window.localStorage; } catch { storage = null; }
  const store = createStore({ storage });
  const loaded = store.load();
  if (loaded.fixed.length || loaded.error || loaded.migrated) console.info('저장된 설정 일부를 기본값으로 복구', loaded);
  store.set('scene.rain.on', false, { save: false });       // 첫 화면: 비·오로라 OFF (저장값과 무관)
  store.set('scene.aurora.on', false, { save: false });
  const S = store.settings;
  const layoutRes = await fetch('config/layout.json', { cache: 'no-store' }).catch((e) => { throw bootError('asset', 'config/layout.json 받기 실패', e); });
  if (!layoutRes.ok) throw bootError('asset', `config/layout.json ${layoutRes.status}`);
  const parsed = parseLayout(await layoutRes.text());
  if (!parsed.ok) throw bootError('error', `배치 파일(web/config/layout.json)을 읽지 못했습니다: ${parsed.errors.join(' / ')}`);
  let L = parsed.layout;
  const clipInfo = await getJSON('config/ground_clips.json');
  const charInfo = await getJSON('config/character.json');
  const terrain = createTerrain(await getJSON('config/island_height.json'));   // 실제 섬 윗면 높이
  let firstView = null;
  try { firstView = await getJSON('config/first_view.json'); store.setCameraBase(firstView.camera); } catch { firstView = null; }   // 없으면 코드 기본 구도
  // 인트로 설정 (web/config/presentation.json). 없거나 못 읽으면 인트로 없이 바로 탐험 (오류는 콘솔에만)
  let presCfg = null;
  try {
    const r = parsePresentation(await (await fetch('config/presentation.json', { cache: 'no-store' })).text());
    if (r.ok) presCfg = r.value; else console.warn('인트로 설정을 읽지 못해 인트로 없이 시작', r.errors);
    if (r.warnings.length) console.info('인트로 설정: 일부 값을 기본값으로', r.warnings);
  } catch (e) { console.warn('인트로 설정을 받지 못해 인트로 없이 시작', e); }
  // 시작 시 인트로: 방문자 설정(설정 패널, 브라우저에 저장) > 파일 기본값(start.mode). ?intro=1 항상 / ?intro=0 건너뜀. 편집 모드는 자동 시작 안 함
  const INTRO_PREF_KEY = 'camping.intro.start.v1', INTRO_SEEN_KEY = 'camping.intro.seen.v1';
  const lsGet = (k) => { try { return storage?.getItem(k) ?? null; } catch { return null; } };
  const lsSet = (k, v) => { try { if (v === null) storage?.removeItem(k); else storage?.setItem(k, v); } catch { /* 사생활 모드 등 — 이번 방문만 */ } };
  const introStartMode = () => lsGet(INTRO_PREF_KEY) ?? presCfg?.start.mode ?? 'never';
  const introParam = Q.get('intro');
  const introAtStart = !!presCfg && !EDIT && (introParam === '1' || (introParam !== '0' && (introStartMode() === 'always' || (introStartMode() === 'first' && lsGet(INTRO_SEEN_KEY) !== '1'))));
  let rest = restFromLayout(L);
  let grid = buildNavGrid({ outline: outlineFromLayout(L), obstacles: obstaclesFromLayout(L) });
  const makeController = () => createController({ grid, rest, clips: { SitDown_Ground: clipInfo.clips.SitDown_Ground.seconds, StandUp_Ground: clipInfo.clips.StandUp_Ground.seconds }, speed: charInfo.walk_speed, initial: 'Seated' });
  let ctrl = makeController();
  const clock = createClock();
  const rainState = createRainState({ duration: S.scene.rain.duration });
  const fireW = createFireWeather();
  const wetness = createWetness();
  const runtime = { auroraLevel: 0, fireActual: 1 };
  const governor = createQualityGovernor({ start: 'high' });
  let quality = S.quality.mode === 'auto' ? governor.tier : S.quality.mode;

  // ---------- 렌더·장면 ----------
  if (!webglAvailable()) throw bootError('webgl', 'WebGL context를 만들 수 없음');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' }); } catch (e) { throw bootError('webgl', 'WebGLRenderer 생성 실패', e); }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(37.8, 1, 0.05, 400);
  const islandTop = (x, z) => ((x / (L.island.top_rx + 0.3)) ** 2 + (z / (L.island.top_rz + 0.3)) ** 2 <= 1 ? terrain.height(x, z) : null);
  store.startFromFirstView();                                 // 카메라는 첫 화면에서 시작 (브라우저에 남은 마지막 카메라 아님, W-20)
  const rig = createCameraRig(camera, store, { ground: islandTop });
  const post = createPost(renderer, { quality });
  scene.add(new THREE.HemisphereLight(0x6f82c8, 0x3a2a1e, 1.5));      // 차가운 환경광: 불이 약해도 캐릭터·경로가 보이게 (실제 에셋 텍스처가 임시보다 어두워 1.1 → 1.5)
  const rim = new THREE.DirectionalLight(0x8ea4ff, 1.25);                // 뒤쪽 위 윤곽광 (그림자 없음)
  rim.position.set(-3, 5, -4.5);
  scene.add(rim);
  // 최종 에셋(사용자 생성 Tripo 소품 + 재사용 기타). 못 불러온 것은 화면에 계속 표시 — 일반 실행은 임시 도형으로 대신하지 않음, ?dev만 대신 (W-23)
  const MODEL_COUNT = PROP_NAMES.length + 1;                          // 소품 + 캐릭터 (실제 받은 개수만 표시)
  let modelsDone = 0;
  const modelStep = () => boot.step(`3D 모델을 받는 중… ${modelsDone}/${MODEL_COUNT}`);
  modelStep();
  const characterP = loadCharacter('assets/character.glb', { walkSpeedRef: charInfo.walk_speed })
    .then((c) => { modelsDone++; modelStep(); return c; }, (e) => { throw bootError('asset', 'assets/character.glb 받기 실패', e); });
  characterP.catch(() => {});                                          // 소품을 기다리는 동안 처리 안 된 거부 경고 방지 (아래 await에서 처리)
  const { props, failed } = await loadProps(undefined, { onLoaded: () => { modelsDone++; modelStep(); } });
  let worldApi, usingProps = true;
  const warnEl = $('assetWarn');
  if (failed.length && DEV) {
    const g = buildTempScene(L);
    worldApi = { group: g, units: new Map(), apply() {}, unitOf: () => null };
    usingProps = false;
    warnEl.textContent = `개발 모드: 임시 도형 표시 중 — 불러오지 못한 에셋 ${failed.map((f) => f.name).join(', ')}`;
    warnEl.hidden = false;
  } else {
    worldApi = buildWorld(props, L, terrain);
    if (failed.length) {
      warnEl.textContent = `일부 물체를 불러오지 못해 보이지 않아요 (${failed.map((f) => f.name.replace('.glb', '')).join(', ')}) — 새로고침하면 다시 받아요`;
      warnEl.hidden = false;
      console.error('에셋 불러오기 실패', failed);
    }
  }
  const world = worldApi.group;
  scene.add(world);
  const firePos = new THREE.Vector3();
  const fire = createFire({ position: firePos, quality });
  scene.add(fire.group);
  const sky = createSky({ quality });
  scene.add(sky.group);
  const rain = createRain({ quality });
  scene.add(rain.group);
  let hv = logHitVolume(L);
  const logHit = new THREE.Mesh(new THREE.CylinderGeometry(hv.radius, hv.radius, hv.length, 16).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ visible: false }));
  logHit.name = 'log_hit';
  scene.add(logHit);
  const groundHit = world.getObjectByName('island_mesh') || world.getObjectByName('temp_island_top');
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: 0, depthWrite: false }));
  scene.add(marker);
  let markerT = 0;
  const character = await characterP;
  boot.step('첫 화면을 그리는 중…');
  scene.add(character.root);
  markOccluder(character.root, 1);
  character.root.name = 'character_root';
  const wetLook = createWetSurfaces([world, character.root], rain);   // 재질별 젖음 + 가림 (모자 챙 아래·텐트 안·통나무 아랫면·텐트 아래 흙은 덜 젖음)

  // 카메라 충돌 높이 (발자국 위로 이 높이까지는 카메라가 못 들어감)
  const COLL_H = { tent: 1.3, log: 0.42, guitar_case: 0.66, guitar: 0.62, fire: 0.6 };
  /** 배치 반영: 소품·불(불꽃·광원·불티·연기)·통나무 클릭 영역·카메라 충돌체. final이면 이동 영역도 다시 (드래그 중에는 보이는 것만) */
  function applyLayout(L2, { final = true } = {}) {
    L = L2;
    worldApi.apply(L);
    rest = restFromLayout(L);
    firePos.set(L.fire.center[0], terrain.height(L.fire.center[0], L.fire.center[2]) + (L.fire.dy ?? 0), L.fire.center[2]);
    fire.group.position.copy(firePos);
    hv = logHitVolume(L);
    const lp = worldApi.pivotOf?.('rest');
    if (lp) { lp.updateWorldMatrix(true, false); lp.matrixWorld.decompose(logHit.position, logHit.quaternion, new THREE.Vector3()); }   // 통나무 실제 기울기·높이 그대로 (원통 축 = 통나무 로컬 X)
    else { logHit.position.set(hv.center[0], terrain.height(...rest.approach) + rest.dy + REST.logRadius, hv.center[2]); logHit.rotation.set(0, hv.yaw, 0); }
    rig.setColliders(footprintsFromLayout(L).map((o) => ({ ...o, h: (COLL_H[o.id] ?? (o.r ? o.r * 1.3 : 0.5)) * (o.id === 'tent' ? (L.tent.scale ?? 1) : 1) })));
    if (final) grid = buildNavGrid({ outline: outlineFromLayout(L), obstacles: obstaclesFromLayout(L) });
  }
  applyLayout(L);
  const check = (L2) => checkLayout(L2, { terrain });

  function applyQuality(q) {
    quality = q;
    fire.setQuality(q); sky.setQuality(q); rain.setQuality(q); post.setQuality(q);
    resize();
  }
  function resize() {
    const pr = Math.min(devicePixelRatio, 2) * RES_SCALE[quality];
    renderer.setPixelRatio(pr);
    renderer.setSize(stage.clientWidth, stage.clientHeight, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = stage.clientWidth / Math.max(1, stage.clientHeight);
    camera.updateProjectionMatrix();
    const hPx = stage.clientHeight * pr;
    post.setSize(stage.clientWidth * pr, hPx);
    const pxScale = hPx / (2 * Math.tan((camera.fov * Math.PI) / 360));
    fire.setPixelScale(pxScale);
    rain.setPixelScale(pxScale);
    sky.setPixelRatio(pr);
  }
  addEventListener('resize', resize);
  resize();

  // ---------- 편집 모드 (?edit) ----------
  let editor = null;
  let testing = false;
  // 편집 중 캐릭터 = 휴식 자리에 앉은 미리보기 (컨트롤러 대신 읽기 전용 값, 클릭 명령 없음)
  const preview = { state: 'Seated', clip: 'Idle_LeanLog', clipTime: 0, transitionId: -7, get pos() { return rest.approach; }, get yaw() { return rest.yaw; } };
  if (EDIT) {
    const { createEditor } = await import('./edit/editor.js');
    editor = createEditor($('editRoot'), L, {
      scene, camera, canvas: renderer.domElement, terrain, world: worldApi, characterRoot: character.root, store, rig, toast, firstView,
      presentation: () => presentation, presentationConfig: presCfg,   // 인트로 편집 탭 (인트로 런타임은 아래에서 만듦)
      applyLayout, check,
      startTest(L2) { applyLayout(L2, { final: true }); ctrl = makeController(); testing = true; markerT = 0; return true; },   // 새 배치·착석 상태에서 시작 (이전 목표·대기 요청 없음)
      stopTest() { ctrl = makeController(); testing = false; },
    });
  }
  let presentation = null;                 // 아래에서 만듦 (인트로 중에는 'present' — 캐릭터·카메라·촬영 입력 없음)
  const mode = () => (presentation?.blocking ? 'present' : store.photo.active ? 'photo' : editor && !testing ? 'edit' : 'view');
  const charCtrl = () => (editor && !testing ? preview : ctrl);

  // ---------- 입력 ----------
  // 감상: 왼쪽 클릭 = 이동·쉬기, 왼쪽/오른쪽 드래그 = 회전, 휠 버튼 드래그 = 평행 이동, 휠 = 거리
  // 촬영: 왼쪽 클릭 = 초점(화면 클릭 초점일 때), 나머지 같음 · 편집: 왼쪽 = 선택·물체 이동/회전 고리(빈 곳 드래그는 무동작), 오른쪽 = 회전
  // 터치(감상·촬영): 탭 = 이동·쉬기/초점, 한 손가락 = 회전, 두 손가락 이동 = 평행 이동, 핀치 = 거리
  const canvas = renderer.domElement;
  const taps = createTapDetector();
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const ptrs = new Map();                 // pointerId → { kind, x, y }
  let gesture = null;                     // 두 손가락: { mid:[x,y], dist }
  const aim = (x, y) => { const r = canvas.getBoundingClientRect(); ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); };
  function pick(x, y) {
    aim(x, y);
    if (ray.intersectObject(logHit, false).length) return { type: 'log' };
    const g = groundHit && ray.intersectObject(groundHit, false)[0];
    if (g) return { type: 'ground', point: [g.point.x, g.point.z] };
    const t = -ray.ray.origin.y / ray.ray.direction.y;                 // 섬 밖: y=0 평면 점 → 컨트롤러가 'outside-island'로 거부
    if (t > 0) { const p = ray.ray.at(t, new THREE.Vector3()); return { type: 'ground', point: [p.x, p.z] }; }
    return null;
  }
  const REASON = { 'outside-island': '섬 밖은 갈 수 없어요', 'not-walkable': '그곳은 갈 수 없어요', 'no-path': '가는 길이 없어요', 'start-blocked': '지금은 움직일 수 없어요' };
  function onTap(x, y) {
    if (store.photo.active) {                                           // 촬영 모드: 이동 대신 초점 선택 (화면 클릭 초점일 때)
      if (S.camera.focus.mode !== 'point') return;
      aim(x, y);
      const hit = ray.intersectObjects([world, character.root, fire.group], true).find((h) => h.object.visible !== false && h.object.isMesh);
      if (hit) { store.set('camera.focus.point', hit.point.toArray()); toast('초점을 맞췄어요'); }
      return;
    }
    if (mode() !== 'view') return;
    const req = pick(x, y);
    if (!req) return;
    const r = ctrl.request(req);
    if (!r.accepted) { if (REASON[r.reason]) toast(REASON[r.reason]); return; }
    if (req.type === 'ground') { const goal = ctrl.path && ctrl.path.length ? ctrl.path[ctrl.path.length - 1] : req.point; marker.position.set(goal[0], terrain.height(goal[0], goal[1]) + 0.012, goal[1]); markerT = 1.2; }
  }
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());                       // 오른쪽 드래그 = 회전 (메뉴 없음)
  canvas.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });   // 휠 버튼 자동 스크롤 막기
  canvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
  const touches = () => [...ptrs.values()].filter((p) => p.kind === 'touch');
  function twoFinger() { const [a, b] = touches(); return { mid: [(a.x + b.x) / 2, (a.y + b.y) / 2], dist: Math.hypot(a.x - b.x, a.y - b.y) }; }
  canvas.addEventListener('pointerdown', (e) => {
    const touch = e.pointerType === 'touch';
    if (!touch && e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    if (e.button === 1) e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* 이미 떼어진 포인터 등 — 캡처 없이 계속 */ }
    let kind;
    if (!touch && e.button === 1) kind = 'pan';
    else if (!touch && e.button === 2) kind = 'rotate';
    else if (touch) kind = 'touch';
    else if (mode() === 'edit') kind = editor.pointerDown(e.clientX, e.clientY) ? 'edit' : 'editEmpty';
    else kind = 'left';
    ptrs.set(e.pointerId, { kind, x: e.clientX, y: e.clientY });
    if (kind === 'left' || kind === 'touch' || kind === 'editEmpty') taps.down(e.pointerId, e.clientX, e.clientY, e.timeStamp);
    if (kind === 'touch' && touches().length >= 2) gesture = twoFinger();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) { hover(e.clientX, e.clientY); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    const h = canvas.clientHeight;
    switch (p.kind) {
      case 'pan': rig.panBy(dx, dy, h); break;
      case 'rotate': rig.rotateBy(dx, dy, h); break;
      case 'edit': editor.pointerMove(e.clientX, e.clientY, e); break;
      case 'editEmpty': taps.move(e.pointerId, e.clientX, e.clientY); break;      // 편집 중 빈 곳 왼쪽 드래그 = 아무것도 안 함
      case 'left': if (taps.move(e.pointerId, e.clientX, e.clientY) === 'drag') rig.rotateBy(dx, dy, h); break;
      case 'touch': {
        const mv = taps.move(e.pointerId, e.clientX, e.clientY);
        if (touches().length >= 2) {
          const g = twoFinger();
          if (gesture) {
            rig.panBy(g.mid[0] - gesture.mid[0], g.mid[1] - gesture.mid[1], h);      // 두 손가락 이동 = 평행 이동
            if (gesture.dist > 0 && g.dist > 0) rig.zoomBy(gesture.dist / g.dist);   // 핀치 = 거리
          }
          gesture = g;
        } else if (mv === 'drag') rig.rotateBy(dx, dy, h);                            // 한 손가락 = 회전
        break;
      }
      default:
    }
  });
  const end = (e, cancelled) => {
    const p = ptrs.get(e.pointerId);
    ptrs.delete(e.pointerId);
    if (!p) return;
    const tapKind = p.kind === 'left' || p.kind === 'touch' || p.kind === 'editEmpty';
    const tap = tapKind && !cancelled ? taps.up(e.pointerId, e.clientX, e.clientY, e.timeStamp) : (taps.cancel(e.pointerId), null);
    if (p.kind === 'edit') { if (cancelled) editor.cancelDrag(); else editor.pointerUp(); }
    if (p.kind === 'touch' && touches().length < 2) gesture = null;
    rig.commit();
    if (!tap) return;
    if (p.kind === 'editEmpty') { if (mode() === 'edit') editor.tap(tap.x, tap.y); }
    else onTap(tap.x, tap.y);
  };
  canvas.addEventListener('pointerup', (e) => end(e, false));
  canvas.addEventListener('pointercancel', (e) => end(e, true));
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); rig.zoomBy(Math.exp(e.deltaY * 0.0012)); clearTimeout(canvas._wt); canvas._wt = setTimeout(() => rig.commit(), 300); }, { passive: false });

  // "쉬기" 표시: PC는 통나무 위에 포인터가 있을 때, 모바일은 서 있는 캐릭터가 접근 위치 0.6H 안일 때
  const restLabel = $('restLabel');
  let hoverLog = false;
  function hover(x, y) {
    aim(x, y);
    hoverLog = mode() === 'view' && ray.intersectObject(logHit, false).length > 0;
    canvas.style.cursor = hoverLog && ctrl.state !== 'Seated' ? 'pointer' : 'default';
  }
  const coarse = matchMedia('(pointer: coarse)').matches;
  function updateRestLabel() {
    const standing = ctrl.state === 'Standing' || ctrl.state === 'Walking';
    const near = Math.hypot(ctrl.pos[0] - rest.approach[0], ctrl.pos[1] - rest.approach[1]) < 0.6;
    const show = mode() === 'view' && standing && (coarse ? near : hoverLog);
    restLabel.hidden = !show;
    if (show) {
      const p = new THREE.Vector3(hv.center[0], logHit.position.y + 0.45, hv.center[2]).project(camera);
      restLabel.style.left = `${((p.x + 1) / 2) * canvas.clientWidth}px`;
      restLabel.style.top = `${((1 - p.y) / 2) * canvas.clientHeight}px`;
    }
  }

  // ---------- 설정 ↔ 실행 상태 ----------
  function applyEffectsOff() {
    const off = S.quality.effectsOff;
    fire.light.castShadow = !off.shadows && FIRE_QUALITY[quality].shadow > 0;
    rain.setSplashes(!off.splashes);
  }
  store.subscribe((e) => {
    if (e.type === 'set' && e.path === 'scene.rain.on') rainState.setOn(S.scene.rain.on);
    if (e.type === 'set' && e.path === 'scene.rain.duration') rainState.setDuration(S.scene.rain.duration);
    if (e.type === 'set' && e.path === 'quality.mode') { if (S.quality.mode === 'auto') governor.reset(quality); else applyQuality(S.quality.mode); }
    if (e.type === 'set' && e.path && e.path.startsWith('quality.effectsOff')) applyEffectsOff();
    if (e.type === 'preset' && e.changes.includes('scene')) { rainState.setDuration(S.scene.rain.duration); rainState.setOn(S.scene.rain.on); }
    if (e.type === 'reset' && (e.scope === 'all' || e.scope === 'envScreen')) { rainState.setDuration(S.scene.rain.duration); rainState.setOn(false); }
    if (e.type === 'reset' && e.scope === 'all') {                       // 타이머·남은 입자·캐릭터·시계까지 모순 없이 처음으로
      rainState.reset(); fireW.reset(); wetness.reset(); wetLook.reset(); runtime.auroraLevel = 0; fire.clearParticles(); ctrl.reset(); clock.reset(); clock.setPaused(false);
      if (S.quality.mode !== 'auto') applyQuality(S.quality.mode); else { governor.reset('high'); applyQuality('high'); }
      applyEffectsOff();
    }
    if (e.type === 'preset' && e.id === 'portrait') framePortrait();
    if (e.type === 'reset' || e.type === 'preset' || e.type === 'slot' || e.type === 'photo') rig.snap?.();
    if (e.type === 'pause') clock.setPaused(e.paused);
    if (e.type === 'photo' && !e.active) clock.setPaused(false);
  });
  applyEffectsOff();

  // "모닥불 곁 인물 촬영" 프리셋: 고정 좌표 대신 실제 캐릭터·불 위치로 구도 (1차: 배치를 옮긴 뒤 예전 좌표를 보고 있어 인물이 화면 끝에서 흐려짐)
  function framePortrait() {
    const hx = rest.approach[0], hz = rest.approach[1];
    const tgt = [(hx * 0.6 + firePos.x * 0.4), 0.32 + firePos.y * 0.5, (hz * 0.6 + firePos.z * 0.4)];
    const face = Math.atan2(Math.sin(rest.yaw), Math.cos(rest.yaw));      // 캐릭터가 바라보는 방향 = 불 쪽
    const az = ((face + (38 * Math.PI) / 180) * 180) / Math.PI;           // 인물 정면에서 38° 옆 (3/4)
    store.set('camera.target', tgt, { save: false });
    store.set('camera.azimuth', ((az + 540) % 360) - 180, { save: false });
    store.set('camera.distance', 3.2, { save: false });
    store.set('camera.elevation', 14);
  }

  // ---------- 그리기 ----------
  /** 초점 거리. modeOverride: 인트로 섹션 심도의 초점('character' | 'fire' | 'target') */
  function focusDistance(modeOverride) {
    const f = modeOverride ? { mode: modeOverride } : S.camera.focus;
    if (f.mode === 'manual') return (f.distanceM * 1000) / H_MM;           // 가상 m → H
    if (f.mode === 'target') return Math.max(0.05, camera.position.distanceTo(rig.current.target));
    const p = f.mode === 'fire' ? new THREE.Vector3(firePos.x, firePos.y + 0.3, firePos.z)
      : f.mode === 'point' ? new THREE.Vector3(...f.point)
        : character.headBone ? character.headBone.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(rest.approach[0], 0.5, rest.approach[1]);
    // 심도 셰이더는 시선 방향 깊이(view z)로 비교 → 초점도 같은 깊이로 (1차: 직선 거리라 화면 가장자리 인물이 약 3% 어긋나 흐려짐)
    return Math.max(0.05, -p.applyMatrix4(camera.matrixWorldInverse).z);
  }
  function draw(t) {
    if (rain.group.visible || wetLook.hasWet(wetness.values)) rain.renderOcclusion(renderer, scene);   // 그친 뒤에도 마를 때까지 (움직인 캐릭터·옮긴 소품 기준)
    // 인트로: 섹션 카메라의 심도(있으면)·블룸 조절·전시 필터와 빗물 씻김. 탐험에서는 present가 null → 필터 단계 없음
    const pdof = presentation?.dof();
    const dof = pdof && !S.quality.effectsOff.dof ? { on: true, focus: focusDistance(pdof.focus), fstop: pdof.fstop, maxBlur: pdof.maxBlur }
      : presentation?.blocking ? null
        : S.camera.dof.on && !S.quality.effectsOff.dof ? { on: true, focus: focusDistance(), fstop: S.camera.dof.fstop, maxBlur: S.camera.dof.maxBlur } : null;
    const present = presentation?.renderState() ?? null;
    const screen = present ? presentation.screen(S.screen) : S.screen;
    post.render(scene, camera, { dof, screen, time: t, ao: !S.quality.effectsOff.ao, present });
  }
  async function savePNG() {
    editor?.setHelpersHidden(true);                                      // 편집 표시·선택 강조는 PNG에서 뺌 (DOM UI는 캔버스 밖이라 원래 제외)
    draw(clock.time);                                                    // 후처리까지 끝난 프레임을 그린 직후 같은 작업 안에서 읽음
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    editor?.setHelpersHidden(false);
    if (!blob || blob.size < 1000) { toast('저장하지 못했어요 (빈 화면)'); return null; }
    const a = document.createElement('a');
    const d = new Date();
    a.download = `camping_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}.png`;
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`PNG 저장 ${canvas.width}×${canvas.height} · ${a.download}`, 3000);
    window.__camp.lastPNG = { name: a.download, width: canvas.width, height: canvas.height, bytes: blob.size };
    return blob;
  }
  // 모바일 아래 시트가 화면 아래를 덮으면 장면 중심을 시트 높이의 절반만큼 위로 (투영 중심 이동 — 광선·라벨 투영도 같이 맞음)
  // PC에서 오른쪽 설정 패널을 열면 장면 중심을 왼쪽으로, 편집 패널(왼쪽)이 있으면 오른쪽으로 (CP-06·CP-08)
  let lastInset = '';
  function fitToSheet() {
    const p = document.querySelector('#ui .panel');
    const hidden = document.body.classList.contains('ui-hidden') || !!presentation?.active;   // 인트로·인트로 미리보기: 실제 인트로와 같은 구도(중심 이동 없음)
    const mobile = innerWidth < 700;
    const insetY = mobile && p && !hidden ? Math.round(p.offsetHeight / 2) : 0;
    const open = document.getElementById('ui').classList.contains('open');
    const ep = document.querySelector('.edit-panel');
    const insetX = (!mobile && open && p && !hidden ? Math.round((p.offsetWidth + 16) / 2) : 0) - (!mobile && ep && !hidden ? Math.round((ep.offsetWidth + 12) / 2) : 0);
    const key = `${insetX},${insetY},${stage.clientWidth},${stage.clientHeight}`;
    if (key === lastInset) return;
    lastInset = key;
    const w = stage.clientWidth, h = stage.clientHeight;
    if (insetX || insetY) camera.setViewOffset(w, h, insetX, insetY, w, h); else camera.clearViewOffset();
  }
  function setUIHidden(v) {
    const was = document.body.classList.contains('ui-hidden');
    document.body.classList.toggle('ui-hidden', v);
    if (v && !was) $('uiHint').focus({ preventScroll: true });          // 숨긴 버튼에 남은 키보드 포커스 → 되돌리기 버튼으로
  }
  addEventListener('keydown', (e) => { if (e.key === 'Escape') setUIHidden(false); });
  $('uiHint').addEventListener('click', () => setUIHidden(false));

  const panel = createPanel($('ui'), store, {
    toast, savePNG, setUIHidden,
    rainStatus() {
      if (rainState.phase === 'off') return '비 없음';
      const rem = rainState.remaining;
      const ph = { fadingIn: '내리기 시작', raining: '내리는 중', fadingOut: '그치는 중' }[rainState.phase];
      return `${ph}${rainState.on ? (rem === null ? ' · 연속' : ` · ${Math.ceil(rem)}초 남음`) : ''} · 불 ${Math.round(fireW.weather * 100)}%`;
    },
    qualityStatus() {
      const off = Object.entries(S.quality.effectsOff).filter(([, v]) => v).map(([k]) => k);
      return `적용 품질: ${QNAME[quality]}${S.quality.mode === 'auto' ? ' (자동)' : ''}${off.length ? ` · 사용 안 함 효과 ${off.length}개` : ''}`;
    },
  });
  setInterval(() => panel.refresh(), 500);
  const hud = createHud($('ui'), store, { savePNG, setUIHidden, storage, autoHelp: !EDIT && !introAtStart, replayIntro: presCfg && !EDIT ? () => replayIntro() : null });

  // ---------- 인트로 (Presentation Mode) ----------
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  if (presCfg || EDIT) {                                                 // 편집 모드는 파일이 없어도 새로 만들 수 있게
    presentation = createPresentation($('present'), presCfg ?? defaultPresentation(), {
      rig,
      isPortrait: () => innerWidth / Math.max(1, innerHeight) < 0.8,
      reducedMotion: () => reducedMotion.matches,
      onEscape: () => !!editor?.introEscape(),                           // 편집기에서 재생 중이면 Esc = 편집으로
      // 인트로로 들어올 때: 촬영 모드·UI 숨김·도움말·설정 패널을 정리 (날씨·오로라·불·화면 설정은 그대로)
      onPresent() {
        if (store.photo.active) store.exitPhoto();
        setUIHidden(false);
        hud.closeHelp?.();
        panel.setOpen(false);
        document.body.classList.remove('explore-enter');
      },
      // 탐험으로: 마지막 인트로 카메라를 감상 카메라로 넘김(저장하지 않음) → HUD가 부드럽게 나타남
      onExplore(cam) {
        if (editor) { editor.introPlayDone?.(); return; }          // 편집기에서 재생한 경우: 편집기로 돌아감
        for (const k of ['azimuth', 'elevation', 'distance', 'lens', 'target']) store.set(`camera.${k}`, cam[k], { save: false });
        lsSet(INTRO_SEEN_KEY, '1');
        document.body.classList.add('explore-enter');
        setTimeout(() => document.body.classList.remove('explore-enter'), 900);
        hud.maybeAutoHelp?.();
      },
    });
    if (introAtStart) presentation.start(0, { instant: true });   // 첫 프레임부터 인트로 첫 장 구도
  }
  function replayIntro() { presentation?.start(0); }
  panel.setIntroHooks?.({
    get mode() { return lsGet(INTRO_PREF_KEY); },
    fileDefault: presCfg?.start.mode ?? 'never',
    set(v) { lsSet(INTRO_PREF_KEY, v); },
    replay: presCfg && !EDIT ? replayIntro : null,
  });

  // ---------- 루프 ----------
  let last = performance.now();
  let lastFov = camera.fov;
  let shown = false;
  function frame(now) {
    const realMs = now - last;
    last = now;
    step(realMs);
    if (!shown) { shown = true; boot.done(); }                           // 첫 프레임을 그린 뒤에 로딩 화면을 닫음
    requestAnimationFrame(frame);
  }
  /** 한 프레임 진행 (rAF 또는 검사용 advance) */
  function step(realMs, render = true) {
    const realDt = Math.min(0.1, realMs / 1000);
    if (S.quality.mode === 'auto' && !document.hidden) { const q = governor.push(realMs, performance.now() / 1000); if (q) applyQuality(q); }
    const dt = clock.tick(realDt * TIME_SCALE);
    const t = clock.time;
    const wasOn = rainState.on;
    rainState.update(dt);
    if (wasOn && !rainState.on && S.scene.rain.on) store.set('scene.rain.on', false);     // 시간이 다 되어 저절로 그침 → 버튼 상태도
    fireW.update(dt, rainState.level);
    wetness.update(dt, rainState.level, S.scene.rain.intensity);
    wetLook.apply(wetness.values);
    const auroraTarget = S.scene.aurora.on ? 1 : 0;
    runtime.auroraLevel += Math.sign(auroraTarget - runtime.auroraLevel) * Math.min(Math.abs(auroraTarget - runtime.auroraLevel), dt / 5);   // 5초 페이드
    runtime.fireActual = fireActual(S.scene.fire.base, fireW.weather, flicker(t, S.scene.fire.flicker / 0.3));
    if (!editor || testing) ctrl.update(dt);
    const cc = charCtrl();
    character.update(dt, cc, { walkSpeed: charInfo.walk_speed });
    // 섬 윗면 높이 + 휴식 자리 높이 보정(접근 위치 가까이에서만 — 통나무와 같은 기준)
    const nearRest = Math.max(0, 1 - Math.hypot(cc.pos[0] - rest.approach[0], cc.pos[1] - rest.approach[1]) / 0.3);
    character.root.position.y = terrain.height(cc.pos[0], cc.pos[1]) + rest.dy * nearRest;
    const wind = new THREE.Vector2(0.6, 0.2).multiplyScalar(S.scene.wind);
    fire.update(dt, t, runtime.fireActual, { wind, sparks: S.scene.fire.sparks, smoke: S.scene.fire.smoke, smokeBoost: rainState.level * 0.6, sparksOff: S.quality.effectsOff.sparks, smokeOff: S.quality.effectsOff.smoke });
    const link = S.scene.weatherLink ? rainState.level : 0;               // 날씨와 하늘 연동: 비가 오면 별·오로라가 가려짐 (선택값은 그대로)
    sky.update(t, { starIntensity: S.scene.stars.intensity * (1 - 0.7 * link), twinkle: S.scene.stars.twinkle, auroraLevel: S.quality.effectsOff.aurora ? 0 : runtime.auroraLevel * (1 - 0.85 * link), auroraIntensity: S.scene.aurora.intensity, auroraSpeed: S.scene.aurora.speed });
    rain.update(t, { level: rainState.level, intensity: S.scene.rain.intensity, wind, fire: { pos: new THREE.Vector3(firePos.x, firePos.y + 0.3, firePos.z), actual: runtime.fireActual } });
    presentation?.update(realDt);                                         // 인트로 카메라(덮어쓰기)·필터·씻김 진행
    rig.update(realDt);
    if (camera.fov !== lastFov) { lastFov = camera.fov; resize(); }          // 렌즈(화각)가 바뀌면 불티·빗방울 점 크기 기준도 다시
    fitToSheet();
    sky.group.position.copy(camera.position);
    if (markerT > 0) { markerT -= realDt; marker.material.opacity = Math.max(0, Math.min(1, markerT)) * 0.8; }
    updateRestLabel();
    editor?.update();
    if (render) draw(t);
    if (!window.__camp.firstFrameMs) window.__camp.firstFrameMs = Math.round(performance.now());   // 탐색 시작 → 첫 프레임 (로딩 시간)
    if (DEBUG) $('debug').textContent = `${mode()} · ${cc.state} ${character.clip} · pending ${ctrl.pending ? ctrl.pending.type : '-'} · 불 ${runtime.fireActual.toFixed(2)} · 비 ${rainState.phase} · ${QNAME[quality]} · ${(realMs).toFixed(1)}ms`;
  }
  window.__camp = { THREE, renderer, scene, camera, store, character, rig, rainState, fireW, runtime, clock, post, fire, sky, rain, panel, hud, presentation, governor, editor, firePos, logHit,
    get ctrl() { return ctrl; }, get grid() { return grid; }, get rest() { return rest; }, get L() { return L; }, get mode() { return mode(); }, get testing() { return testing; },
    get quality() { return quality; }, CHAR_LOOK, pick, onTap, draw, savePNG, terrain, world, worldApi, usingProps, failed, wetness, wetLook, applyLayout, check,
    tapAt(x, y) { const req = pick(x, y); return req ? ctrl.request(req) : null; },
    /** 검사용: 탭이 뒤에 있어 rAF가 멈춰도 프레임을 직접 진행 (seconds 동안 fps 간격) */
    advance(seconds, fps = 60, render = true) { const n = Math.max(1, Math.round(seconds * fps)); for (let i = 0; i < n; i++) step(1000 / fps, render || i === n - 1); } };
  requestAnimationFrame(frame);
  $('debug').hidden = !DEBUG;
  if (!character.hasWalk) console.info('걷기 클립 없음 — 임시로 Idle_Stand 사용');
} catch (err) {
  if (err.cause) console.error('원인', err.cause);
  boot.fail(err.kind || 'error', err);                                 // 화면엔 쉬운 설명·다시 시도, 원문은 콘솔
}
