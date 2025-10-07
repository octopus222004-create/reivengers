// script.js (paste exactly)
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.152.2/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.152.2/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.152.2/examples/jsm/loaders/GLTFLoader.js';

/*
 * Config - put card.glb and lanyard.png in same repo root as index.html
 */
const CARD_GLB = './card.glb';
const LANYARD_PNG = './lanyard.png';

/* Basic scene + renderer */
const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
renderer.outputEncoding = THREE.sRGBEncoding;

const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(28, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
camera.position.set(0, 1.6, 6);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.enableZoom = false;
controls.enableRotate = false;

/* Lights */
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.0));
const dir = new THREE.DirectionalLight(0xffffff, 1.1);
dir.position.set(-1, 3, 4);
scene.add(dir);

/* Helpers to create gradient texture (red->orange) used as fallback or hover */
function createGradientTexture(w = 512, h = 32) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#ff3b3b'); // red
  grad.addColorStop(1, '#ff8a00'); // orange
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  // subtle noise
  ctx.globalAlpha = 0.05;
  for (let i=0;i<2000;i++) ctx.fillRect(Math.random()*w, Math.random()*h, 1, 1);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1.5, 1);
  t.encoding = THREE.sRGBEncoding;
  return t;
}
const hoverGradient = createGradientTexture();

/* Rope (verlet) implementation for natural band motion */
class Rope {
  constructor(parts, start, end) {
    this.parts = parts;
    this.positions = new Array(parts);
    this.old = new Array(parts);
    this.acc = new Array(parts).fill(0).map(()=>new THREE.Vector3());
    this.fixed = new Array(parts).fill(false);
    for (let i=0;i<parts;i++){
      const t = i/(parts-1);
      const pos = new THREE.Vector3().lerpVectors(start, end, t);
      this.positions[i] = pos.clone();
      this.old[i] = pos.clone();
    }
    this.fixed[0] = true; // top anchor fixed
    this.length = start.distanceTo(end) / (parts-1);
    this.iterations = 6;
  }
  applyGravity(g){
    for (let i=0;i<this.parts;i++){
      if (!this.fixed[i]) this.acc[i].addScaledVector(g, 1);
    }
  }
  verlet(dt){
    const dt2 = dt*dt;
    for (let i=0;i<this.parts;i++){
      if (this.fixed[i]) continue;
      const p = this.positions[i];
      const o = this.old[i];
      const tmp = p.clone();
      p.add(p.clone().sub(o).multiplyScalar(0.985)).add(this.acc[i].clone().multiplyScalar(dt2));
      this.old[i].copy(tmp);
      this.acc[i].set(0,0,0);
    }
  }
  satisfy() {
    for (let k=0;k<this.iterations;k++){
      for (let i=0;i<this.parts-1;i++){
        const a = this.positions[i];
        const b = this.positions[i+1];
        const delta = b.clone().sub(a);
        const dist = delta.length() || 1e-6;
        const diff = (dist - this.length)/dist;
        if (this.fixed[i] && this.fixed[i+1]) continue;
        if (this.fixed[i]) b.addScaledVector(delta, -diff);
        else if (this.fixed[i+1]) a.addScaledVector(delta, diff);
        else { a.addScaledVector(delta, diff*0.5); b.addScaledVector(delta, -diff*0.5); }
      }
    }
  }
  pin(i, pos){
    this.positions[i].copy(pos);
    this.old[i].copy(pos);
  }
}

/* band mesh - TubeGeometry along the rope */
const ROPE_PARTS = 36;
const BAND_THICKNESS = 0.05;
let bandMesh;
const bandMat = new THREE.MeshPhysicalMaterial({
  map: null, transmission: 0.0, clearcoat: 0.4, clearcoatRoughness: 0.12,
  roughness: 0.6, metalness: 0.15, side: THREE.DoubleSide, transparent: true, opacity: 0.98
});

function createBandMesh(curvePoints){
  const curve = new THREE.CatmullRomCurve3(curvePoints);
  const geom = new THREE.TubeGeometry(curve, Math.max(32, ROPE_PARTS*3), BAND_THICKNESS, 12, false);
  if (bandMesh) { bandMesh.geometry.dispose(); bandMesh.geometry = geom; }
  else { bandMesh = new THREE.Mesh(geom, bandMat); scene.add(bandMesh); }
}

/* Rope initial positions */
const start = new THREE.Vector3(0, 2.4, 0);
const endInit = new THREE.Vector3(0.6, 0.2, 0);
const rope = new Rope(ROPE_PARTS, start, endInit);
createBandMesh(rope.positions);

/* Loaders and asset handling */
const texLoader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();

let lanyardTexture = null;
texLoader.load(LANYARD_PNG, tex=>{
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.5,1);
  tex.encoding = THREE.sRGBEncoding;
  lanyardTexture = tex;
  bandMat.map = lanyardTexture;
  bandMat.needsUpdate = true;
}, undefined, err=>{
  // fallback uses generated gradient
  bandMat.map = hoverGradient;
  bandMat.needsUpdate = true;
});

