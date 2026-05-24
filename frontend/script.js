'use strict';
/* =================================================================
   PRECRASH AI — V2V Digital Twin Simulation Engine
   10 cars · 4 lanes · Random Forest risk prediction · Three.js
   ================================================================= */

// ─── CONFIG ──────────────────────────────────────────────────────
const API       = 'http://127.0.0.1:5000';
const NUM_CARS  = 10;
const LANE_XS   = [-7.5, -2.5, 2.5, 7.5];   // x-position of each lane
const ROAD_LEN  = 700;

/* Car → lane assignment: [L0,L0,L0, L1,L1,L1, L2,L2, L3,L3] */
const CAR_LANES = [0, 0, 0, 1, 1, 1, 2, 2, 3, 3];

/* Distinct palette per car */
const CAR_HEX   = [
  0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12,
  0x9b59b6, 0x1abc9c, 0xe67e22, 0x00bcd4,
  0xff5722, 0x607d8b
];

// ─── RUNTIME STATE ───────────────────────────────────────────────
let weatherMode  = 0;
let cameraMode   = 'overview';
let simSpeed     = 1.0;
let soundEnabled = true;
let labelsOn     = true;
let backendUp    = false;
let totalAlerts  = 0;
let totalPreds   = 0;
let v2vMsgs      = [];
let lastAlert    = 0;
let audioCtx     = null;
let rainSys      = null;
let riskChart    = null;
let featChart    = null;

// ─── THREE.JS SETUP ──────────────────────────────────────────────
const scene    = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
renderer.toneMapping          = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure  = 0.85;
document.getElementById('canvas-container').appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1500);
camera.position.set(0, 55, 90);
let camLook = new THREE.Vector3(0, 0, -20);
camera.lookAt(camLook);

// ─── LIGHTING ────────────────────────────────────────────────────
const ambLight = new THREE.AmbientLight(0x2a3d5a, 0.75);
scene.add(ambLight);

const sun = new THREE.DirectionalLight(0xfff0cc, 1.0);
sun.position.set(25, 70, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left   = -120;
sun.shadow.camera.right  =  120;
sun.shadow.camera.top    =  120;
sun.shadow.camera.bottom = -120;
sun.shadow.camera.far    =  500;
scene.add(sun);

const hemi = new THREE.HemisphereLight(0x1a2d44, 0x001122, 0.45);
scene.add(hemi);

// ─── ROAD ────────────────────────────────────────────────────────
function buildRoad() {
  const g = new THREE.Group();

  /* Asphalt base */
  const asph = new THREE.Mesh(
    new THREE.PlaneGeometry(22, ROAD_LEN),
    new THREE.MeshLambertMaterial({ color: 0x1a1a22 })
  );
  asph.rotation.x = -Math.PI / 2;
  asph.position.set(0, 0, -(ROAD_LEN / 2) + 120);
  asph.receiveShadow = true;
  g.add(asph);

  /* Shoulders */
  [-12, 12].forEach(x => {
    const sh = new THREE.Mesh(
      new THREE.PlaneGeometry(3, ROAD_LEN),
      new THREE.MeshLambertMaterial({ color: 0x22232e })
    );
    sh.rotation.x = -Math.PI / 2;
    sh.position.set(x, 0.001, -(ROAD_LEN / 2) + 120);
    g.add(sh);
  });

  /* White dashed lane dividers (at x = -5, 0, 5) */
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  [-5, 0, 5].forEach(x => {
    for (let z = -(ROAD_LEN) + 120; z < 160; z += 10) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 5.5), dashMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(x, 0.015, z);
      g.add(dash);
    }
  });

  /* Yellow centre-median (x = 0 thick line) */
  const cLine = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, ROAD_LEN),
    new THREE.MeshBasicMaterial({ color: 0xf7b731 })
  );
  cLine.rotation.x = -Math.PI / 2;
  cLine.position.set(0, 0.015, -(ROAD_LEN / 2) + 120);
  g.add(cLine);

  /* White edge lines */
  [-10, 10].forEach(x => {
    const el = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, ROAD_LEN),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    el.rotation.x = -Math.PI / 2;
    el.position.set(x, 0.015, -(ROAD_LEN / 2) + 120);
    g.add(el);
  });

  /* Guardrails */
  const railMat = new THREE.MeshPhongMaterial({ color: 0x7a7a8a, shininess: 55 });
  [-11.8, 11.8].forEach(x => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.9, ROAD_LEN), railMat);
    rail.position.set(x, 0.45, -(ROAD_LEN / 2) + 120);
    rail.castShadow = true;
    g.add(rail);
    for (let z = -(ROAD_LEN) + 120; z < 160; z += 22) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.3, 0.18),
        new THREE.MeshPhongMaterial({ color: 0x555566 }));
      post.position.set(x, 0.65, z);
      g.add(post);
    }
  });

  /* Street lamps every 35 units */
  const poleM = new THREE.MeshPhongMaterial({ color: 0x555565 });
  const lampM = new THREE.MeshPhongMaterial({ color: 0xffdd88, emissive: 0xffaa22, emissiveIntensity: 0.9 });
  for (let z = -(ROAD_LEN) + 120; z < 160; z += 35) {
    [-14, 14].forEach(px => {
      const sign = px > 0 ? -1 : 1;
      /* pole */
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 6.5, 7), poleM);
      pole.position.set(px, 3.25, z);
      g.add(pole);
      /* arm */
      const arm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.08), poleM);
      arm.position.set(px + sign * 1.1, 6.6, z);
      g.add(arm);
      /* lamp head */
      const lh = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), lampM);
      lh.position.set(px + sign * 2.2, 6.6, z);
      g.add(lh);
      /* point light */
      const pl = new THREE.PointLight(0xffdd88, 0.75, 28);
      pl.position.set(px + sign * 2.2, 6.2, z);
      g.add(pl);
    });
  }

  return g;
}
scene.add(buildRoad());

