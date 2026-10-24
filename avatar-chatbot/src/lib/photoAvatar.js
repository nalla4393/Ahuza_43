// Photo-driven talking avatar. The uploaded photo is rendered on a plane with a
// fragment shader that animates the real pixels: the jaw drops with a dark mouth
// cavity while speaking, and eyelids close to blink. The head sways/nods per gesture.
import * as THREE from "three";

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FRAG = `
uniform sampler2D map;
uniform float aspect, open, blink, jaw, curve, mouthW, eyeRx, eyeRy;
uniform vec2 mouth, eyeL, eyeR;
varying vec2 vUv;

vec3 tex(vec2 p) { return texture2D(map, p).rgb; }

// Closes one eye with skin sampled from the cheek below it.
vec3 applyBlink(vec3 col, vec2 uv, vec2 e) {
  vec2 d = vec2((uv.x - e.x) * aspect, uv.y - e.y);
  float m = 1.0 - smoothstep(0.7, 1.0, length(d / vec2(eyeRx, eyeRy)));
  if (m <= 0.0 || blink <= 0.01) return col;
  float lidY = e.y + eyeRy - 2.0 * eyeRy * blink;
  float cover = smoothstep(lidY - 0.003, lidY + 0.003, uv.y);
  vec3 skin = (tex(vec2(uv.x, e.y - eyeRy * 2.8)) + tex(vec2(uv.x, e.y - eyeRy * 3.4))) * 0.5;
  col = mix(col, skin * 0.96, m * cover);
  float lash = (1.0 - smoothstep(0.0, 0.006, abs(uv.y - lidY))) * m * step(0.05, blink);
  return mix(col, col * 0.45, lash * 0.8);
}

void main() {
  vec2 uv = vUv;
  float dx = (uv.x - mouth.x) / mouthW;
  float wx = exp(-dx * dx);
  // Split line follows the smile: mouth corners sit higher than the centre.
  float sp = mouth.y + curve * min(dx * dx, 1.5);
  float amt = open * jaw * wx;                                   // jaw drop at this column
  float fall = smoothstep(sp - jaw * 5.0, sp - jaw * 1.5, uv.y);
  vec2 suv = uv;
  if (uv.y < sp) suv.y += amt * fall;                            // lower lip and chin move down
  vec3 col = tex(suv);

  // Dark mouth interior in the gap, with a faint tongue near the bottom.
  float t = clamp((sp - uv.y) / max(amt, 1e-4), 0.0, 1.0);
  float inGap = smoothstep(0.0, 0.0025, uv.y - (sp - amt)) * smoothstep(0.0, 0.0025, sp - uv.y);
  float cav = inGap * smoothstep(0.35, 0.65, wx) * step(0.002, amt);
  vec3 inner = mix(vec3(0.07, 0.015, 0.02), vec3(0.42, 0.14, 0.15), smoothstep(0.45, 1.0, t) * 0.7);
  inner *= mix(0.55, 1.0, smoothstep(0.0, 0.35, t));            // shadow under the upper teeth
  col = mix(col, inner, cav);

  col = applyBlink(col, uv, eyeL);
  col = applyBlink(col, uv, eyeR);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const POSES = {
  idle: () => ({}),
  wave: (t) => ({ r: 0.02 + Math.sin(t * 5) * 0.02, y: -0.03, p: -0.01 }),
  point: () => ({ y: -0.07, p: 0.015, r: -0.015 }),
  nod: (t) => ({ p: 0.01 + Math.sin(t * 5) * 0.035 }),
  explain: (t) => ({ y: Math.sin(t * 1.5) * 0.05, p: Math.sin(t * 3) * 0.015, r: Math.sin(t * 1.5) * 0.015 }),
  apologize: () => ({ p: 0.05, r: 0.03 }),
  think: () => ({ y: 0.06, r: 0.025, p: -0.025 }),
};

// Downscale huge photos so they fit GPU texture limits.
function toCanvas(img, max = 2048) {
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// Average colour of the top-left corner of the photo, used so the rotating card blends into the backdrop.
function edgeColor(img) {
  const c = document.createElement("canvas");
  c.width = 8; c.height = 8;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, img.width * 0.06, img.height * 0.06, 0, 0, 8, 8);
  const d = ctx.getImageData(0, 0, 8, 8).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4;
  return `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
}

