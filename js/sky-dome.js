import * as THREE from 'three';
import { ATMOSPHERE } from './config.js';
import { sunVector } from './atmosphere.js';

// Crafted sky dome (2026-10-19, spec §4.5/T9).
//
// The ocean used a photographic equirect skybox, and that photograph contains its OWN
// painted sea with its own horizon. So the water could never meet the sky: the sea faded to
// the fog colour and the "sky" above it was a different, darker painted horizon. That seam
// is the hard band on the horizon, and no water-side change could remove it.
//
// The dome's horizon colour IS the fog colour (both from ATMOSPHERE), so the sea fades to
// exactly the colour the sky paints at zero elevation: they meet by construction rather than
// by tuning. Ocean only — the flight environment keeps its space equirect.
//
// fog:false is deliberate and is the one legitimate exception: the sky is the SOURCE of the
// fog colour, not a receiver of it. Fogging it would force the whole dome to the fog colour
// (it is far past fog.far) and flatten the gradient away.
export function createSkyDome(scene) {
  const geo = new THREE.SphereGeometry(1100, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color(ATMOSPHERE.sky.zenith) },
      uHorizon: { value: new THREE.Color(ATMOSPHERE.fog.color) }, // the seam, by construction
      uSunDir: { value: new THREE.Vector3(sunVector().x, sunVector().y, sunVector().z) },
      uSunColor: { value: new THREE.Color(ATMOSPHERE.sun.color) },
      uCloud: { value: new THREE.Color(0xffffff) },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uZenith, uHorizon, uSunColor, uCloud, uSunDir;
      uniform float uTime;
      varying vec3 vDir;

      void main() {
        vec3 d = normalize(vDir);

        // gradient: the horizon colour at and below the horizon, the zenith colour overhead.
        // The horizon colour at 0 is what the sea fades to — the stitch.
        float elev = d.y;
        vec3 col = mix(uHorizon, uZenith, clamp(elev, 0.0, 1.0));

        // sun: a small disc plus a broad glow, on the SAME direction vector the water's
        // specular and the key light use, so all three agree where the sun is
        float sd = max(dot(d, normalize(uSunDir)), 0.0);
        col += uSunColor * pow(sd, 400.0) * 0.85;   // disc
        col += uSunColor * pow(sd, 6.0) * 0.10;     // glow

        // stylized cloud band around mid elevation. Azimuth is the only parameter available
        // on a sphere, so the band is puffs at a few incommensurate angular frequencies —
        // not a parallel of latitude, which would read as a painted stripe.
        float az = atan(d.z, d.x);
        float puff = sin(az * 3.0 + 1.3) * 0.5 + sin(az * 5.0 - 0.7) * 0.32 + sin(az * 8.0 + 2.1) * 0.18;
        float band = smoothstep(0.05, 0.18, elev) * (1.0 - smoothstep(0.40, 0.78, elev));
        col = mix(col, uCloud, band * smoothstep(0.30, 0.92, puff + 0.35) * 0.80);

        // haze: lift the last few degrees above the horizon toward the seam colour, so the
        // join is a soft gradient rather than a line even if sea and sky are ever tuned apart
        col = mix(col, uHorizon, (1.0 - smoothstep(0.0, 0.12, elev)) * 0.55);

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1; // behind everything
  scene.add(mesh);

  return {
    mesh,
    update(t, playerPos) {
      mat.uniforms.uTime.value = t;
      // follow the fish so the dome never clips or drifts toward the horizon
      if (playerPos) { mesh.position.x = playerPos.x; mesh.position.z = playerPos.z; }
    },
    setVisible(v) { mesh.visible = v; },
  };
}