/* Ground plane outside road */
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(1000, ROAD_LEN + 300),
  new THREE.MeshLambertMaterial({ color: 0x0c1808 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, -0.06, -(ROAD_LEN / 2) + 120);
scene.add(ground);

/* Night sky */
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(900, 32, 16),
  new THREE.MeshBasicMaterial({ color: 0x060b16, side: THREE.BackSide })
);
scene.add(sky);

/* Stars */
(function addStars() {
  const pos = [];
  for (let i = 0; i < 3500; i++) {
    const r = 700 + Math.random() * 150;
    const th = Math.random() * Math.PI * 2;
    const ph = (0.05 + Math.random() * 0.95) * Math.PI * 0.5;
    pos.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.1 })));
})();

// ─── REALISTIC CAR MODEL BUILDER ─────────────────────────────────
/*  Car orientation:  front = local -Z  (headlights at z ≈ -2)
    Cars drive in the world -Z direction → no group rotation needed.      */
function buildCar(hexColor) {
  const G = new THREE.Group();

  const col    = new THREE.Color(hexColor);
  const bodyM  = new THREE.MeshPhongMaterial({ color: col, shininess: 150, specular: new THREE.Color(0x333333) });
  const darkM  = new THREE.MeshPhongMaterial({ color: 0x0e0e0e, shininess: 8  });
  const glassM = new THREE.MeshPhongMaterial({ color: 0x5588aa, transparent: true, opacity: 0.52, shininess: 320 });
  const wheelM = new THREE.MeshPhongMaterial({ color: 0x1a1a1a });
  const hubM   = new THREE.MeshPhongMaterial({ color: 0xd4d4d4, shininess: 220 });
  const headM  = new THREE.MeshPhongMaterial({ color: 0xfffde8, emissive: 0xfffde8, emissiveIntensity: 0.95 });
  const tailM  = new THREE.MeshPhongMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 0.65 });

  function add(geo, mat, px, py, pz, rx, ry, rz) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px || 0, py || 0, pz || 0);
    if (rx) m.rotation.x = rx;
    if (ry) m.rotation.y = ry;
    if (rz) m.rotation.z = rz;
    m.castShadow = true;
    G.add(m);
    return m;
  }

  /* ─ Body ─ */
  add(new THREE.BoxGeometry(1.82, 0.50, 4.10), bodyM, 0, 0.45, 0);

  /* ─ Hood (front slope) ─ */
  add(new THREE.BoxGeometry(1.76, 0.09, 1.15), bodyM, 0, 0.75, -1.18);

  /* ─ Trunk (rear) ─ */
  add(new THREE.BoxGeometry(1.76, 0.09, 0.90), bodyM, 0, 0.75,  1.28);

  /* ─ Cabin ─ */
  add(new THREE.BoxGeometry(1.62, 0.58, 1.90), bodyM, 0, 1.16,  0.08);

  /* ─ Front windshield ─ */
  const fw = add(new THREE.BoxGeometry(1.52, 0.50, 0.07), glassM, 0, 1.14, -0.84);
  fw.rotation.x =  0.22;

  /* ─ Rear window ─ */
  const rw = add(new THREE.BoxGeometry(1.52, 0.50, 0.07), glassM, 0, 1.14,  1.03);
  rw.rotation.x = -0.22;

  /* ─ Side windows ─ */
  [-0.82, 0.82].forEach(x =>
    add(new THREE.BoxGeometry(0.07, 0.40, 1.62), glassM, x, 1.17, 0.07));

  /* ─ Front bumper ─ */
  add(new THREE.BoxGeometry(1.82, 0.22, 0.13), darkM, 0, 0.30, -2.09);

  /* ─ Rear bumper ─ */
  add(new THREE.BoxGeometry(1.82, 0.22, 0.13), darkM, 0, 0.30,  2.09);

  /* ─ Grille ─ */
  add(new THREE.BoxGeometry(1.05, 0.27, 0.10), darkM, 0, 0.50, -2.08);

  /* ─ Front headlights ─ */
  G.headlights = [];
  [-0.60, 0.60].forEach(x => {
    const hl = add(new THREE.BoxGeometry(0.38, 0.16, 0.09), headM, x, 0.54, -2.07);
    G.headlights.push(hl);
    /* DRL strip */
    add(new THREE.BoxGeometry(0.33, 0.04, 0.08), headM, x, 0.41, -2.07);
  });

  /* ─ Taillights ─ */
  G.taillights = [];
  [-0.60, 0.60].forEach(x => {
    const tl = add(new THREE.BoxGeometry(0.38, 0.16, 0.09), tailM.clone(), x, 0.54, 2.07);
    G.taillights.push(tl);
  });

  /* ─ Roof rack detail ─ */
  add(new THREE.BoxGeometry(1.28, 0.05, 1.50), darkM, 0, 1.47, 0.07);

  /* ─ Side mirrors ─ */
  [-0.98, 0.98].forEach(x =>
    add(new THREE.BoxGeometry(0.12, 0.08, 0.22), darkM, x, 0.82, -0.82));

  /* ─ Exhaust pipes ─ */
  [-0.40, 0.40].forEach(x => {
    const ep = add(new THREE.CylinderGeometry(0.04, 0.04, 0.18, 8), darkM, x, 0.20, 2.12);
    ep.rotation.x = Math.PI / 2;
  });

  /* ─ Wheels (FL FR RL RR) ─ */
  G.wheels = [];
  const wPos = [[-0.97, 0.32, -1.24], [0.97, 0.32, -1.24], [-0.97, 0.32, 1.24], [0.97, 0.32, 1.24]];
  wPos.forEach(([wx, wy, wz]) => {
    /* Tyre */
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.27, 24), wheelM);
    tyre.rotation.z = Math.PI / 2;
    tyre.position.set(wx, wy, wz);
    tyre.castShadow = true;
    G.add(tyre);
    G.wheels.push(tyre);

    /* Hub */
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.28, 14), hubM);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(wx, wy, wz);
    G.add(hub);

    /* Brake disc */
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.29, 12), darkM);
    disc.rotation.z = Math.PI / 2;
    disc.position.set(wx, wy, wz);
    G.add(disc);

    /* 5 spokes */
    for (let s = 0; s < 5; s++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.028, 0.34),
        new THREE.MeshPhongMaterial({ color: 0xaaaaaa }));
      sp.rotation.z = Math.PI / 2;
      sp.rotation.x = (s / 5) * Math.PI;
      sp.position.set(wx, wy, wz);
      G.add(sp);
    }
  });

  /* ─ Roof risk-indicator LED ─ */
  const riskLedM = new THREE.MeshPhongMaterial({ color: 0x00ff44, emissive: 0x00ff44, emissiveIntensity: 2.2 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.10, 8, 6), riskLedM);
  led.position.set(0, 1.55, 0.07);
  G.add(led);
  G.riskLed = led;

  return G;
}

