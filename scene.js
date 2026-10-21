/* Infinity Team — 3D-сцена первого экрана.
   История: двое строителей с краном строят стеклянную студию Roblox-игр, в окнах
   загорается свет, строитель отдаёт клиенту мешок денег, и к клиенту летят монеты.
   Three.js грузится с CDN (см. importmap в index.html). Нет WebGL — сцена просто не показывается. */
(async function () {
  const host = document.querySelector(".scene3d");
  if (!host) return;
  const canvas = host.querySelector("canvas");
  const badge = host.querySelector(".money-badge");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const hasWebGL = (() => {
    try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); }
    catch (e) { return false; }
  })();
  if (!hasWebGL) { host.classList.add("no-3d"); return; }

  let THREE, RoundedBoxGeometry, RoomEnvironment, mergeGeometries;
  try {
    THREE = await import("three");
    [{ RoundedBoxGeometry }, { RoomEnvironment }, { mergeGeometries }] = await Promise.all([
      import("three/addons/geometries/RoundedBoxGeometry.js"),
      import("three/addons/environments/RoomEnvironment.js"),
      import("three/addons/utils/BufferGeometryUtils.js"),
    ]);
  } catch (e) { host.classList.add("no-3d"); return; }

  /* ---------- рендер, свет, камера ---------- */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;            // ночь: отражения приглушённые

  scene.add(new THREE.HemisphereLight("#9DB6FF", "#1A2550", 1.1));
  const moon = new THREE.DirectionalLight("#C9D8FF", 2.6);
  moon.position.set(-9, 16, 8);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
  Object.assign(moon.shadow.camera, { left: -10, right: 10, top: 12, bottom: -8, near: 1, far: 45 });
  moon.shadow.bias = -0.0006;
  moon.shadow.normalBias = 0.02;
  scene.add(moon);
  const warm = new THREE.DirectionalLight("#FFD9A6", 0.7);
  warm.position.set(10, 6, 12);
  scene.add(warm);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  const target = new THREE.Vector3(0.8, 3.8, 0.8);
  const camOffset = new THREE.Vector3(16.0, 9.0, 16.9);
  const UP = new THREE.Vector3(0, 1, 0);

  /* ---------- помощники ---------- */
  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...o });
  const shadowed = (m, cast = true, receive = true) => { m.castShadow = cast; m.receiveShadow = receive; return m; };
  const mesh = (geo, mat, cast = true) => shadowed(new THREE.Mesh(geo, mat), cast, true);
  const rbox = (w, h, d, r, mat) => mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2) - 0.0001), mat);
  const box = (w, h, d, mat, cast = true) => mesh(new THREE.BoxGeometry(w, h, d), mat, cast);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const easeOut = (k) => 1 - Math.pow(1 - k, 3);
  const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

  const glowTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d");
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.22, "rgba(255,236,190,0.6)");
    gr.addColorStop(1, "rgba(255,210,140,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const glow = (color, size, opacity = 1) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    s.scale.set(size, size, 1);
    return s;
  };

  /* ---------- парящий остров ---------- */
  const grassMat = std("#4FA65A", { roughness: 0.95 });
  const island = new THREE.Group(); scene.add(island);
  const R = 6.2;
  const grass = mesh(new THREE.CylinderGeometry(R, R, 0.5, 80), grassMat, false); grass.position.y = -0.25;
  const lip = mesh(new THREE.TorusGeometry(R, 0.25, 14, 100), grassMat, false); lip.rotation.x = Math.PI / 2; lip.position.y = -0.25;
  const dirt = mesh(new THREE.CylinderGeometry(R - 0.05, R - 0.75, 0.9, 80), std("#7A5A40", { roughness: 1 }), false); dirt.position.y = -0.95;
  const rockGeo = new THREE.CylinderGeometry(R - 0.75, 1.2, 3.6, 16, 4);
  const pos = rockGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {          // неровная скала снизу
    if (pos.getY(i) < 1.85) { pos.setX(i, pos.getX(i) * (0.88 + rnd() * 0.24)); pos.setZ(i, pos.getZ(i) * (0.88 + rnd() * 0.24)); pos.setY(i, pos.getY(i) + (rnd() - 0.5) * 0.35); }
  }
  rockGeo.computeVertexNormals();
  const rock = mesh(rockGeo, std("#5E4A3C", { roughness: 1, flatShading: true }), false); rock.position.y = -3.3;
  island.add(grass, lip, dirt, rock);
  [[-3.2, -5.6, 2.2, 0.55], [3.6, -6.1, -1.6, 0.4], [0.6, -7.2, 3.2, 0.3]].forEach(([x, y, z, r]) => {
    const s = mesh(new THREE.DodecahedronGeometry(r), std("#5E4A3C", { roughness: 1, flatShading: true }), false);
    s.position.set(x, y, z); island.add(s);
  });

  // площадь, дорожка
  const stone = std("#C9CFDB", { roughness: 0.8 });
  const plaza = mesh(new THREE.CylinderGeometry(3.0, 3.0, 0.06, 64), stone, false); plaza.position.y = 0.03;
  const path = box(1.6, 0.06, 4.3, stone, false); path.position.set(0, 0.03, 4.0);
  island.add(plaza, path);

  // деревья и кусты
  const trunkMat = std("#7A5235"), leafA = std("#3E9150", { flatShading: true }), leafB = std("#2E7A45", { flatShading: true });
  const tree = (x, z, s = 1) => {
    const g = new THREE.Group();
    const trunk = mesh(new THREE.CylinderGeometry(0.11 * s, 0.16 * s, 1.0 * s, 8), trunkMat); trunk.position.y = 0.5 * s;
    const c1 = mesh(new THREE.IcosahedronGeometry(0.78 * s, 1), leafA); c1.position.y = 1.35 * s;
    const c2 = mesh(new THREE.IcosahedronGeometry(0.52 * s, 1), leafB); c2.position.set(0.25 * s, 1.95 * s, -0.1 * s);
    g.add(trunk, c1, c2); g.position.set(x, 0, z); g.rotation.y = rnd() * 6; island.add(g);
  };
  [[-4.5, 1.6, 1.0], [-3.1, 4.1, 0.85], [4.4, -1.9, 1.05], [1.4, -4.8, 0.95], [-4.4, -2.6, 0.9], [-1.6, -4.9, 0.8]]
    .forEach(([x, z, s]) => tree(x, z, s));
  [[-2.3, 2.3], [2.4, -2.4], [-1.9, -2.6], [2.9, 4.9], [-5.1, 2.6], [5.3, 0.4]].forEach(([x, z]) => {
    const b = mesh(new THREE.IcosahedronGeometry(0.42, 1), leafA); b.position.set(x, 0.28, z); b.scale.y = 0.75; island.add(b);
  });

  // фонари вдоль дорожки
  const lampHead = std("#FFE3A3", { emissive: "#FFD27A", emissiveIntensity: 2.2 });
  [[-1.2, 3.3], [1.2, 3.3], [-1.2, 5.4], [1.2, 5.4]].forEach(([x, z], i) => {
    const pole = mesh(new THREE.CylinderGeometry(0.04, 0.06, 1.6, 8), std("#26314F", { metalness: 0.6, roughness: 0.4 }));
    pole.position.set(x, 0.8, z);
    const head = mesh(new THREE.SphereGeometry(0.13, 16, 12), lampHead, false); head.position.set(x, 1.66, z);
    const g = glow("#FFD27A", 0.6, 0.45); g.position.set(x, 1.66, z);
    island.add(pole, head, g);
    if (i < 2) { const pl = new THREE.PointLight("#FFC873", 7, 5, 2); pl.position.set(x, 1.6, z); island.add(pl); }
  });

  /* ---------- стеклянная студия Roblox-игр ---------- */
  const W = 3.2, FH = 0.95, N = 7;
  const tower = new THREE.Group(); scene.add(tower);
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: "#2E6FDB", metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.86,
    envMapIntensity: 2.2, clearcoat: 1, clearcoatRoughness: 0.06,
  });
  const slabMat = std("#E6EBF4", { roughness: 0.4 });
  const frameMat = std("#F4F7FC", { roughness: 0.3, metalness: 0.25 });
  const roomMat = std("#16224A");                                            // тёмные комнаты за стеклом
  // окна, которые загорятся тёплым светом, когда здание готово (стекло при этом остаётся синим)
  const paneGeo = new THREE.PlaneGeometry(W / 4 - 0.1, FH - 0.24);
  const lampMats = ["#FFD27A", "#FFE6A8", "#FFC264"].map((c) => new THREE.MeshStandardMaterial({ color: "#1A2B55", emissive: c, emissiveIntensity: 2.3 }));
  const panes = [];
  const floors = [];
  for (let i = 0; i < N; i++) {
    const f = new THREE.Group();
    const slab = box(W + 0.2, 0.12, W + 0.2, slabMat); slab.position.y = 0.06;
    const glass = mesh(new THREE.BoxGeometry(W - 0.04, FH - 0.12, W - 0.04), glassMat, false);
    glass.position.y = 0.12 + (FH - 0.12) / 2;
    const room = box(W - 0.5, FH - 0.42, W - 0.5, roomMat, false); room.position.y = glass.position.y;
    f.add(slab, glass, room);
    for (let side = 0; side < 4; side++) {          // белые рамы фасада
      for (let k = 1; k <= 3; k++) {
        const m = box(0.06, FH - 0.12, 0.06, frameMat);
        const along = -W / 2 + (k * W) / 4, out = W / 2 - 0.0;
        const [x, z] = [[along, out], [out, -along], [-along, -out], [-out, along]][side];
        m.position.set(x, glass.position.y, z); f.add(m);
      }
      for (let k = 0; k < 4; k++) {                      // светящиеся окна поверх стекла
        if (rnd() > 0.52) continue;
        const along = -W / 2 + ((k + 0.5) * W) / 4, out = (W - 0.04) / 2 + 0.006;
        const pane = new THREE.Mesh(paneGeo, lampMats[Math.floor(rnd() * 3)]);
        const [x, z, ry] = [[along, out, 0], [out, -along, Math.PI / 2], [-along, -out, Math.PI], [-out, along, -Math.PI / 2]][side];
        pane.position.set(x, glass.position.y, z); pane.rotation.y = ry;
        pane.visible = false; pane.userData.delay = i * 0.11 + rnd() * 0.25;
        f.add(pane); panes.push(pane);
      }
    }
    f.userData.targetY = 0.06 + i * FH;
    f.userData.height = FH;
    tower.add(f); floors.push(f);
  }
  // вход на первом этаже
  const door = box(1.1, 0.72, 0.04, std("#0E1B45", { emissive: "#FFCF7A", emissiveIntensity: 0, roughness: 0.2 }), false);
  door.position.set(0, 0.48, W / 2 + 0.01);
  const canopy = box(1.8, 0.07, 0.75, slabMat); canopy.position.set(0, 0.9, W / 2 + 0.36);
  floors[0].add(door, canopy);

  // крыша со светящимся знаком ∞
  const roof = new THREE.Group();
  const roofSlab = box(W + 0.2, 0.16, W + 0.2, slabMat); roofSlab.position.y = 0.08;
  roof.add(roofSlab);
  [[0, W / 2], [0, -W / 2], [W / 2, 0], [-W / 2, 0]].forEach(([x, z], i) => {
    const p = box(i < 2 ? W + 0.2 : 0.1, 0.22, i < 2 ? 0.1 : W + 0.2, frameMat); p.position.set(x, 0.27, z); roof.add(p);
  });
  class Lemniscate extends THREE.Curve {
    getPoint(t, out = new THREE.Vector3()) {
      const s = t * Math.PI * 2, d = 1 + Math.sin(s) ** 2;
      return out.set(Math.cos(s) / d, (Math.sin(s) * Math.cos(s)) / d, 0.08 * Math.sin(s));
    }
  }
  const signMat = std("#FFFFFF", { emissive: "#FFF4D6", emissiveIntensity: 0.25, roughness: 0.3 });
  const sign = mesh(new THREE.TubeGeometry(new Lemniscate(), 160, 0.075, 14, true), signMat);
  sign.scale.set(0.95, 0.95, 0.95); sign.position.set(0, 1.25, 0); sign.rotation.y = Math.PI / 4;
  const signPosts = [-0.55, 0.55].map((x) => {
    const p = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.85, 8), frameMat);
    p.position.set(x * Math.SQRT1_2, 0.62, x * -Math.SQRT1_2); return p;
  });
  const signGlow = glow("#FFF1C8", 3.2, 0); signGlow.position.copy(sign.position);
  const antenna = mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 6), frameMat); antenna.position.set(-1.1, 0.8, -1.1);
  const redMat = std("#FF4040", { emissive: "#FF2A2A", emissiveIntensity: 0.3 });
  const redLight = mesh(new THREE.SphereGeometry(0.07, 10, 8), redMat, false); redLight.position.set(-1.1, 1.38, -1.1);
  roof.add(sign, signGlow, antenna, redLight, ...signPosts);
  roof.userData.targetY = 0.06 + N * FH;
  roof.userData.height = 0.3;
  sign.visible = false; signPosts.forEach((p) => (p.visible = false));   // знак вырастет, когда загорится свет
  tower.add(roof);
  const pieces = [...floors, roof];
  const towerGlow = glow("#FFD58A", 9, 0); towerGlow.position.set(0, 3.6, 0); tower.add(towerGlow);

  /* ---------- башенный кран ---------- */
  // Как настоящий: решётчатая мачта на бетонном основании, поворотный круг, кабина крановщика,
  // оголовок-пирамида с растяжками, стрела-ферма с тележкой, противовесная консоль с плитами и лебёдкой.
  const craneMat = std("#F5C430", { roughness: 0.45, metalness: 0.35 });
  const steelMat = std("#3A4258", { roughness: 0.5, metalness: 0.6 });
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const strut = (list, a, b, th) => {                 // брус от точки a до точки b (для ферм)
    const dir = new THREE.Vector3().subVectors(b, a), len = dir.length();
    const g = new THREE.BoxGeometry(th, len, th);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    list.push(g);
  };
  // кран слева от здания (с точки зрения зрителя), стрела тянется к центру крыши
  const CRANE = new THREE.Vector3(-3.0, 0, 0.25);
  const crane = new THREE.Group(); crane.position.copy(CRANE); scene.add(crane);
  const CH = 8.75;

  // бетонное основание и мачта из секций
  const footing = box(1.3, 0.3, 1.3, std("#9AA1AE", { roughness: 0.95 })); footing.position.y = 0.15; crane.add(footing);
  const mastParts = [];
  const M = 0.3, SEC = 0.75, MAST0 = 0.3;
  const mc = [[-M, -M], [M, -M], [M, M], [-M, M]];
  mc.forEach(([x, z]) => strut(mastParts, V(x, MAST0, z), V(x, CH, z), 0.08));
  for (let y = MAST0, s = 0; y < CH - 0.01; y += SEC, s++) {
    const y2 = Math.min(y + SEC, CH);
    mc.forEach(([x, z], i) => {
      const [nx, nz] = mc[(i + 1) % 4];
      strut(mastParts, V(x, y, z), V(nx, y, nz), 0.04);                       // горизонталь секции
      if ((s + i) % 2) strut(mastParts, V(x, y, z), V(nx, y2, nz), 0.032);    // диагональ «зигзагом»
      else strut(mastParts, V(nx, y, nz), V(x, y2, z), 0.032);
    });
  }
  mc.forEach(([x, z]) => strut(mastParts, V(x * 1.7, MAST0, z * 1.7), V(x, 1.0, z), 0.06));   // упоры у основания
  crane.add(mesh(mergeGeometries(mastParts), craneMat));
  const ring = mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.14, 28), steelMat); ring.position.y = CH + 0.07; crane.add(ring);

  // всё, что выше поворотного круга, поворачивается вместе: локальная +x смотрит на центр здания
  const JIB_YAW = Math.atan2(CRANE.z, -CRANE.x);
  const top = new THREE.Group(); top.position.y = CH + 0.14; top.rotation.y = JIB_YAW; crane.add(top);
  const REACH = Math.hypot(CRANE.x, CRANE.z), JIB = REACH + 1.4, CJ = 2.3;
  const tp = [], sp = [];                             // жёлтые фермы и стальные детали — сливаем в два меша
  const deck = box(1.1, 0.1, 0.9, steelMat); deck.position.y = 0.05; top.add(deck);

  // стрела: треугольная ферма, к концу сужается
  const J0 = 0.4, JB = 0.13, JH = 0.64, JZ = 0.24, PAN = 0.45;
  const jibTop = (x) => (x <= JIB - PAN ? JH : lerp(JH, JB + 0.08, (x - (JIB - PAN)) / PAN));
  [-JZ, JZ].forEach((z) => strut(tp, V(J0, JB, z), V(JIB, JB, z), 0.07));
  strut(tp, V(J0, JH, 0), V(JIB - PAN, JH, 0), 0.07);
  strut(tp, V(JIB - PAN, JH, 0), V(JIB, JB + 0.08, 0), 0.07);
  for (let x = J0; x < JIB - 0.01; x += PAN) {
    const x2 = Math.min(x + PAN, JIB), xm = (x + x2) / 2;
    [-JZ, JZ].forEach((z) => {                        // боковые грани
      strut(tp, V(x, JB, z), V(xm, jibTop(xm), 0), 0.035);
      strut(tp, V(xm, jibTop(xm), 0), V(x2, JB, z), 0.035);
    });
    strut(tp, V(x, JB, -JZ), V(x, JB, JZ), 0.035);    // низ: поперечины и диагонали
    strut(tp, V(x, JB, -JZ), V(x2, JB, JZ), 0.03);
  }
  strut(tp, V(JIB, JB, -JZ), V(JIB, JB, JZ), 0.05);

  // противовесная консоль: площадка с перилами
  const CB = 0.13, CZ = 0.3, RAIL = 0.32;
  [-CZ, CZ].forEach((z) => strut(tp, V(-0.4, CB, z), V(-CJ, CB, z), 0.08));
  for (let x = -0.4; x > -CJ + 0.01; x -= 0.38) {
    strut(tp, V(x, CB, -CZ), V(x, CB, CZ), 0.04);
    strut(tp, V(x, CB, -CZ), V(Math.max(x - 0.38, -CJ), CB, CZ), 0.03);
    [-CZ, CZ].forEach((z) => strut(sp, V(x, CB, z), V(x, CB + RAIL, z), 0.025));     // стойки перил
  }
  strut(tp, V(-CJ, CB, -CZ), V(-CJ, CB, CZ), 0.06);
  [-CZ, CZ].forEach((z) => strut(sp, V(-0.4, CB + RAIL, z), V(-CJ, CB + RAIL, z), 0.025));   // перила
  const walk = box(CJ - 0.4, 0.025, CZ * 2 - 0.06, steelMat, false); walk.position.set(-(CJ + 0.4) / 2, CB + 0.03, 0); top.add(walk);

  // оголовок: решётчатая пирамида над поворотным кругом
  const APEX = V(0, 1.35, 0);
  const legs = [[-0.32, -0.3], [0.32, -0.3], [0.32, 0.3], [-0.32, 0.3]].map(([x, z]) => V(x, 0.1, z));
  legs.forEach((p) => strut(tp, p, APEX, 0.065));
  [0.32, 0.62].forEach((k) => {                       // два пояса и диагонали между ними
    const pts = legs.map((p) => p.clone().lerp(APEX, k));
    pts.forEach((p, i) => strut(tp, p, pts[(i + 1) % 4], 0.035));
  });
  legs.forEach((p, i) => strut(tp, p, legs[(i + 1) % 4].clone().lerp(APEX, 0.32), 0.03));
  const head = box(0.16, 0.14, 0.16, steelMat); head.position.copy(APEX); top.add(head);

  // растяжки от оголовка к стреле и к концу консоли
  [JIB * 0.5, JIB - PAN].forEach((x) => strut(sp, APEX, V(x, JH, 0), 0.024));
  [-CZ, CZ].forEach((z) => strut(sp, APEX, V(-CJ + 0.12, CB + RAIL, z), 0.024));
  top.add(mesh(mergeGeometries(tp), craneMat), mesh(mergeGeometries(sp), steelMat));

  // противовес — бетонные плиты, и лебёдка с барабаном
  const cwMat = std("#A7ADB9", { roughness: 0.95 });
  [0, 1, 2].forEach((i) => {
    const s = box(0.17, 0.82, 0.66, cwMat); s.position.set(-CJ + 0.12 + i * 0.19, CB - 0.2, 0); top.add(s);
  });
  const winch = box(0.5, 0.36, 0.46, steelMat); winch.position.set(-1.1, CB + 0.22, 0); top.add(winch);
  const drum = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.44, 16), std("#5B6478", { metalness: 0.7, roughness: 0.35 }));
  drum.rotation.x = Math.PI / 2; drum.position.set(-0.68, CB + 0.17, 0); top.add(drum);

  // табличка с логотипом на перилах консоли — к зрителю
  const plateTex = (() => {
    const c = document.createElement("canvas"); c.width = 512; c.height = 128;
    const g = c.getContext("2d");
    g.fillStyle = "#14307F"; g.fillRect(0, 0, 512, 128);
    g.strokeStyle = "#F5CD30"; g.lineWidth = 10; g.strokeRect(5, 5, 502, 118);
    g.fillStyle = "#FFFFFF"; g.font = "bold 72px Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("∞ INFINITY", 256, 68);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  })();
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.31), new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.6 }));
  plate.position.set(-1.3, CB + 0.2, CZ + 0.02); top.add(plate);

  // кабина крановщика: окна светятся — внутри горит свет
  const cab = new THREE.Group(); cab.position.set(0.5, -0.12, 0.66); top.add(cab);
  cab.add(rbox(0.62, 0.62, 0.5, 0.05, craneMat));
  const cabGlassMat = new THREE.MeshStandardMaterial({ color: "#22355F", emissive: "#FFC98A", emissiveIntensity: 0.32, roughness: 0.12, metalness: 0.4 });
  const cabFront = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.34), cabGlassMat);
  cabFront.position.set(0.312, 0.08, 0); cabFront.rotation.y = Math.PI / 2;
  const cabSide = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.26), cabGlassMat); cabSide.position.set(0.04, 0.1, 0.252);
  const cabRoof = box(0.68, 0.05, 0.56, std("#FFE27A", { roughness: 0.4 })); cabRoof.position.y = 0.335;
  const cabArm = box(0.3, 0.1, 0.3, steelMat); cabArm.position.set(-0.05, 0.25, -0.35);       // кронштейн к платформе
  cab.add(cabFront, cabSide, cabRoof, cabArm);

  // тележка на нижних поясах стрелы
  const trolley = new THREE.Group(); trolley.position.set(REACH, JB - 0.12, 0); top.add(trolley);
  trolley.add(box(0.44, 0.08, 0.62, steelMat));
  [-1, 1].forEach((sx) => [-JZ, JZ].forEach((z) => {
    const w = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 12), steelMat);
    w.rotation.x = Math.PI / 2; w.position.set(sx * 0.14, 0.2, z); trolley.add(w);
  }));
  const sheave = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 14), std("#5B6478", { metalness: 0.7 }));
  sheave.rotation.x = Math.PI / 2; sheave.position.y = -0.08; trolley.add(sheave);

  // красные огни на макушке, конце стрелы и консоли — мигают вместе с огнём на крыше
  const craneLights = [V(0, APEX.y + 0.12, 0), V(JIB + 0.03, JB + 0.1, 0), V(-CJ, CB + RAIL + 0.1, 0)].map((p) => {
    const l = mesh(new THREE.SphereGeometry(0.06, 10, 8), redMat, false); l.position.copy(p);
    const g = glow("#FF4A3A", 0.75, 0); g.position.copy(p);
    top.add(l, g); return g;
  });

  // двойной трос и крюковая обойма в жёлто-чёрную полоску
  const cableMat = std("#2A3145", { metalness: 0.5 });
  const cable = new THREE.Group(); scene.add(cable);
  [-0.06, 0.06].forEach((z) => { const c = mesh(new THREE.CylinderGeometry(0.014, 0.014, 1, 5), cableMat, false); c.position.z = z; cable.add(c); });
  const stripeTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d"); g.fillStyle = "#F5C430"; g.fillRect(0, 0, 64, 64);
    g.fillStyle = "#1D2230";
    for (let i = 0; i < 160; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 16, 0); g.lineTo(i - 48, 64); g.lineTo(i - 64, 64); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const hook = new THREE.Group(); scene.add(hook);
  hook.add(rbox(0.34, 0.3, 0.22, 0.04, new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.45, metalness: 0.2 })));
  [-0.06, 0.06].forEach((z) => {
    const s = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 14), steelMat); s.rotation.x = Math.PI / 2; s.position.set(0, 0.15, z); hook.add(s);
  });
  const hookSteel = std("#8A93A6", { metalness: 0.85, roughness: 0.3 });
  const shank = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 8), hookSteel); shank.position.y = -0.22; hook.add(shank);
  const hookTip = mesh(new THREE.TorusGeometry(0.085, 0.028, 8, 16, Math.PI * 1.45), hookSteel);
  hookTip.position.y = -0.36; hookTip.rotation.z = 1.92; hook.add(hookTip);
  // стропы от крюка к углам этажа, пока его опускают
  const slings = Array.from({ length: 4 }, () => { const s = mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 4), cableMat, false); s.visible = false; scene.add(s); return s; });
  const sA = new THREE.Vector3(), sB = new THREE.Vector3(), sC = new THREE.Vector3();
  const line = (m, a, b) => {                         // натянуть тонкий цилиндр между двумя точками
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.scale.y = a.distanceTo(b);
    m.quaternion.setFromUnitVectors(UP, sB.subVectors(b, a).normalize());
  };
  // высоты в координатах сцены: шкив тележки, верх обоймы, кончик крюка, на сколько крюк выше груза
  const HOOK_TOP = CH + 0.14 + (JB - 0.12) - 0.08, HOOK_CABLE = 0.17, HOOK_TIP = -0.45, ATTACH = 0.95;
  const HOOK_REST = HOOK_TOP - 0.8;

  /* ---------- человечки в стиле Roblox ---------- */
  const S = 0.4;
  const black = std("#151821", { roughness: 0.3 });
  function avatar({ skin, shirt, pants, shoes = "#2A2F3A", hat, vest, suit }) {
    const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
    const skinM = std(skin, { roughness: 0.55 }), shirtM = std(shirt), pantsM = std(pants), shoeM = std(shoes, { roughness: 0.4 });
    const legs = [-1, 1].map((side) => {               // [0] — правая, [1] — левая
      const p = new THREE.Group(); p.position.set(side * 0.5 * S, 2 * S, 0);
      const leg = rbox(0.92 * S, 1.8 * S, 0.92 * S, 0.14 * S, pantsM); leg.position.y = -0.9 * S;
      const shoe = rbox(0.96 * S, 0.32 * S, 1.12 * S, 0.12 * S, shoeM); shoe.position.set(0, -1.84 * S, 0.06 * S);
      p.add(leg, shoe); body.add(p); return p;
    });
    const torso = rbox(2 * S, 2 * S, 1.02 * S, 0.2 * S, shirtM); torso.position.y = 3 * S; body.add(torso);
    if (vest) {
      const v = rbox(2.08 * S, 1.72 * S, 1.1 * S, 0.18 * S, std("#FF7A1A")); v.position.y = 3.05 * S; body.add(v);
      [2.62, 3.22].forEach((y) => { const st = box(2.12 * S, 0.14 * S, 1.13 * S, std("#E8EDF5", { metalness: 0.4, roughness: 0.3 })); st.position.y = y * S; body.add(st); });
    }
    if (suit) {
      const shirtFront = box(0.62 * S, 1.5 * S, 0.04 * S, std("#F4F6FB")); shirtFront.position.set(0, 3.25 * S, 0.52 * S); body.add(shirtFront);
      const tieM = std("#C4281C");
      const knot = box(0.26 * S, 0.2 * S, 0.06 * S, tieM); knot.position.set(0, 3.86 * S, 0.55 * S);
      const tie = box(0.22 * S, 1.05 * S, 0.05 * S, tieM); tie.position.set(0, 3.2 * S, 0.55 * S);
      body.add(knot, tie);
    }
    const arms = [-1, 1].map((side) => {
      const p = new THREE.Group(); p.position.set(side * 1.5 * S, 3.88 * S, 0);
      const sleeve = rbox(0.9 * S, 1.3 * S, 0.9 * S, 0.14 * S, shirtM); sleeve.position.y = -0.62 * S;
      const hand = rbox(0.86 * S, 0.72 * S, 0.86 * S, 0.16 * S, skinM); hand.position.y = -1.6 * S;
      const anchor = new THREE.Object3D(); anchor.position.set(0, -1.95 * S, 0.12 * S);
      p.add(sleeve, hand, anchor); p.userData.anchor = anchor; body.add(p); return p;
    });
    const head = new THREE.Group(); head.position.y = 4 * S; body.add(head);
    const skull = rbox(1.28 * S, 1.2 * S, 1.2 * S, 0.34 * S, skinM); skull.position.y = 0.64 * S; head.add(skull);
    const eyes = [-1, 1].map((side) => {
      const eye = mesh(new THREE.SphereGeometry(0.1 * S, 10, 8), black, false);
      eye.scale.set(1, 1.5, 0.45); eye.position.set(side * 0.27 * S, 0.74 * S, 0.6 * S); head.add(eye);
      return eye;
    });
    const smile = mesh(new THREE.TorusGeometry(0.27 * S, 0.045 * S, 6, 20, Math.PI), black, false);
    smile.rotation.z = Math.PI; smile.position.set(0, 0.56 * S, 0.6 * S); head.add(smile);
    if (hat === "hardhat") {
      const hm = std("#FFD21F", { roughness: 0.35 });
      const dome = mesh(new THREE.SphereGeometry(0.74 * S, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), hm); dome.position.y = 1.18 * S;
      const brim = mesh(new THREE.CylinderGeometry(0.86 * S, 0.86 * S, 0.07 * S, 28), hm); brim.position.set(0, 1.19 * S, 0.1 * S);
      const ridge = box(0.16 * S, 0.12 * S, 1.3 * S, hm); ridge.position.set(0, 1.86 * S, 0);
      head.add(dome, brim, ridge);
    }
    if (hat === "fedora") {
      const fm = std("#1D2433", { roughness: 0.7 });
      const brim = mesh(new THREE.CylinderGeometry(1.02 * S, 1.02 * S, 0.06 * S, 32), fm); brim.position.y = 1.22 * S;
      const crown = mesh(new THREE.CylinderGeometry(0.56 * S, 0.66 * S, 0.66 * S, 28), fm); crown.position.y = 1.57 * S;
      const band = mesh(new THREE.CylinderGeometry(0.665 * S, 0.665 * S, 0.13 * S, 28), std("#7A1F1A")); band.position.y = 1.33 * S;
      head.add(brim, crown, band);
    }
    root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return { root, body, legs, arms, head, eyes };
  }

  const builderA = avatar({ skin: "#F5CD30", shirt: "#2D6FD0", pants: "#33486E", hat: "hardhat", vest: true });
  const builderB = avatar({ skin: "#E0A878", shirt: "#3FA05A", pants: "#33486E", hat: "hardhat", vest: true });
  const client = avatar({ skin: "#F5CD30", shirt: "#1E2B52", pants: "#1E2B52", shoes: "#151821", hat: "fedora", suit: true });
  scene.add(builderA.root, builderB.root, client.root);

  // молоток у строителя
  const hammer = new THREE.Group();
  const handle = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 8), std("#8A5A32")); handle.position.y = -0.2;
  const hHead = box(0.26, 0.11, 0.11, std("#6E7687", { metalness: 0.8, roughness: 0.3 })); hHead.position.y = -0.46;
  hammer.add(handle, hHead); hammer.rotation.x = -Math.PI / 2;     // молоток смотрит вперёд
  builderA.arms[0].userData.anchor.add(hammer);

  // портфель клиента
  const briefcase = new THREE.Group();
  briefcase.add(shadowed(rbox(0.5, 0.36, 0.14, 0.04, std("#6B3F22", { roughness: 0.5 }))));
  const bh = mesh(new THREE.TorusGeometry(0.08, 0.018, 6, 12, Math.PI), std("#3B2414")); bh.position.y = 0.18; briefcase.add(bh);
  briefcase.position.set(0, -0.1, 0.05); briefcase.rotation.y = Math.PI / 2;
  client.arms[0].userData.anchor.add(briefcase);

  // мешок денег
  const bag = new THREE.Group();
  const sack = mesh(new THREE.SphereGeometry(0.3, 20, 14), std("#B8875A", { roughness: 0.9 })); sack.scale.set(1, 1.1, 0.9);
  const tieRing = mesh(new THREE.TorusGeometry(0.1, 0.03, 6, 14), std("#6B4A2B")); tieRing.rotation.x = Math.PI / 2; tieRing.position.y = 0.3;
  const neck = mesh(new THREE.ConeGeometry(0.13, 0.22, 10), std("#B8875A", { roughness: 0.9 })); neck.position.y = 0.42; neck.rotation.x = Math.PI;
  const dollarTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d"); g.fillStyle = "#2E7D32"; g.font = "bold 96px Arial, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("$", 64, 70);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const dollar = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), new THREE.MeshStandardMaterial({ map: dollarTex, transparent: true, roughness: 0.8 }));
  dollar.position.set(0, -0.02, 0.275);
  bag.add(sack, tieRing, neck, dollar); bag.visible = false; scene.add(bag);

  // монеты: летящие и горка возле клиента
  const coinGeo = new THREE.CylinderGeometry(0.21, 0.21, 0.055, 28);
  const goldMat = std("#F2C14E", { metalness: 0.85, roughness: 0.28, emissive: "#5A3D00", emissiveIntensity: 0.25 });
  const flying = Array.from({ length: 8 }, () => { const c = mesh(coinGeo, goldMat); c.visible = false; scene.add(c); return { mesh: c, t0: -1 }; });
  const PILE_MAX = 45;
  const pile = new THREE.InstancedMesh(coinGeo, goldMat, PILE_MAX); pile.count = 0; pile.castShadow = true; scene.add(pile);
  const sparkles = Array.from({ length: 6 }, () => { const s = glow("#FFF6D8", 0.35, 0); scene.add(s); return s; });

  // пыль, когда этаж встаёт на место
  const dust = Array.from({ length: 10 }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: "#AEB7CB", transparent: true, opacity: 0, depthWrite: false }));
    scene.add(s); return s;
  });

  // готовые игры вылетают из студии: цветные иконки с кнопкой «играть»
  const playShape = new THREE.Shape();
  playShape.moveTo(-0.07, -0.095); playShape.lineTo(0.1, 0); playShape.lineTo(-0.07, 0.095); playShape.closePath();
  const playGeo = new THREE.ShapeGeometry(playShape);
  playGeo.scale(1.45, 1.45, 1);
  const tileGeo = new RoundedBoxGeometry(0.68, 0.68, 0.12, 3, 0.13);
  const games = ["#FF5A4E", "#2FB65A", "#3D8BFF", "#F5C430", "#B05CFF", "#FF8A2A"].map((c) => {
    const g = new THREE.Group();
    const tile = new THREE.Mesh(tileGeo, new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.45, roughness: 0.35, transparent: true }));
    const play = new THREE.Mesh(playGeo, new THREE.MeshBasicMaterial({ color: "#FFFFFF", transparent: true }));
    play.position.z = 0.062;
    g.add(tile, play); g.visible = false; scene.add(g);
    return { g, mats: [tile.material, play.material] };
  });
  const gameDir = [-1, 0.4, -0.4, 1, -0.7, 0.7];        // в какую сторону летит каждая иконка

  // светлячки у деревьев
  const flies = [[-4.5, 1.6], [-3.1, 4.1], [4.4, -1.9], [-4.4, -2.6], [2.9, 4.9], [-5.1, 2.6], [5.3, 0.4], [-2.3, 2.3], [1.4, -4.8], [3.8, 3.4]]
    .map(([x, z]) => { const s = glow("#E9FF9E", 0.26, 0); s.userData = { x, z, ph: rnd() * 6.28 }; scene.add(s); return s; });

  /* ---------- расстановка и сценарий ---------- */
  // клиент и строитель встают друг напротив друга поперёк взгляда камеры — видно лица в три четверти
  const clientPos = new THREE.Vector3(4.0, 0, 1.95);
  const pileCenter = new THREE.Vector3(4.75, 0, 1.1);
  const A0 = new THREE.Vector3(-1.15, 0, 2.6), A1 = new THREE.Vector3(2.9, 0, 3.0);
  const B0 = new THREE.Vector3(1.75, 0, 2.3), B1 = new THREE.Vector3(1.75, 0, 3.95);   // встанет левее, не закрывая остальных
  const faceTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
  const toCam = (from, dir, k = 0.5) => {            // смотреть на собеседника, чуть развернувшись к зрителю
    const d = new THREE.Vector2(dir.x - from.x, dir.z - from.z).normalize();
    return Math.atan2(d.x + k * Math.SQRT1_2, d.y + k * Math.SQRT1_2);
  };
  client.root.position.copy(clientPos);
  const CLIENT_YAW = toCam(clientPos, A1);
  client.root.rotation.y = CLIENT_YAW;

  const T = { build: 0.7, piece: 0.7 };
  T.done = T.build + pieces.length * T.piece;
  T.lights = T.done + 0.15;
  T.walk = T.lights + 1.0;
  T.give = T.walk + 1.5;
  T.coins = T.give + 0.8;
  const END = T.coins + 4;
  const LOOP = END + 11;                              // потом плавно гаснет и строится заново
  const G_EVERY = 0.85, G_LIFE = 2.4;                 // иконки игр: как часто вылетают и сколько живут
  const CAM_YAW = Math.atan2(camOffset.x, camOffset.z);
  // шаг подобран так, чтобы ноги остановились ровно, без рывка
  const STRIDE_A = (8 * Math.PI) / A0.distanceTo(A1), STRIDE_B = (3 * Math.PI) / B0.distanceTo(B1);

  const coinStart = new THREE.Vector3(0.2, 0.75, W / 2 + 0.35);
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), look = new THREE.Vector3(), mtx = new THREE.Matrix4(), q = new THREE.Quaternion();
  let total = 0, lastCoin = -1;
  const fmt = () => new Intl.NumberFormat({ en: "en-US", uk: "uk-UA" }[document.documentElement.lang] || "ru-RU").format(total);

  function pose(av, { walk = 0, armR = null, armL = null, bob = 0, lean = 0 }) {
    const sw = Math.sin(walk) * 0.65;
    av.legs[0].rotation.x = sw; av.legs[1].rotation.x = -sw;
    av.arms[0].rotation.set(armR ? armR[0] : -sw * 0.8, 0, armR ? armR[1] : 0);
    av.arms[1].rotation.set(armL ? armL[0] : sw * 0.8, 0, armL ? armL[1] : 0);
    av.body.position.y = bob;
    av.body.rotation.x = lean;                        // при ходьбе чуть наклоняется вперёд
  }

  function blink(av, t, ph) {                         // моргают раз в несколько секунд
    const closed = (t + ph) % 3.3 < 0.12;
    av.eyes.forEach((e) => { e.scale.y = closed ? 0.25 : 1.5; });
  }

  function addPileCoin() {
    if (pile.count >= PILE_MAX) return;
    const i = pile.count, stack = i % 3, h = Math.floor(i / 3);
    const off = [[0, 0], [0.46, 0.12], [-0.1, 0.46]][stack];
    q.setFromAxisAngle(UP, rnd() * Math.PI);
    mtx.compose(tmpA.set(pileCenter.x + off[0] + (rnd() - 0.5) * 0.04, 0.035 + h * 0.057, pileCenter.z + off[1] + (rnd() - 0.5) * 0.04), q, tmpB.set(1, 1, 1));
    pile.setMatrixAt(i, mtx); pile.count = i + 1; pile.instanceMatrix.needsUpdate = true;
  }

  function update(t, dt) {
    // камера медленно покачивается, а остров плавно «парит» вверх-вниз
    const sway = Math.sin(t * 0.17) * 0.09, float = Math.sin(t * 0.8) * 0.16;
    camera.position.copy(camOffset).applyAxisAngle(UP, sway).add(target);
    camera.position.y -= float;
    camera.lookAt(look.copy(target).setY(target.y - float));

    // стройка: кран опускает этажи один за другим
    let hookY = HOOK_REST, holding = null, holdK = 1, landed = null;
    pieces.forEach((p, i) => {
      const t0 = T.build + i * T.piece;
      const startY = HOOK_REST - ATTACH - p.userData.height;      // этаж появляется, уже висящий на крюке
      if (t < t0) { p.visible = false; return; }
      p.visible = true;
      const k = clamp01((t - t0) / (T.piece * 0.62));
      p.position.y = lerp(startY, p.userData.targetY, easeOut(k));
      p.scale.setScalar(t - t0 < 0.08 ? 0.6 + 5 * (t - t0) : 1);
      const sq = t - (t0 + T.piece * 0.62);            // этаж встал на место: лёгкий «бум» и пыль
      if (sq > 0 && sq < 0.3) { const s = Math.sin((sq / 0.3) * Math.PI); p.scale.set(1 + 0.03 * s, 1 - 0.09 * s, 1 + 0.03 * s); }
      if (sq >= 0 && sq < 0.8) landed = { y: p.userData.targetY, k: sq / 0.8 };
      if (t < t0 + T.piece) {
        holding = p; holdK = k;
        const attach = p.position.y + p.userData.height + ATTACH;
        const r = clamp01((t - t0 - T.piece * 0.62) / (T.piece * 0.38));
        hookY = k < 1 ? attach : lerp(attach, HOOK_REST, easeInOut(r));
      }
    });
    dust.forEach((d, i) => {
      if (!landed) { d.material.opacity = 0; return; }
      const a = (i / dust.length) * Math.PI * 2 + 0.3, k = landed.k, r = W / 2 + 0.2 + 0.9 * easeOut(k);
      d.position.set(Math.cos(a) * r, landed.y + 0.1 + 0.35 * k, Math.sin(a) * r);
      d.scale.setScalar(0.7 + 1.4 * k);
      d.material.opacity = 0.8 * (1 - k);
    });
    // стройка закончена: тележка откатывается к мачте, крюк поднимается — не висит над знаком ∞
    const park = easeInOut(clamp01((t - T.done - 0.3) / 1.4));
    trolley.position.x = lerp(REACH, REACH * 0.45, park);
    if (t > T.done) hookY = lerp(HOOK_REST, HOOK_TOP - 0.4, park);
    hook.position.set(0, hookY, 0);
    const cableLen = HOOK_TOP - (hookY + HOOK_CABLE);
    cable.position.set(0, hookY + HOOK_CABLE + cableLen / 2, 0); cable.scale.y = Math.max(cableLen, 0.01);
    top.rotation.y = JIB_YAW + (t > T.done + 0.5 ? Math.sin((t - T.done) * 0.5) * 0.05 * clamp01(t - T.done - 0.5) : 0);
    hook.rotation.y = cable.rotation.y = top.rotation.y;   // обойма и тросы развёрнуты вдоль стрелы
    if (t > T.done) {                                 // после стройки трос идёт за стрелой
      top.updateMatrixWorld(true);
      trolley.getWorldPosition(tmpA);
      hook.position.x = tmpA.x; hook.position.z = tmpA.z;
      cable.position.x = tmpA.x; cable.position.z = tmpA.z;
    }
    // стропы: пока этаж опускают, он висит на четырёх тросах от крюка к углам
    const slung = holding && holdK < 1;
    slings.forEach((s, i) => {
      s.visible = slung;
      if (!slung) return;
      const c = (W / 2) * 0.8, top2 = holding.position.y + holding.userData.height * holding.scale.y;
      sA.set(hook.position.x, hookY + HOOK_TIP, hook.position.z);
      sC.set(i < 2 ? -c : c, top2, i % 2 ? -c : c);
      line(s, sA, sC);
    });
    const blinkOn = Math.sin(t * 3.2) > 0.55;           // красные огни крана мигают вместе с огнём на крыше
    craneLights.forEach((g) => { g.material.opacity = blinkOn ? 0.85 : 0.08; });

    // свет в окнах, знак на крыше, искры
    const L = easeInOut(clamp01((t - T.lights) / 0.9));
    panes.forEach((p) => { p.visible = t > T.lights + p.userData.delay; });   // окна зажигаются снизу вверх
    door.material.emissiveIntensity = 1.2 * L;
    signMat.emissiveIntensity = 0.25 + 3.2 * L;
    const sk = clamp01((t - T.lights) / 0.7);              // знак ∞ вырастает с пружинкой
    const back = sk < 1 ? 1 + 2.7 * Math.pow(sk - 1, 3) + 1.7 * Math.pow(sk - 1, 2) : 1;
    sign.visible = sk > 0; signPosts.forEach((p) => (p.visible = sk > 0));
    sign.scale.setScalar(0.95 * Math.max(back, 0.001));
    signGlow.material.opacity = 0.85 * L;
    towerGlow.material.opacity = 0.2 * L;
    redMat.emissiveIntensity = Math.sin(t * 3.2) > 0.55 ? 3 : 0.25;
    sparkles.forEach((s, i) => {
      const k = clamp01((t - T.lights - i * 0.08) / 1.1);
      const a = i / sparkles.length * Math.PI * 2 + 0.4;
      s.position.set(Math.cos(a) * (0.6 + 1.6 * k), roof.userData.targetY + 1.3 + Math.sin(a) * 0.8 * k + 0.6 * k, Math.sin(a) * (0.6 + 1.6 * k));
      s.material.opacity = k > 0 && k < 1 ? 0.8 * Math.sin(k * Math.PI) : 0;
      s.scale.setScalar(0.2 + 0.4 * Math.sin(k * Math.PI));
    });

    // из готовой студии одна за другой вылетают игры
    const gameY = roof.userData.targetY + 0.95;            // ниже стрелы крана, чтобы иконки не путались с ней
    games.forEach((gm, i) => {
      const local = t - T.lights - 0.9 - i * G_EVERY;
      const ph = local >= 0 ? local % (games.length * G_EVERY) : -1;
      if (ph < 0 || ph > G_LIFE) { gm.g.visible = false; return; }
      // летят к зрителю веером, в сторону от стрелы
      const k = ph / G_LIFE, a = Math.atan2(camOffset.z, camOffset.x) + gameDir[i] * 0.75, r = 0.35 + 1.9 * k;
      gm.g.visible = true;
      gm.g.position.set(Math.cos(a) * r, gameY + 1.15 * k, Math.sin(a) * r);
      gm.g.rotation.set(0, CAM_YAW + Math.sin(t * 2 + i) * 0.35, Math.sin(t * 1.6 + i) * 0.12);
      gm.g.scale.setScalar(0.35 + 0.65 * easeOut(clamp01(k / 0.2)));
      const op = Math.max(0, Math.min(1, k / 0.12, (1 - k) / 0.3));
      gm.mats.forEach((mm) => { mm.opacity = op; });
    });

    // светлячки
    flies.forEach((f, i) => {
      const { x, z, ph } = f.userData;
      f.position.set(x + Math.sin(t * 0.5 + ph) * 0.55, 0.7 + (i % 3) * 0.35 + Math.sin(t * 0.8 + ph * 2) * 0.45, z + Math.cos(t * 0.43 + ph) * 0.55);
      f.material.opacity = Math.max(0, Math.sin(t * 1.7 + ph * 3)) * 0.9;
    });

    // строитель A: стучит молотком → берёт мешок денег → несёт клиенту → отдаёт
    const breathe = (ph) => Math.sin(t * 2.2 + ph) * 0.012;
    if (t < T.walk) {
      builderA.root.position.copy(A0); builderA.root.rotation.y = Math.PI;
      const hit = t < T.lights ? Math.sin(t * 9) : -1;
      pose(builderA, { armR: [-1.0 + hit * 0.55, 0], armL: [-0.2, 0], bob: breathe(0) });
      hammer.visible = true;
    } else if (t < T.give) {
      const k = easeInOut(clamp01((t - T.walk) / (T.give - T.walk - 0.2)));
      builderA.root.position.lerpVectors(A0, A1, k);
      builderA.root.rotation.y = k < 1 ? faceTo(A0, A1) : toCam(A1, clientPos);
      const step = A0.distanceTo(A1) * k * STRIDE_A;    // шаги идут вместе с движением — ноги не скользят
      pose(builderA, { walk: step, armR: [-0.5, 0], bob: k < 1 ? Math.abs(Math.sin(step)) * 0.06 : breathe(0), lean: k < 1 ? 0.1 : 0 });
      hammer.visible = false;
    } else {
      builderA.root.position.copy(A1); builderA.root.rotation.y = toCam(A1, clientPos);
      const g = clamp01((t - T.give) / 0.5);
      const cheer = t > T.give + 0.9;
      pose(builderA, cheer
        ? { armR: [0, -2.7 + Math.sin(t * 7) * 0.25], armL: [0, 2.7 - Math.sin(t * 7) * 0.25], bob: Math.abs(Math.sin(t * 6)) * 0.06 }
        : { armR: [lerp(-0.5, -1.35, easeOut(g)), 0], armL: [0, 0], bob: breathe(0) });
      hammer.visible = false;
    }

    // строитель B: машет крановщику → идёт к клиенту → радуется
    if (t < T.walk) {
      builderB.root.position.copy(B0); builderB.root.rotation.y = faceTo(B0, new THREE.Vector3(-1, 0, -2));
      const wave = t < T.lights ? Math.sin(t * 6) * 0.35 : 0;
      pose(builderB, { armR: [0, -2.45 + wave], armL: [-0.15, 0], bob: breathe(1) });
    } else {
      const k = easeInOut(clamp01((t - T.walk - 0.2) / 1.1));
      builderB.root.position.lerpVectors(B0, B1, k);
      builderB.root.rotation.y = k < 1 ? faceTo(B0, B1) : faceTo(B1, new THREE.Vector3(B1.x + 1, 0, B1.z + 1.4));
      const cheer = t > T.give + 0.6;
      const step = B0.distanceTo(B1) * k * STRIDE_B;
      pose(builderB, k < 1
        ? { walk: step, bob: Math.abs(Math.sin(step)) * 0.06, lean: 0.1 }
        : cheer ? { armR: [0, -2.6 + Math.sin(t * 6 + 1) * 0.3], armL: [0, 2.6 - Math.sin(t * 6 + 1) * 0.3], bob: Math.abs(Math.sin(t * 6 + 1)) * 0.06 }
                : { bob: breathe(1) });
    }

    // клиент: смотрит на стройку, получает мешок, подпрыгивает и поднимает его над головой
    const kBag = easeInOut(clamp01((t - T.give - 0.15) / 0.45));
    const jt = t - (T.give + 0.7), jumping = jt > 0 && jt < 1.4;
    const raise = jt <= 0 ? 0 : jt < 1.4 ? easeOut(clamp01(jt / 0.25)) : 1 - easeInOut(clamp01((jt - 1.4) / 0.5));
    pose(client, {
      armR: [lerp(-0.12, -0.55, raise), 0],
      armL: [lerp(lerp(0, -0.75, kBag), -2.6, raise), lerp(0.05 * (1 - kBag), 0.65, raise)],   // вверх и в сторону
      bob: jumping ? Math.abs(Math.sin((jt / 0.7) * Math.PI)) * 0.3 : jt > 0 ? Math.abs(Math.sin(t * 5)) * 0.04 : breathe(2),
    });
    client.head.rotation.y = t < T.walk ? Math.sin(t * 0.6) * 0.15 : 0;
    // получив мешок, поворачивается к зрителю — показать его, как трофей
    client.root.rotation.y = lerp(CLIENT_YAW, CAM_YAW, easeInOut(clamp01(jt / 0.35)));
    blink(builderA, t, 0); blink(builderB, t, 1.4); blink(client, t, 2.3);

    // мешок: у строителя → летит в руку клиента
    scene.updateMatrixWorld(true);
    if (t >= T.walk - 0.1) {
      bag.visible = true;
      builderA.arms[0].userData.anchor.getWorldPosition(tmpA);
      client.arms[1].userData.anchor.getWorldPosition(tmpB);
      const k = easeInOut(clamp01((t - T.give - 0.15) / 0.45));
      bag.position.lerpVectors(tmpA, tmpB, k);
      bag.position.y += lerp(-0.28, 0.3, raise);          // поднятый мешок — в руке над плечом, лицо не закрывает
      bag.rotation.y = lerp(builderA.root.rotation.y, client.root.rotation.y, k);
      const pop = clamp01((t - T.walk + 0.1) / 0.25);
      bag.scale.setScalar(0.4 + 0.6 * easeOut(pop));
    } else bag.visible = false;

    // монеты летят из здания в горку клиента, счётчик растёт
    if (t > T.coins && t - lastCoin > 0.5) {
      const slot = flying.find((c) => c.t0 < 0);
      if (slot) { slot.t0 = t; slot.mesh.visible = true; lastCoin = t; }
    }
    flying.forEach((c) => {
      if (c.t0 < 0) return;
      const k = (t - c.t0) / 1.0;
      if (k >= 1) {
        c.t0 = -1; c.mesh.visible = false;
        addPileCoin(); total += 250;
        if (badge) { badge.textContent = `$ ${fmt()}`; badge.classList.remove("bump"); void badge.offsetWidth; badge.classList.add("bump"); }
        return;
      }
      const end = tmpA.set(pileCenter.x, 0.1 + Math.floor(pile.count / 3) * 0.057, pileCenter.z);
      const mid = tmpB.set((coinStart.x + end.x) / 2, 3.4, (coinStart.z + end.z) / 2);
      const u = 1 - k;
      c.mesh.position.set(
        u * u * coinStart.x + 2 * u * k * mid.x + k * k * end.x,
        u * u * coinStart.y + 2 * u * k * mid.y + k * k * end.y,
        u * u * coinStart.z + 2 * u * k * mid.z + k * k * end.z
      );
      c.mesh.rotation.set(Math.PI / 2 * (1 - k), t * 9, 0);
    });

    // табличка с суммой над клиентом
    if (badge) {
      badge.classList.toggle("on", t > T.give + 2.5);   // когда клиент опустил мешок — табличка его не заслоняет
      tmpA.copy(clientPos).add(tmpB.set(0, 2.55, 0)).project(camera);
      badge.style.transform = `translate(${((tmpA.x + 1) / 2) * host.clientWidth}px, ${((1 - tmpA.y) / 2) * host.clientHeight}px) translate(-50%, -100%)`;
    }
  }

  /* ---------- размер, запуск, пауза вне экрана ---------- */
  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 0.9 ? 36 : 32;              // запас сверху — чтобы влез оголовок крана
    camera.updateProjectionMatrix();
  }
  resize();
  new ResizeObserver(() => { resize(); if (reduce || still !== null) render(still ?? END); }).observe(host);

  // для проверки кадров: ?t=8 — играть с 8-й секунды, ?still=9.9 — один застывший кадр
  const params = new URLSearchParams(location.search);
  const startAt = Number(params.get("t")) || 0;
  const still = params.has("still") ? Number(params.get("still")) : null;
  function render(t) { update(t, 0); renderer.render(scene, camera); }

  if (reduce || still !== null) {
    for (let i = 0; i < 18; i++) addPileCoin();
    total = 0;
    if (badge) badge.textContent = "$ ∞";
    render(still ?? END);
    host.classList.add("ready");
    return;
  }

  function restart() {                               // новый круг: стройка заново, сумма денег копится дальше
    pile.count = 0; pile.instanceMatrix.needsUpdate = true;
    flying.forEach((c) => { c.t0 = -1; c.mesh.visible = false; });
    lastCoin = -1;
  }

  let time = startAt, last = performance.now(), visible = true;
  if ("IntersectionObserver" in window) new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(host);
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05); last = now;
    if (!visible || document.hidden) return;
    time += dt;
    if (time > LOOP - 0.9) host.classList.add("fading");   // CSS плавно гасит сцену за 0.9 с
    if (time > LOOP) { time = 0; restart(); host.classList.remove("fading"); }
    update(time, dt);
    renderer.render(scene, camera);
  }
  render(time);
  host.classList.add("ready");
  requestAnimationFrame(frame);
})();