let cardGroup = null;
let cardMesh = null;
gltfLoader.load(CARD_GLB, gltf=>{
  cardGroup = gltf.scene;
  // normalize scale to fit
  const box = new THREE.Box3().setFromObject(cardGroup);
  const size = new THREE.Vector3(); box.getSize(size);
  const s = 1.6 / Math.max(size.x, size.y, size.z);
  cardGroup.scale.setScalar(s);
  box.setFromObject(cardGroup);
  const center = box.getCenter(new THREE.Vector3());
  cardGroup.position.sub(center.multiplyScalar(s));
  cardGroup.position.set(0.6, 0.05, 0);
  cardGroup.rotation.y = 0.12;
  // pick first mesh for raycasting
  cardGroup.traverse(c=>{ if (c.isMesh && !cardMesh) { cardMesh = c; c.material.side = THREE.DoubleSide; }});
  scene.add(cardGroup);
  // attach rope end
  rope.pin(rope.parts-1, new THREE.Vector3(cardGroup.position.x, cardGroup.position.y + 0.15, cardGroup.position.z));
}, undefined, err=>{
  // fallback: create a simple card plane
  const geom = new THREE.BoxGeometry(1.6, 1.0, 0.04);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.08, roughness: 0.4 });
  const placeholder = new THREE.Mesh(geom, mat);
  placeholder.position.set(0.6, 0.0, 0);
  scene.add(placeholder);
  cardGroup = placeholder;
  cardMesh = placeholder;
  rope.pin(rope.parts-1, new THREE.Vector3(0.6, 0.1, 0));
});

/* Pointer interactions */
const ray = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let dragging = false;
let dragOffset = new THREE.Vector3();
let hovered = false;

function getPointerWorld(clientX, clientY, zPlane = 0){
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((clientX - rect.left)/rect.width)*2 - 1;
  pointer.y = -((clientY - rect.top)/rect.height)*2 + 1;
  ray.setFromCamera(pointer, camera);
  const dir = ray.ray.direction.clone();
  const t = (zPlane - ray.ray.origin.z) / (dir.z || 1e-6);
  return ray.ray.origin.clone().add(dir.multiplyScalar(t));
}

function onDown(e){
  if (!cardMesh) return;
  const pos = getPointerWorld(e.clientX, e.clientY, cardGroup.position.z);
  ray.setFromCamera(pointer, camera);
  const hits = ray.intersectObject(cardMesh, true);
  if (hits.length) {
    dragging = true;
    dragOffset.copy(hits[0].point).sub(cardGroup.position);
    renderer.domElement.style.cursor = 'grabbing';
  }
}
function onMove(e){
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left)/rect.width)*2 - 1;
  pointer.y = -((e.clientY - rect.top)/rect.height)*2 + 1;

  if (dragging) {
    const planePos = getPointerWorld(e.clientX, e.clientY, cardGroup.position.z);
    const target = planePos.clone().sub(dragOffset);
    cardGroup.position.lerp(target, 0.35);
    rope.pin(rope.parts-1, new THREE.Vector3(cardGroup.position.x, cardGroup.position.y + 0.15, cardGroup.position.z));
  } else {
    if (!cardMesh) return;
    ray.setFromCamera(pointer, camera);
    const inter = ray.intersectObject(cardMesh, true);
    if (inter.length && !hovered) {
      hovered = true;
      renderer.domElement.style.cursor = 'grab';
      // change band to glass gradient on hover
      bandMat.map = hoverGradient;
      bandMat.transmission = 0.6;
      bandMat.roughness = 0.06;
      bandMat.opacity = 0.96;
      bandMat.needsUpdate = true;
    } else if (!inter.length && hovered) {
      hovered = false;
      renderer.domElement.style.cursor = 'auto';
      bandMat.map = lanyardTexture || hoverGradient;
      bandMat.transmission = 0.0;
      bandMat.roughness = 0.6;
      bandMat.opacity = 0.98;
      bandMat.needsUpdate = true;
    }
  }
}
function onUp(){ if (dragging) { dragging = false; renderer.domElement.style.cursor = 'auto'; } }

renderer.domElement.addEventListener('pointerdown', onDown);
window.addEventListener('pointermove', onMove);
window.addEventListener('pointerup', onUp);

/* Animation loop */
const clock = new THREE.Clock();
function updateBandGeometry(){
  // rebuild the tube geometry along rope positions
  const pts = rope.positions.map(p=>p.clone());
  const c = new THREE.CatmullRomCurve3(pts);
  const newGeom = new THREE.TubeGeometry(c, Math.max(32, ROPE_PARTS*3), BAND_THICKNESS, 12, false);
  if (bandMesh) { bandMesh.geometry.dispose(); bandMesh.geometry = newGeom; }
  else { bandMesh = new THREE.Mesh(newGeom, bandMat); scene.add(bandMesh); }
}

function animate(){
  const dt = Math.min(clock.getDelta(), 0.033);
  // simple physics
  rope.applyGravity(new THREE.Vector3(0, -9.8, 0).multiplyScalar(0.12));
  rope.verlet(dt);
  rope.pin(0, new THREE.Vector3(0, 2.4, 0)); // top anchor
  if (cardGroup) rope.pin(rope.parts-1, new THREE.Vector3(cardGroup.position.x, cardGroup.position.y + 0.15, cardGroup.position.z));
  rope.satisfy();
  updateBandGeometry();

  // small card rotation based on rope motion
  if (cardGroup) {
    const pPrev = rope.positions[Math.max(0, rope.parts-2)];
    const pLast = rope.positions[rope.parts-1];
    const dir = pLast.clone().sub(pPrev).normalize();
    const targetY = Math.atan2(dir.x, dir.y) * 0.14;
    cardGroup.rotation.y = THREE.MathUtils.lerp(cardGroup.rotation.y||0, targetY, 0.08);
  }

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

/* Resize handling */
const ro = new ResizeObserver(()=> {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
  renderer.setSize(w,h,false);
});
ro.observe(document.getElementById('app'));