// ─── CAR INSTANCES ───────────────────────────────────────────────
const cars = [];

function initCars() {
  for (let i = 0; i < NUM_CARS; i++) {
    const lane      = CAR_LANES[i];
    const x         = LANE_XS[lane];
    const baseSpeed = 32 + Math.random() * 88;   // 32-120 km/h
    const z         = -(i * 30) - Math.random() * 18;

    const model = buildCar(CAR_HEX[i]);
    model.position.set(x, 0, z);
    scene.add(model);

    const label = makeLabel(i);
    document.getElementById('car-labels').appendChild(label);

    cars.push({
      id: i, model, lane, x,
      speed: baseSpeed, baseSpeed,
      risk: 0, braking: false, label
    });
  }
}

// ─── PER-CAR HTML LABELS ─────────────────────────────────────────
function hex2css(h) { return `#${h.toString(16).padStart(6,'0')}`; }

function makeLabel(id) {
  const d = document.createElement('div');
  d.className = 'car-label';
  d.id = `cl-${id}`;
  d.innerHTML = `
    <div class="lbl-hdr">
      <span class="lbl-id" style="color:${hex2css(CAR_HEX[id])}">● CAR ${id+1}</span>
      <span class="rbadge safe" id="lb-risk-${id}">SAFE</span>
    </div>
    <div class="lbl-stat"><span class="lbl-ico">⚡</span><span id="lb-spd-${id}">-- km/h</span></div>
    <div class="lbl-stat"><span class="lbl-ico">📍</span><span id="lb-pos-${id}">L${CAR_LANES[id]+1}</span></div>
    <div class="lbl-stat"><span class="lbl-ico">🛑</span><span id="lb-brk-${id}">Normal</span></div>
    <div class="lbl-stat"><span class="lbl-ico">⚠️</span><span id="lb-prb-${id}">0.0%</span></div>`;
  return d;
}

