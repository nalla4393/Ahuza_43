// Procedural 3D female avatar built from a real bone hierarchy (Object3D joints).
// Gestures are keyframe-free procedural poses blended with exponential smoothing.
// The face is a curved plane textured with the user's uploaded photo.
import * as THREE from "three";

const HEAD_R = { x: 0.16, y: 0.21, z: 0.18 }; // head ellipsoid radii
const FACE_PLANE = { w: 0.3, h: 0.4 };

const IDLE = {
  rUpX: 0, rUpZ: -0.12, rForeX: -0.15, rForeZ: 0,
  lUpX: 0, lUpZ: 0.12, lForeX: -0.15, lForeZ: 0,
  headX: 0, headY: 0, headZ: 0, spineY: 0,
};

// Each gesture returns overrides on top of IDLE for time t (seconds since start).
const GESTURES = {
  idle: () => ({}),
  wave: (t) => ({ rUpZ: -2.6, rForeZ: -0.2 + Math.sin(t * 9) * 0.45, headZ: 0.07, headY: -0.08 }),
  point: (t) => ({ rUpX: -1.35, rUpZ: -0.2, rForeX: -0.15 + Math.sin(t * 3) * 0.08, headY: -0.15 }),
  nod: (t) => ({ headX: 0.05 + Math.sin(t * 5) * 0.18 }),
  explain: (t) => ({
    rUpX: -0.5, lUpX: -0.5, rUpZ: -0.35, lUpZ: 0.35,
    rForeX: -1.0 + Math.sin(t * 3) * 0.25, lForeX: -1.0 + Math.sin(t * 3 + 1.5) * 0.25,
    headY: Math.sin(t * 1.5) * 0.12,
  }),
  apologize: () => ({
    rUpX: -0.55, lUpX: -0.55, rUpZ: 0.15, lUpZ: -0.15,
    rForeX: -1.2, lForeX: -1.2, rForeZ: 0.9, lForeZ: -0.9, headX: 0.25,
  }),
  think: () => ({
    rUpX: -0.7, rUpZ: 0, rForeX: -2.1, rForeZ: 0.5,
    lUpX: -0.4, lForeX: -1.2, lForeZ: -0.9, headZ: 0.12, headY: 0.2,
  }),
};

