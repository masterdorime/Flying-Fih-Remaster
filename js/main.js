import * as THREE from 'three';

// Bootstrap smoke test: renderer + spinning cube + loop with clamped dt.
// Replaced by the full scene in later milestones.

const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b2a3f);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 2, 6);

scene.add(new THREE.HemisphereLight(0xbfe6ff, 0x24404f, 1.2));

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0xff8c42 })
);
scene.add(cube);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let frames = 0;
let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05); // clamp: tab-switch guard
  last = now;
  cube.rotation.y += dt;
  cube.rotation.x += dt * 0.5;
  camera.lookAt(cube.position);
  renderer.render(scene, camera);
  frames++;
  window.__FFM = { ready: true, frames };
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

document.getElementById('loading').classList.add('hidden');
