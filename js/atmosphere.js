// The single owner of the air (2026-10-19 ocean-cohesion spec §4.2).
//
// Pure: no three.js, so it is unit-testable and every visual layer can read ONE
// atmosphere — the water shader, the sky dome, the scene fog and the prop tint.
// The cohesion problem this solves is that four layers had each invented their own
// air (four fade curves, two lighting models); here there is one curve and one sun.
import { ATMOSPHERE } from './config.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));

function hexToRgb(hex) {
  return {
    r: ((hex >> 16) & 255) / 255,
    g: ((hex >> 8) & 255) / 255,
    b: (hex & 255) / 255,
  };
}

// Normalised sun direction, shared by the key light, the water's specular term and
// the sky dome's sun glow.
export function sunVector() {
  const [x, y, z] = ATMOSPHERE.sun.dir;
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

// Sky colour at a view elevation in [-1, 1]: the horizon colour at 0, the zenith
// colour at 1, linear and monotone between, clamped below the horizon (there is no
// sky under the sea to interpolate toward).
export function skyColorAt(elevation) {
  const t = clamp01(elevation);
  const horizon = hexToRgb(ATMOSPHERE.sky.horizon);
  const zenith = hexToRgb(ATMOSPHERE.sky.zenith);
  return {
    r: horizon.r + (zenith.r - horizon.r) * t,
    g: horizon.g + (zenith.g - horizon.g) * t,
    b: horizon.b + (zenith.b - horizon.b) * t,
  };
}

// The one fade curve, deliberately identical to three's linear fog
// (smoothstep(fogNear, fogFar, depth)). The custom water/sky shaders call this and
// the renderer applies the same formula to Standard/Phong props, so every layer
// dissolves at the same distance — that parity is the whole point, not taste.
export function fogFactorAt(distance) {
  const { near, far } = ATMOSPHERE.fog;
  const t = clamp01((distance - near) / (far - near));
  return t * t * (3 - 2 * t);
}

// The colour everything fades to: the fog colour, which the sky dome also paints at
// its horizon. Sea and sky therefore meet at the same colour by construction.
export function horizonColor() {
  return hexToRgb(ATMOSPHERE.fog.color);
}