const _lv3 = new THREE.Vector3();

function syncLabel(car) {
  car.model.getWorldPosition(_lv3);
  _lv3.y += 3.0;
  _lv3.project(camera);

  const sx = ( _lv3.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-_lv3.y * 0.5 + 0.5) * window.innerHeight;
  const L  = car.label;

  if (_lv3.z > 1 || sx < -10 || sx > window.innerWidth + 10 || sy < -10 || sy > window.innerHeight + 10) {
    L.style.display = 'none'; return;
  }
  if (!labelsOn) { L.style.display = 'none'; return; }

  L.style.display  = 'block';
  L.style.left     = `${sx}px`;
  L.style.top      = `${sy}px`;
  const dist = camera.position.distanceTo(_lv3);
  L.style.opacity  = Math.max(0.15, Math.min(1, 1 - (dist - 35) / 130)).toString();
}

function updateLabel(car) {
  const $ = id => document.getElementById(id);
  $(`lb-spd-${car.id}`).textContent = `${car.speed.toFixed(0)} km/h`;
  $(`lb-pos-${car.id}`).textContent = `Lane ${car.lane+1}   Z:${Math.abs(car.model.position.z).toFixed(0)} m`;
  $(`lb-brk-${car.id}`).textContent = car.braking ? '🛑 BRAKING' : 'Normal';
  $(`lb-prb-${car.id}`).textContent = `${(car.risk*100).toFixed(1)}%`;

  const badge = $(`lb-risk-${car.id}`);
  if      (car.risk > 0.7) { badge.textContent='HIGH';   badge.className='rbadge danger'; car.label.className='car-label danger';  }
  else if (car.risk > 0.4) { badge.textContent='MEDIUM'; badge.className='rbadge warning';car.label.className='car-label warning'; }
  else                     { badge.textContent='SAFE';   badge.className='rbadge safe';   car.label.className='car-label';         }
}

// ─── WEATHER ─────────────────────────────────────────────────────
function applyWeather(mode) {
  weatherMode = mode;
  if (mode === 0) {          /* Clear */
    sky.material.color.set(0x060b16);
    ambLight.color.set(0x2a3d5a); ambLight.intensity = 0.75;
    sun.color.set(0xfff0cc);      sun.intensity = 1.0;
    scene.fog = null;
    removeRain();
  } else if (mode === 1) {   /* Rain */
    sky.material.color.set(0x080c1a);
    ambLight.color.set(0x222d40); ambLight.intensity = 0.40;
    sun.color.set(0x7788aa);      sun.intensity = 0.35;
    scene.fog = new THREE.Fog(0x101824, 35, 190);
    spawnRain();
  } else {                   /* Fog */
    sky.material.color.set(0x7a8898);
    ambLight.color.set(0x778899); ambLight.intensity = 0.50;
    sun.color.set(0x99aabb);      sun.intensity = 0.25;
    scene.fog = new THREE.FogExp2(0x88909a, 0.033);
    removeRain();
  }
}

