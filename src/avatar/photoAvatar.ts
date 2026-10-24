// Photo-driven talking avatar. The portrait is drawn on a plane and a fragment shader
// animates the real pixels: the lower lip/chin drop with a dark mouth interior while
// speaking, and eyelids close to blink. The whole head sways and nods per gesture.
import * as THREE from 'three';

export type Gesture = 'idle' | 'wave' | 'point' | 'nod' | 'explain' | 'apologize' | 'think';

// Facial landmarks of /beulah-avatar.jpg in photo UV space (origin bottom-left).
const LANDMARKS = {
  mouth: new THREE.Vector2(0.487, 0.503),
  eyeL: new THREE.Vector2(0.383, 0.685),
  eyeR: new THREE.Vector2(0.608, 0.686),
};
// Vertical centre of the framed region (just below the eyes so the face fills the stage).
const FRAME_CENTER_UV_Y = 0.64;

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

const FRAG = `
uniform sampler2D map;
uniform float aspect, open, blink, jaw, curve, mouthW, eyeRx, eyeRy;
uniform vec2 mouth, eyeL, eyeR;
varying vec2 vUv;

vec3 tex(vec2 p) { return texture2D(map, p).rgb; }

// Closes one eye using skin sampled from the cheek below it.
vec3 applyBlink(vec3 col, vec2 uv, vec2 e) {
  vec2 d = vec2((uv.x - e.x) * aspect, uv.y - e.y);
  float m = 1.0 - smoothstep(0.35, 1.0, length(d / vec2(eyeRx, eyeRy)));
  if (m <= 0.0 || blink <= 0.01) return col;
  float lidY = e.y + eyeRy - 2.0 * eyeRy * blink;
  float cover = smoothstep(lidY - 0.003, lidY + 0.003, uv.y);
  vec3 skin = (tex(vec2(uv.x, e.y - eyeRy * 2.8)) + tex(vec2(uv.x, e.y - eyeRy * 3.4))) * 0.5;
  col = mix(col, skin * 0.96, m * cover);
  float lash = (1.0 - smoothstep(0.0, 0.006, abs(uv.y - lidY))) * m * step(0.05, blink);
  return mix(col, col * 0.7, lash * 0.5);
}

void main() {
  vec2 uv = vUv;
  float dx = (uv.x - mouth.x) / mouthW;
  float wx = exp(-dx * dx);
  // The split line follows the smile: mouth corners sit higher than the centre.
  float sp = mouth.y + curve * min(dx * dx, 1.5);
  float amt = open * jaw * wx;
  float fall = smoothstep(sp - jaw * 5.0, sp - jaw * 1.5, uv.y);
  vec2 suv = uv;
  if (uv.y < sp) suv.y += amt * fall;
  vec3 col = tex(suv);

  // Dark mouth interior in the gap, with a faint tongue near the bottom.
  float t = clamp((sp - uv.y) / max(amt, 1e-4), 0.0, 1.0);
  float inGap = smoothstep(0.0, 0.0025, uv.y - (sp - amt)) * smoothstep(0.0, 0.0025, sp - uv.y);
  float cav = inGap * smoothstep(0.35, 0.65, wx) * step(0.002, amt);
  vec3 inner = mix(vec3(0.07, 0.015, 0.02), vec3(0.42, 0.14, 0.15), smoothstep(0.45, 1.0, t) * 0.7);
  inner *= mix(0.55, 1.0, smoothstep(0.0, 0.35, t));
  col = mix(col, inner, cav);

  col = applyBlink(col, uv, eyeL);
  col = applyBlink(col, uv, eyeR);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

type Pose = { p?: number; y?: number; r?: number };
const POSES: Record<Gesture, (t: number) => Pose> = {
  idle: () => ({}),
  wave: (t) => ({ r: 0.02 + Math.sin(t * 5) * 0.02, y: -0.03, p: -0.01 }),
  point: () => ({ y: -0.07, p: 0.015, r: -0.015 }),
  nod: (t) => ({ p: 0.01 + Math.sin(t * 5) * 0.035 }),
  explain: (t) => ({ y: Math.sin(t * 1.5) * 0.05, p: Math.sin(t * 3) * 0.015, r: Math.sin(t * 1.5) * 0.015 }),
  apologize: () => ({ p: 0.05, r: 0.03 }),
  think: () => ({ y: 0.06, r: 0.025, p: -0.025 }),
};

export interface PhotoAvatar {
  setSize(width: number, height: number): void;
  play(gesture: Gesture, seconds: number): void;
  setSpeaking(value: boolean): void;
  pulse(): void;
  dispose(): void;
}

export type Frame = { centerY: number; zoom: number };

export function createPhotoAvatar(canvas: HTMLCanvasElement, img: HTMLImageElement, frame: Frame = { centerY: FRAME_CENTER_UV_Y, zoom: 1 }, strength = 1): PhotoAvatar {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);

  const aspect = img.naturalWidth / img.naturalHeight;
  const H = 1;
  const W = H * aspect;

  const tex = new THREE.Texture(img);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;

  const eyeDist = Math.abs(LANDMARKS.eyeR.x - LANDMARKS.eyeL.x) * aspect;
  const U = {
    map: { value: tex },
    aspect: { value: aspect },
    open: { value: 0 },
    blink: { value: 0 },
    jaw: { value: eyeDist * 0.2 * strength },
    curve: { value: eyeDist * 0.15 },
    mouthW: { value: (eyeDist * 0.5) / aspect },
    eyeRx: { value: eyeDist * 0.26 },
    eyeRy: { value: eyeDist * 0.12 },
    mouth: { value: LANDMARKS.mouth },
    eyeL: { value: LANDMARKS.eyeL },
    eyeR: { value: LANDMARKS.eyeR },
  };
  const material = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: FRAG });
  const geometry = new THREE.PlaneGeometry(W, H);
  const mesh = new THREE.Mesh(geometry, material);
  // Pivot the head about the neck so rotations read as head movement.
  const pivotY = -0.25 * H;
  mesh.position.y = -pivotY;
  const group = new THREE.Group();
  group.position.y = pivotY;
  group.add(mesh);
  scene.add(group);

  const lookY = (frame.centerY - 0.5) * H;
  const setSize = (width: number, height: number) => {
    renderer.setSize(width, height, false);
    const stageAspect = width / Math.max(height, 1);
    camera.aspect = stageAspect;
    // Fit the full photo width; taller stages simply show more of the shoulders.
    const visibleH = Math.min(W / stageAspect, H) / frame.zoom;
    const z = (visibleH / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.04;
    camera.position.set(0, lookY, z);
    camera.lookAt(0, lookY, 0);
    camera.updateProjectionMatrix();
  };
  setSize(canvas.clientWidth || 360, canvas.clientHeight || 240);

  const pose = { p: 0, y: 0, r: 0 };
  let gesture: Gesture = 'idle';
  let gestureT = 0;
  let gestureLeft = 0;
  let speaking = false;
  let pulseAmt = 0;
  let open = 0;
  let clock = 0;
  let beat = 0;
  let nextBeat = 0.5;
  let nextBlink = 1.5;
  let blinkPhase = -1;

  const timer = new THREE.Clock();
  let raf = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(timer.getDelta(), 0.05);
    clock += dt;
    gestureT += dt;
    if (gestureLeft > 0 && (gestureLeft -= dt) <= 0) gesture = 'idle';

    // Head pose: gesture target plus slow layered noise so she is never perfectly still.
    const g = POSES[gesture](gestureT);
    beat *= Math.exp(-dt * 4);
    if (speaking && (nextBeat -= dt) <= 0) {
      beat = 1;
      nextBeat = 0.5 + Math.random() * 0.9;
    }
    const tp = (g.p ?? 0) + Math.sin(clock * 0.9) * 0.012 + beat * 0.025;
    const ty = (g.y ?? 0) + Math.sin(clock * 0.5) * 0.03 + Math.sin(clock * 0.23 + 1) * 0.02;
    const tr = (g.r ?? 0) + Math.sin(clock * 0.41 + 4) * 0.012;
    const k = 1 - Math.exp(-dt * 7);
    pose.p += (tp - pose.p) * k;
    pose.y += (ty - pose.y) * k;
    pose.r += (tr - pose.r) * k;
    group.rotation.set(pose.p, pose.y, pose.r);
    group.scale.setScalar(1 + Math.sin(clock * 1.8) * 0.003);

    // Jaw: syllable-like wobble while speaking with an accent on each word boundary.
    pulseAmt = Math.max(0, pulseAmt - dt * 6);
    const wobble = Math.abs(Math.sin(clock * 11)) * Math.abs(Math.sin(clock * 3.7 + 1));
    const target = speaking ? 0.2 + 0.6 * wobble + 0.25 * pulseAmt : 0;
    open += (target - open) * (1 - Math.exp(-dt * 25));
    U.open.value = Math.min(open, 1);

    // Blink every 2 to 6 seconds, occasionally twice in a row.
    let blink = 0;
    if (blinkPhase < 0 && (nextBlink -= dt) <= 0) blinkPhase = 0;
    if (blinkPhase >= 0) {
      blinkPhase += dt / 0.17;
      blink = Math.sin(Math.min(blinkPhase, 1) * Math.PI);
      if (blinkPhase >= 1) {
        blinkPhase = -1;
        nextBlink = Math.random() < 0.2 ? 0.15 : 2 + Math.random() * 4;
      }
    }
    U.blink.value = blink;

    renderer.render(scene, camera);
  };
  tick();

  return {
    setSize,
    play(next, seconds) {
      gesture = next;
      gestureT = 0;
      gestureLeft = seconds;
    },
    setSpeaking(value) {
      speaking = value;
    },
    pulse() {
      pulseAmt = 1;
    },
    dispose() {
      cancelAnimationFrame(raf);
      tex.dispose();
      material.dispose();
      geometry.dispose();
      renderer.dispose();
    },
  };
}
