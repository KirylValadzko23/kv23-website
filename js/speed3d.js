/* ==========================================================================
   KV23 — hero WebGL: a speed tunnel of light streaks + tail-light trails.
   Reads window.KV (scroll speed, boost) from main.js.
   ========================================================================== */
import * as THREE from 'three';

const canvas = document.getElementById('speedCanvas');
const KV = window.KV || { speed01: 0, boost: 0, mouse: { x: 0, y: 0 } };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const small = matchMedia('(max-width: 768px)').matches;

if (canvas) {
  try { init(); } catch (err) { console.warn('[KV23] WebGL unavailable, hero falls back to CSS.', err); }
}

function init() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 1.5 : 1.75));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x07060a, 30, 130);
  const camera = new THREE.PerspectiveCamera(68, 1, 0.1, 200);

  const FAR = -140;
  const rand = (a, b) => a + Math.random() * (b - a);

  /* --- streak lines ------------------------------------------------------ */
  const N = small ? 260 : 620;
  const pos = new Float32Array(N * 6);
  const col = new Float32Array(N * 6);
  const lines = [];
  const white = new THREE.Color(0xf4f1ec), red = new THREE.Color(0xff2d55), deep = new THREE.Color(0xb3001e);

  const spawn = (i, initial) => {
    const a = Math.random() * Math.PI * 2;
    const r = rand(3.2, 18);
    const isRed = Math.random() < 0.22;
    const c = isRed ? (Math.random() < 0.5 ? red : deep) : white;
    const k = isRed ? 1 : rand(0.25, 0.7);
    lines[i] = {
      x: Math.cos(a) * r,
      y: Math.sin(a) * r * 0.62,
      z: initial ? rand(FAR, 0) : FAR + rand(-10, 0),
      len: rand(0.6, 3.2),
      sf: rand(0.7, 1.4),
    };
    for (let v = 0; v < 2; v++) {
      const f = v === 0 ? k : k * 0.15; // tail fades out
      col.set([c.r * f, c.g * f, c.b * f], i * 6 + v * 3);
    }
  };
  for (let i = 0; i < N; i++) spawn(i, true);

  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  lineGeo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  scene.add(new THREE.LineSegments(lineGeo, lineMat));

  /* --- tail-light trails along the "track" floor ------------------------- */
  const T = small ? 24 : 46;
  const trailGeo = new THREE.PlaneGeometry(0.09, 1);
  trailGeo.rotateX(-Math.PI / 2);
  const trailMat = new THREE.MeshBasicMaterial({ color: 0xff1a3c, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const trails = new THREE.InstancedMesh(trailGeo, trailMat, T);
  const tData = [];
  const dummy = new THREE.Object3D();
  for (let i = 0; i < T; i++) {
    const lane = (Math.random() < 0.5 ? -1 : 1) * rand(1.4, 7);
    tData.push({ x: lane, y: rand(-3.4, -2.6), z: rand(FAR, 0), len: rand(3, 9), sf: rand(0.8, 1.3) });
  }
  scene.add(trails);

  /* --- floating dust ----------------------------------------------------- */
  const D = small ? 300 : 700;
  const dPos = new Float32Array(D * 3);
  for (let i = 0; i < D; i++) dPos.set([rand(-30, 30), rand(-16, 16), rand(FAR, 0)], i * 3);
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3).setUsage(THREE.DynamicDrawUsage));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xff6b84, size: 0.06, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(dust);

  /* --- sizing / visibility ----------------------------------------------- */
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();

  let visible = true;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(canvas);

  /* --- loop -------------------------------------------------------------- */
  let speed = 0.4, last = performance.now(), roll = 0;
  const frame = (now) => {
    const dt = Math.min((now - last) / 16.667, 3);
    last = now;

    const target = 0.4 + KV.speed01 * 3.2 + KV.boost * 5;
    speed += (target - speed) * 0.06;
    const step = speed * dt;
    const stretch = 1 + speed * 1.8;

    for (let i = 0; i < N; i++) {
      const l = lines[i];
      l.z += step * l.sf;
      if (l.z > 2) { spawn(i, false); continue; }
      const o = i * 6;
      pos[o] = l.x; pos[o + 1] = l.y; pos[o + 2] = l.z;
      pos[o + 3] = l.x; pos[o + 4] = l.y; pos[o + 5] = l.z - l.len * stretch;
    }
    lineGeo.attributes.position.needsUpdate = true;
    lineGeo.attributes.color.needsUpdate = true;

    for (let i = 0; i < T; i++) {
      const t = tData[i];
      t.z += step * t.sf * 1.15;
      if (t.z > 4) t.z = FAR;
      dummy.position.set(t.x, t.y, t.z);
      dummy.scale.set(1, 1, t.len * stretch);
      dummy.updateMatrix();
      trails.setMatrixAt(i, dummy.matrix);
    }
    trails.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < D; i++) {
      const o = i * 3 + 2;
      dPos[o] += step * 0.35;
      if (dPos[o] > 2) dPos[o] = FAR;
    }
    dustGeo.attributes.position.needsUpdate = true;

    // camera: look where the mouse steers, bank into it, widen FOV with speed
    roll += (-KV.mouse.x * 0.08 - roll) * 0.04;
    camera.rotation.z = roll;
    camera.rotation.y += (-KV.mouse.x * 0.1 - camera.rotation.y) * 0.04;
    camera.rotation.x += (-KV.mouse.y * 0.06 - camera.rotation.x) * 0.04;
    const fov = 68 + Math.min(speed, 6) * 3.2;
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }

    renderer.render(scene, camera);
  };

  if (reduced) { frame(performance.now()); return; }

  const loop = (now) => {
    if (visible && !document.hidden) frame(now);
    else last = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