function spawnRain() {
  removeRain();
  const pos = [];
  for (let i = 0; i < 5000; i++) {
    pos.push((Math.random()-0.5)*100, Math.random()*55, (Math.random()-0.5)*140);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  rainSys = new THREE.Points(geo,
    new THREE.PointsMaterial({ color: 0x88aacc, size: 0.065, transparent: true, opacity: 0.60 }));
  scene.add(rainSys);
}

function removeRain() {
  if (rainSys) { scene.remove(rainSys); rainSys.geometry.dispose(); rainSys = null; }
}

// ─── V2V RISK ENGINE ─────────────────────────────────────────────
async function v2vCycle() {
  if (!backendUp) return;

  /* Reset per-frame state */
  cars.forEach(c => { c.risk = 0; c.braking = false; });

  let maxRisk = 0, links = 0;
  const promises = [];

  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      const laneDiff = Math.abs(a.lane - b.lane);
      const dz       = Math.abs(a.model.position.z - b.model.position.z);
      if (laneDiff > 1 || dz > 65) continue;

      links++;
      const dx   = Math.abs(LANE_XS[a.lane] - LANE_XS[b.lane]);
      const dist = Math.sqrt(dx * dx + dz * dz);
      const relV = Math.abs(a.speed  - b.speed);
      const brk  = dist < 16 ? 1 : 0;

      promises.push(
        fetch(`${API}/predict`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            speed_ego:      a.speed,
            speed_other:    b.speed,
            distance:       Math.max(1, dist),
            relative_speed: relV,
            lane_difference:laneDiff,
            weather:        weatherMode,
            brake_event:    brk,
            car_id:         a.id
          })
        })
        .then(r => r.json())
        .then(({ risk }) => {
          totalPreds++;
          if (risk > a.risk) a.risk = risk;
          if (risk > b.risk) b.risk = risk;
          if (risk > maxRisk) maxRisk = risk;
          if (risk > 0.65)  { a.braking = true; }
          if (risk > 0.30)  logV2V(a.id, b.id, risk, dist);
          if (risk > 0.70)  fireAlert(a.id, b.id, risk);
        })
        .catch(() => {})
      );
    }
  }

  await Promise.all(promises);

  /* Update visuals */
  cars.forEach(car => { setRiskLed(car); setBrakeLights(car); });

  /* Dashboard */
  const hi = cars.filter(c => c.risk > 0.7).length;
  document.getElementById('stat-high-risk').textContent = hi;
  document.getElementById('stat-preds').textContent     = totalPreds;
  document.getElementById('mpreds').textContent         = totalPreds;
  document.getElementById('mlinks').textContent         = links;
  updateGauge(maxRisk);
  updateLaneSpeeds();
}

function setRiskLed(car) {
  const led = car.model.riskLed;
  if (!led) return;
  let c, ei;
  if      (car.risk > 0.7) { c = 0xff2244; ei = 3.2; }
  else if (car.risk > 0.4) { c = 0xffaa00; ei = 2.1; }
  else                     { c = 0x00ff44; ei = 1.0; }
  led.material.color.setHex(c);
  led.material.emissive.setHex(c);
  led.material.emissiveIntensity = ei;
}

function setBrakeLights(car) {
  if (!car.model.taillights) return;
  car.model.taillights.forEach(tl => {
    tl.material.color.setHex(car.braking ? 0xff6633 : 0xff0000);
    tl.material.emissive.setHex(car.braking ? 0xff3300 : 0xff0000);
    tl.material.emissiveIntensity = car.braking ? 2.8 : 0.65;
  });
}