export function createAvatar() {
  const group = new THREE.Group();
  const disposables = [];
  const mat = (color, opts = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...opts });
    disposables.push(m);
    return m;
  };
  const mesh = (geo, material, parent, pos = [0, 0, 0], scale = [1, 1, 1]) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(...pos);
    m.scale.set(...scale);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    disposables.push(geo);
    return m;
  };

  const skinMat = mat("#e8b89a");
  const hairMat = mat("#3a2418", { roughness: 0.5 });
  const outfitMat = mat("#3b6fd8");
  const skirtMat = mat("#27345a");

  // ---- Skeleton ----
  const hips = new THREE.Object3D(); hips.position.y = 0.95; group.add(hips);
  const chest = new THREE.Object3D(); chest.position.y = 0.2; hips.add(chest);
  const neck = new THREE.Object3D(); neck.position.y = 0.26; chest.add(neck);
  const head = new THREE.Object3D(); head.position.y = 0.08; neck.add(head);

  const makeArm = (side) => {
    const s = side === "r" ? -1 : 1; // avatar faces +z, so its right side is -x
    const upper = new THREE.Object3D(); upper.position.set(s * 0.27, 0.18, 0); chest.add(upper);
    const fore = new THREE.Object3D(); fore.position.y = -0.31; upper.add(fore);
    const hand = new THREE.Object3D(); hand.position.y = -0.29; fore.add(hand);
    mesh(new THREE.SphereGeometry(0.06, 16, 12), outfitMat, upper); // shoulder
    mesh(new THREE.CapsuleGeometry(0.045, 0.22, 6, 12), outfitMat, upper, [0, -0.15, 0]);
    mesh(new THREE.CapsuleGeometry(0.04, 0.2, 6, 12), skinMat, fore, [0, -0.14, 0]);
    mesh(new THREE.SphereGeometry(0.05, 16, 12), skinMat, hand, [0, -0.02, 0], [0.9, 1.2, 0.5]);
    return { upper, fore };
  };
  const arms = { r: makeArm("r"), l: makeArm("l") };

  // ---- Body ----
  mesh(new THREE.CapsuleGeometry(0.12, 0.3, 8, 16), outfitMat, chest, [0, 0.05, 0], [1.35, 1, 0.8]);
  mesh(new THREE.CapsuleGeometry(0.13, 0.12, 8, 16), outfitMat, hips, [0, 0.02, 0], [1.2, 1, 0.8]);
  mesh(new THREE.CylinderGeometry(0.13, 0.3, 0.7, 24, 1, true), skirtMat, hips, [0, -0.38, 0]);
  mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.14, 16), skinMat, neck, [0, 0.03, 0]);

  // ---- Head ----
  mesh(new THREE.SphereGeometry(1, 40, 32), skinMat, head, [0, 0.1, 0], [HEAD_R.x, HEAD_R.y, HEAD_R.z]);
  // Hair: back-of-head shell plus a long fall of hair behind the shoulders.
  mesh(new THREE.SphereGeometry(1, 32, 24), hairMat, head, [0, 0.13, -0.035], [HEAD_R.x * 1.1, HEAD_R.y * 1.1, HEAD_R.z * 1.05]);
  mesh(new THREE.SphereGeometry(1, 24, 20), hairMat, head, [0, -0.1, -0.11], [0.19, 0.32, 0.09]);
  // Side locks framing the face and a soft fringe on the forehead.
  for (const sx of [-1, 1]) mesh(new THREE.CapsuleGeometry(0.035, 0.3, 6, 12), hairMat, head, [sx * 0.155, -0.02, -0.02], [1, 1, 1.6]);
  mesh(new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.32), hairMat, head, [0, 0.12, 0.012], [HEAD_R.x * 1.06, HEAD_R.y * 1.06, HEAD_R.z * 1.06]);
  mesh(new THREE.SphereGeometry(0.17, 24, 16), outfitMat, chest, [0, 0.2, -0.01], [1.35, 0.35, 0.7]); // shoulder line
  // Shadow-catching floor-free soft ground is skipped; the bust is framed by the camera.

  // Face plane bent to follow the ellipsoid so the photo wraps the front of the head.
  const faceGeo = new THREE.PlaneGeometry(FACE_PLANE.w, FACE_PLANE.h, 24, 32);
  const surfaceZ = (x, y) => {
    const k = 1 - (x / HEAD_R.x) ** 2 - (y / HEAD_R.y) ** 2;
    return HEAD_R.z * Math.sqrt(Math.max(k, 0));
  };
  const p = faceGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setZ(i, surfaceZ(p.getX(i), p.getY(i)) + 0.004);
  }
  faceGeo.computeVertexNormals();
  disposables.push(faceGeo);
  const faceTex = new THREE.CanvasTexture(document.createElement("canvas"));
  faceTex.colorSpace = THREE.SRGBColorSpace;
  faceTex.anisotropy = 8;
  disposables.push(faceTex);
  const faceMat = new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 });
  disposables.push(faceMat);
  const face = new THREE.Mesh(faceGeo, faceMat);
  face.position.y = 0.1; // same centre as the head ellipsoid
  head.add(face);

  // Mouth: dark inner-mouth ellipse whose height follows speech; sits on the face surface.
  let mouthY = -0.085;
  const mouthMat = new THREE.MeshBasicMaterial({ color: "#3a0d14", transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  disposables.push(mouthMat);
  const mouth = mesh(new THREE.CircleGeometry(1, 24), mouthMat, face);
  const placeMouth = () => mouth.position.set(0, mouthY, surfaceZ(0, mouthY + 0.1) + 0.008);
  placeMouth();

  // Eyelids: skin-coloured ovals that close over the photo's eyes to blink.
  let eyeY = 0.031;
  const lidMat = new THREE.MeshBasicMaterial({ color: "#e8b89a", transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
  disposables.push(lidMat);
  const lids = [-1, 1].map((sx) => mesh(new THREE.CircleGeometry(1, 20), lidMat, face));
  const placeLids = () => lids.forEach((l, i) => l.position.set((i ? 1 : -1) * 0.045, eyeY, surfaceZ((i ? 1 : -1) * 0.045, eyeY + 0.1) + 0.006));
  placeLids();

  // ---- Animation state ----
  const pose = { ...IDLE };
  let gesture = "idle", gestureT = 0, gestureLeft = 0;
  let speaking = false, pulseAmt = 0, mouthOpen = 0, clock = 0;
  let blink = 0, nextBlink = 2, blinkPhase = -1;
  let beat = 0, nextBeat = 0.5;

  const bone = (b, ax, v) => { b.rotation[ax] = v; };

  return {
    group,
    camera: { pos: [0, 1.5, 2.6], look: [0, 1.38, 0], fov: 28 },

    setFaceCanvas(canvas) {
      faceTex.image = canvas;
      faceTex.needsUpdate = true;
    },
    setColors({ skin, hair, outfit }) {
      if (skin) { skinMat.color.set(skin); lidMat.color.set(skin); }
      if (hair) hairMat.color.set(hair);
      if (outfit) outfitMat.color.set(outfit);
    },
    setMouthY(v) { mouthY = v; placeMouth(); },
    setEyeY(v) { eyeY = v; placeLids(); },

    // Start a gesture; holds for `duration` seconds, then returns to idle.
    play(name, duration = 3) {
      gesture = GESTURES[name] ? name : "idle";
      gestureT = 0;
      gestureLeft = duration;
    },
    setSpeaking(v) { speaking = v; },
    pulse() { pulseAmt = 1; }, // call on TTS word boundaries for a lip-flap accent

    update(dt) {
      clock += dt;
      gestureT += dt;
      if (gestureLeft > 0 && (gestureLeft -= dt) <= 0) gesture = "idle";

      const target = { ...IDLE, ...GESTURES[gesture](gestureT) };
      const k = 1 - Math.exp(-dt * 8);
      for (const key in target) pose[key] += (target[key] - pose[key]) * k;

      // Breathing, weight shift and slow sway keep the body alive between gestures.
      const breath = Math.sin(clock * 1.8) * 0.012;
      chest.scale.set(1 + breath, 1 + breath * 0.6, 1);
      hips.rotation.y = Math.sin(clock * 0.6) * 0.04;
      hips.rotation.z = Math.sin(clock * 0.45) * 0.015;
      hips.position.x = Math.sin(clock * 0.45) * 0.008;
      chest.rotation.x = breath * 2;

      // While talking and not in a specific gesture, add small beat movements.
      beat *= Math.exp(-dt * 4);
      if (speaking && gesture === "idle" && (nextBeat -= dt) <= 0) { beat = 1; nextBeat = 0.6 + Math.random() * 0.9; }
      const talk = speaking && gesture === "idle" ? 1 : 0;

      bone(arms.r.upper, "x", pose.rUpX - talk * (0.25 + 0.2 * beat)); bone(arms.r.upper, "z", pose.rUpZ - talk * 0.12);
      bone(arms.r.fore, "x", pose.rForeX - talk * (0.5 + 0.3 * beat)); bone(arms.r.fore, "z", pose.rForeZ);
      bone(arms.l.upper, "x", pose.lUpX); bone(arms.l.upper, "z", pose.lUpZ);
      bone(arms.l.fore, "x", pose.lForeX); bone(arms.l.fore, "z", pose.lForeZ);

      // Head: layered slow noise (never perfectly still) + speech nods + small look-around.
      const nx = Math.sin(clock * 0.9) * 0.02 + Math.sin(clock * 0.37 + 2) * 0.015;
      const ny = Math.sin(clock * 0.5) * 0.05 + Math.sin(clock * 0.23 + 1) * 0.03;
      const nz = Math.sin(clock * 0.41 + 4) * 0.018;
      head.rotation.set(pose.headX + nx + (speaking ? beat * 0.06 : 0), pose.headY + ny, pose.headZ + nz);
      neck.rotation.x = pose.headX * 0.3;

      // Blink: quick close/open, randomly every 2-6 s, occasionally a double blink.
      if (blinkPhase < 0 && (nextBlink -= dt) <= 0) { blinkPhase = 0; }
      if (blinkPhase >= 0) {
        blinkPhase += dt / 0.16;
        blink = Math.sin(Math.min(blinkPhase, 1) * Math.PI);
        if (blinkPhase >= 1) { blinkPhase = -1; blink = 0; nextBlink = Math.random() < 0.2 ? 0.15 : 2 + Math.random() * 4; }
      }
      lids.forEach((l) => { l.scale.set(0.03, Math.max(0.0001, blink * 0.017), 1); l.visible = blink > 0.02; });

      // Mouth: pseudo-viseme motion while speaking + accent on word boundaries.
      pulseAmt = Math.max(0, pulseAmt - dt * 6);
      const wobble = Math.abs(Math.sin(clock * 11)) * Math.abs(Math.sin(clock * 3.7 + 1));
      const targetOpen = speaking ? 0.25 + 0.55 * wobble + 0.3 * pulseAmt : 0;
      mouthOpen += (targetOpen - mouthOpen) * (1 - Math.exp(-dt * 25));
      mouth.scale.set(0.034 + mouthOpen * 0.008, Math.max(0.001, mouthOpen * 0.03), 1);
      mouthMat.opacity = Math.min(1, mouthOpen * 3);
    },

    dispose() { disposables.forEach((d) => d.dispose?.()); },
  };
}