export function createPhotoAvatar(img) {
  const aspect = img.width / img.height;
  const H = 1.6, W = H * aspect;

  const tex = new THREE.CanvasTexture(toCanvas(img));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  const U = {
    map: { value: tex }, aspect: { value: aspect }, open: { value: 0 }, blink: { value: 0 },
    jaw: { value: 0.03 }, curve: { value: 0.02 }, mouthW: { value: 0.1 }, eyeRx: { value: 0.04 }, eyeRy: { value: 0.02 },
    mouth: { value: new THREE.Vector2(0.5, 0.3) },
    eyeL: { value: new THREE.Vector2(0.38, 0.6) },
    eyeR: { value: new THREE.Vector2(0.62, 0.6) },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: FRAG });
  const geo = new THREE.PlaneGeometry(W, H);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.25 * H;
  const group = new THREE.Group(); // pivot near the neck so rotations look like head movement
  group.position.y = -0.25 * H;
  group.add(mesh);

  let strength = 1;
  const applyParams = () => {
    const eyeDist = Math.abs(U.eyeR.value.x - U.eyeL.value.x) * aspect; // in image-height units
    U.jaw.value = eyeDist * 0.2 * strength;
    U.curve.value = eyeDist * 0.15;
    U.mouthW.value = (eyeDist * 0.5) / aspect;
    U.eyeRx.value = eyeDist * 0.26;
    U.eyeRy.value = eyeDist * 0.12;
  };
  applyParams();

  const pose = { p: 0, y: 0, r: 0 };
  let gesture = "idle", gestureT = 0, gestureLeft = 0;
  let speaking = false, pulseAmt = 0, open = 0, clock = 0, frozen = false;
  let nextBlink = 2, blinkPhase = -1, beat = 0, nextBeat = 0.5;

  return {
    group,
    background: edgeColor(img),
    camera: { pos: [0, 0, 3], look: [0, 0, 0], fov: 28 },

    // Keep the whole photo visible for any viewport shape.
    fit(camera, viewAspect) {
      const th = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const z = Math.max((H / 2) * 1.04 / th, (W / 2) * 1.04 / (th * viewAspect));
      camera.position.set(0, 0, z);
      camera.lookAt(0, 0, 0);
    },

    // p: { mouth:[u,v], eyeL:[u,v], eyeR:[u,v] } in photo UV (0..1, origin bottom-left).
    setParams(p) {
      if (p.mouth) U.mouth.value.set(...p.mouth);
      if (p.eyeL) U.eyeL.value.set(...p.eyeL);
      if (p.eyeR) U.eyeR.value.set(...p.eyeR);
      applyParams();
    },
    setStrength(v) { strength = v; applyParams(); },
    setFrozen(v) { frozen = v; },

    // Returns the photo UV under a raycaster, used for click-to-calibrate.
    pick(raycaster) {
      const hit = raycaster.intersectObject(mesh)[0];
      return hit?.uv ? [hit.uv.x, hit.uv.y] : null;
    },

    play(name, duration = 3) { gesture = POSES[name] ? name : "idle"; gestureT = 0; gestureLeft = duration; },
    setSpeaking(v) { speaking = v; },
    pulse() { pulseAmt = 1; },

    update(dt) {
      clock += dt; gestureT += dt;
      if (gestureLeft > 0 && (gestureLeft -= dt) <= 0) gesture = "idle";

      // Head pose: gesture target + slow layered noise so it is never perfectly still.
      const g = frozen ? {} : POSES[gesture](gestureT);
      beat *= Math.exp(-dt * 4);
      if (speaking && !frozen && (nextBeat -= dt) <= 0) { beat = 1; nextBeat = 0.5 + Math.random() * 0.9; }
      const n = frozen ? 0 : 1;
      const tp = (g.p || 0) + n * (Math.sin(clock * 0.9) * 0.012 + beat * 0.025);
      const ty = (g.y || 0) + n * (Math.sin(clock * 0.5) * 0.03 + Math.sin(clock * 0.23 + 1) * 0.02);
      const tr = (g.r || 0) + n * Math.sin(clock * 0.41 + 4) * 0.012;
      const k = 1 - Math.exp(-dt * 7);
      pose.p += (tp - pose.p) * k; pose.y += (ty - pose.y) * k; pose.r += (tr - pose.r) * k;
      group.rotation.set(pose.p, pose.y, pose.r);
      group.scale.setScalar(1 + n * Math.sin(clock * 1.8) * 0.003); // breathing

      // Jaw: syllable-like wobble while speaking, extra accent on word boundaries.
      pulseAmt = Math.max(0, pulseAmt - dt * 6);
      const wobble = Math.abs(Math.sin(clock * 11)) * Math.abs(Math.sin(clock * 3.7 + 1));
      const target = speaking && !frozen ? 0.2 + 0.6 * wobble + 0.25 * pulseAmt : 0;
      open += (target - open) * (1 - Math.exp(-dt * 25));
      U.open.value = Math.min(open, 1);

      // Blink every 2-6 s, sometimes twice in a row.
      let blink = 0;
      if (!frozen) {
        if (blinkPhase < 0 && (nextBlink -= dt) <= 0) blinkPhase = 0;
        if (blinkPhase >= 0) {
          blinkPhase += dt / 0.17;
          blink = Math.sin(Math.min(blinkPhase, 1) * Math.PI);
          if (blinkPhase >= 1) { blinkPhase = -1; nextBlink = Math.random() < 0.2 ? 0.15 : 2 + Math.random() * 4; }
        }
      }
      U.blink.value = blink;
    },

    dispose() { tex.dispose(); mat.dispose(); geo.dispose(); },
  };
}