// ─── V2V COMMS LOG ───────────────────────────────────────────────
function logV2V(idA, idB, risk, dist) {
  const ts  = new Date().toLocaleTimeString('en',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const lvl = risk > 0.7 ? 'high' : risk > 0.4 ? 'med' : 'low';
  const txt = risk > 0.7 ? 'HIGH' : risk > 0.4 ? 'MED' : 'LOW';
  v2vMsgs.unshift({ ts, idA, idB, risk, dist: dist.toFixed(0), lvl, txt });
  if (v2vMsgs.length > 22) v2vMsgs.pop();

  document.getElementById('v2v-log').innerHTML =
    v2vMsgs.slice(0, 14).map(m =>
      `<div class="v2v-entry ${m.lvl}">[${m.ts}] CAR${m.idA+1}↔CAR${m.idB+1} ` +
      `<span class="v2v-r-${m.lvl}">${m.txt}</span> ` +
      `D:${m.dist}m R:${(m.risk*100).toFixed(0)}%</div>`
    ).join('');
}

// ─── ALERT OVERLAY ───────────────────────────────────────────────
function fireAlert(idA, idB, risk) {
  const now = Date.now();
  if (now - lastAlert < 4200) return;
  lastAlert = now;
  totalAlerts++;
  document.getElementById('stat-alerts').textContent = totalAlerts;
  document.getElementById('alert-info').innerHTML =
    `CAR ${idA+1} ↔ CAR ${idB+1}<br>Collision Probability: ` +
    `<strong style="color:#ff2244;font-size:18px">${(risk*100).toFixed(1)}%</strong>`;
  document.getElementById('alert-overlay').classList.remove('hidden');
  if (soundEnabled) beep(risk > 0.86 ? 1050 : 680);
  setTimeout(() => document.getElementById('alert-overlay').classList.add('hidden'), 3600);
}

// ─── AUDIO ───────────────────────────────────────────────────────
function beep(freq) {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.22, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.45);
  osc.start(); osc.stop(audioCtx.currentTime + 0.45);
}

// ─── CAMERA ──────────────────────────────────────────────────────
function setCamera(mode) {
  cameraMode = mode;
  ['overview','pov','chase'].forEach(m =>
    document.getElementById(`btn-${m}`)?.classList.toggle('active', m === mode));
}

function tickCamera(dt) {
  if (!cars.length) return;
  const ep = cars[0].model.position;
  let tp, tl;
  if (cameraMode === 'overview') {
    tp = new THREE.Vector3(0, 60, ep.z + 90);
    tl = new THREE.Vector3(0,  0, ep.z - 30);
  } else if (cameraMode === 'pov') {
    tp = new THREE.Vector3(ep.x, ep.y + 1.45, ep.z -  0.5);
    tl = new THREE.Vector3(ep.x, ep.y + 1.10, ep.z - 45);
  } else {
    tp = new THREE.Vector3(ep.x, ep.y + 11, ep.z + 30);
    tl = new THREE.Vector3(ep.x, ep.y +  1, ep.z - 25);
  }
  camera.position.lerp(tp, 0.035 * dt);
  camLook.lerp(tl, 0.035 * dt);
  camera.lookAt(camLook);
}

// ─── RISK GAUGE ──────────────────────────────────────────────────
function updateGauge(risk) {
  const cvs = document.getElementById('risk-gauge');
  const ctx  = cvs.getContext('2d');
  const W = cvs.width, H = cvs.height;
  ctx.clearRect(0, 0, W, H);

  const cx = W / 2, cy = H - 10, r = Math.min(W * 0.41, H * 0.77);

  /* Track */
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 0);
  ctx.strokeStyle = 'rgba(60,90,140,.18)';
  ctx.lineWidth = 16; ctx.stroke();

  /* Value arc */
  const col = risk > 0.7 ? '#ff2244' : risk > 0.4 ? '#ffd740' : '#00e676';
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, Math.PI + risk * Math.PI);
  ctx.strokeStyle = col; ctx.lineWidth = 16; ctx.lineCap = 'round';
  ctx.shadowColor = col; ctx.shadowBlur = 22;
  ctx.stroke(); ctx.shadowBlur = 0;

  /* Tick marks */
  for (let t = 0; t <= 1; t += 0.25) {
    const a = Math.PI + t * Math.PI;
    const x1 = cx + (r-9)*Math.cos(a), y1 = cy + (r-9)*Math.sin(a);
    const x2 = cx + (r-19)*Math.cos(a),y2 = cy + (r-19)*Math.sin(a);
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2);
    ctx.strokeStyle = 'rgba(140,170,210,.3)'; ctx.lineWidth = 2; ctx.lineCap='butt';
    ctx.stroke();
  }

  document.getElementById('risk-pct').textContent = `${(risk*100).toFixed(1)}%`;
  const b = document.getElementById('risk-badge');
  if      (risk > 0.7) { b.textContent='🔴 HIGH RISK'; b.className='rbadge danger';  }
  else if (risk > 0.4) { b.textContent='🟡 WARNING';   b.className='rbadge warning'; }
  else                 { b.textContent='🟢 SAFE';       b.className='rbadge safe';    }
}

// ─── LANE SPEED BARS ─────────────────────────────────────────────
function initLaneSpeeds() {
  document.getElementById('lane-speeds').innerHTML =
    LANE_XS.map((_, l) =>
      `<div class="lane-row">
         <span class="lane-nm">Lane ${l+1}</span>
         <div class="lane-track"><div class="lane-fill" id="lfill-${l}"></div></div>
         <span class="lane-v" id="lval-${l}">— km/h</span>
       </div>`
    ).join('');
}

function updateLaneSpeeds() {
  LANE_XS.forEach((_, l) => {
    const carsInLane = cars.filter(c => c.lane === l);
    if (!carsInLane.length) return;
    const avg = carsInLane.reduce((s,c) => s + c.speed, 0) / carsInLane.length;
    const pct = Math.min(100, (avg / 140) * 100);
    const fill = document.getElementById(`lfill-${l}`);
    const val  = document.getElementById(`lval-${l}`);
    if (fill) { fill.style.width = `${pct}%`; fill.style.background = avg > 110 ? 'var(--danger)' : avg > 78 ? 'var(--warn)' : 'var(--safe)'; }
    if (val)  { val.textContent = `${avg.toFixed(0)} km/h`; }
  });
}

// ─── CHARTS ──────────────────────────────────────────────────────
function initCharts() {
  /* Risk history */
  riskChart = new Chart(document.getElementById('risk-chart').getContext('2d'), {
    type: 'line',
    data: { labels: [], datasets: [{ data: [], borderColor: '#00e5ff',
      backgroundColor: 'rgba(0,229,255,0.08)', fill: true, tension: 0.42,
      pointRadius: 0, borderWidth: 2 }] },
    options: {
      animation: false, responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { min:0, max:100, grid:{color:'rgba(255,255,255,.04)'}, ticks:{color:'#3a5577',font:{size:8},stepSize:25} },
        x: { grid:{display:false}, ticks:{color:'#3a5577',font:{size:8},maxTicksLimit:5} }
      }
    }
  });

  /* Feature importance (placeholder, data loaded from backend) */
  featChart = new Chart(document.getElementById('feat-chart').getContext('2d'), {
    type: 'bar',
    data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderWidth: 1 }] },
    options: {
      indexAxis: 'y',
      animation: { duration: 700 },
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${Number(ctx.parsed.x).toFixed(2)}%` } }
      },
      scales: {
        x: { grid:{color:'rgba(255,255,255,.04)'}, ticks:{color:'#3a5577',font:{size:10}} },
        y: { grid:{display:false}, ticks:{color:'#b8cfee',font:{size:11,family:'Inter'}} }
      }
    }
  });
}

async function fetchFeatureImportance() {
  try {
    const { features, importances } = await fetch(`${API}/feature_importance`).then(r => r.json());
    const labels = features.map(f => f.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));
    const vals   = importances.map(v => v * 100);
    const maxV   = Math.max(...vals);
    const colors = vals.map(v => {
      const t = v / maxV;
      return `rgba(${Math.round(50+200*t)}, ${Math.round(160-60*t)}, ${Math.round(255-200*t)}, 0.82)`;
    });
    featChart.data.labels                       = labels;
    featChart.data.datasets[0].data             = vals;
    featChart.data.datasets[0].backgroundColor  = colors;
    featChart.data.datasets[0].borderColor      = colors;
    featChart.update();
  } catch {}
}

async function fetchHistory() {
  try {
    const data = await fetch(`${API}/history`).then(r => r.json());
    riskChart.data.labels           = data.map((_,i) => i+1);
    riskChart.data.datasets[0].data = data.map(d => (d.risk*100).toFixed(1));
    riskChart.update('none');
  } catch {}
}

// ─── BACKEND PROBE ───────────────────────────────────────────────
async function probeBackend() {
  try {
    await fetch(`${API}/status`);
    backendUp = true;
    document.getElementById('backend-status').textContent = 'AI Engine Online ✅';
    document.getElementById('dot').className = 'dot online';
    if (!featChart.data.labels.length) fetchFeatureImportance();
  } catch {
    backendUp = false;
    document.getElementById('backend-status').textContent = 'AI Engine Offline ❌';
    document.getElementById('dot').className = 'dot offline';
  }
}

// ─── ANIMATION LOOP ──────────────────────────────────────────────
let prevT = performance.now();

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt  = Math.min((now - prevT) / 16.67, 3.0);   /* frame-rate normalised */
  prevT = now;

  const spd = simSpeed * dt;

  cars.forEach(car => {
    let move = (car.speed / 600) * spd;

    if (car.braking) {
      car.speed  = Math.max(15, car.speed - 1.8 * spd);
      move      *= 0.42;
    } else {
      if (car.speed < car.baseSpeed) car.speed += 0.50 * spd;
      if (car.speed > car.baseSpeed) car.speed -= 0.25 * spd;
    }

    car.model.position.z -= move;

    /* Wheel spin */
    car.model.wheels?.forEach(w => { w.rotation.x -= move * 3.2; });

    /* Loop track */
    if (car.model.position.z < -480) {
      car.model.position.z = 110 + Math.random() * 35;
      car.risk = 0; car.braking = false;
    }

    updateLabel(car);
    syncLabel(car);
  });

  /* Rain animation — follows ego car position */
  if (rainSys) {
    const pa = rainSys.geometry.attributes.position.array;
    const cz = camera.position.z;
    for (let i = 0; i < pa.length; i += 3) {
      pa[i+1] -= 0.65 * spd;
      if (pa[i+1] < -2) {
        pa[i+1] = 50 + Math.random() * 10;
        pa[i+2] = cz + (Math.random() - 0.5) * 140;
      }
    }
    rainSys.geometry.attributes.position.needsUpdate = true;
    rainSys.position.x = camera.position.x;
  }

  tickCamera(dt);
  renderer.render(scene, camera);
}

// ─── UI CONTROLS ─────────────────────────────────────────────────
function setEgoSpeed(v) {
  document.getElementById('ego-spd-val').textContent = `${v} km/h`;
  if (cars[0]) { cars[0].speed = +v; cars[0].baseSpeed = +v; }
}

function setSimSpeed(v) {
  simSpeed = +v;
  document.getElementById('sim-spd-val').textContent = `${(+v).toFixed(1)}×`;
}

function setWeather(mode) {
  applyWeather(mode);
  ['clear','rain','fog'].forEach((w,i) =>
    document.getElementById(`w-${w}`)?.classList.toggle('active', i === mode));
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  document.getElementById('btn-sound').textContent = soundEnabled ? '🔊 Sound ON' : '🔇 Sound OFF';
}

function toggleLabels() {
  labelsOn = !labelsOn;
  document.getElementById('btn-labels').textContent = labelsOn ? '🏷️ Labels ON' : '🏷️ Labels OFF';
  if (!labelsOn) cars.forEach(c => { c.label.style.display = 'none'; });
}

function resetSim() {
  cars.forEach((car, i) => {
    car.model.position.set(LANE_XS[CAR_LANES[i]], 0, -(i*30) - Math.random()*18);
    car.speed = 32 + Math.random() * 88;
    car.baseSpeed = car.speed;
    car.risk = 0; car.braking = false;
  });
  totalAlerts = 0; totalPreds = 0; v2vMsgs = [];
  document.getElementById('v2v-log').innerHTML      = '<div class="v2v-ph">Awaiting V2V broadcasts…</div>';
  document.getElementById('stat-alerts').textContent = 0;
  document.getElementById('stat-high-risk').textContent = 0;
  fetch(`${API}/reset`, { method: 'POST' }).catch(() => {});
}

// ─── RESIZE ──────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─── BOOTSTRAP ───────────────────────────────────────────────────
initCars();
initLaneSpeeds();
applyWeather(0);
initCharts();
probeBackend();

setInterval(probeBackend,  10000);
setInterval(v2vCycle,       1200);
setInterval(fetchHistory,   2500);

animate();