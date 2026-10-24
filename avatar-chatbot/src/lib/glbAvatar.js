// Loads a realistic humanoid .glb (e.g. exported from Avaturn, Mixamo-rigged or
// ARKit-blendshape avatars). Face is animated with morph targets (jawOpen, blinks,
// visemes); arms and head are posed rig-agnostically by aiming bones in world space.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const norm = (n) => n.replace(/^mixamorig[:_]?/i, "").replace(/[^a-z]/gi, "").toLowerCase();
const NAMES = {
  rightarm: ["rightarm", "rightupperarm", "upperarmr"],
  leftarm: ["leftarm", "leftupperarm", "upperarml"],
  rightfore: ["rightforearm", "rightlowerarm", "forearmr"],
  leftfore: ["leftforearm", "leftlowerarm", "forearml"],
  head: ["head"],
};

function findBone(root, key) {
  let found = null;
  root.traverse((o) => { if (!found && o.isBone && NAMES[key].includes(norm(o.name))) found = o; });
  return found;
}

const v3 = (x, y, z) => new THREE.Vector3(x, y, z).normalize();

// Target world directions (x mirrored by `o` = outward side) for upper arm and forearm.
function armTarget(g, isRight, t, beat, talking) {
  const o = isRight ? -1 : 1;
  const idle = { u: v3(0.18 * o, -1, 0.05), f: v3(0.12 * o, -1, 0.3) };
  switch (g) {
    case "wave": return isRight ? { u: v3(0.95 * o, 0.35, 0.05), f: v3(o * (0.15 + 0.6 * Math.sin(t * 9)), 1, 0.1) } : idle;
    case "point": return isRight ? { u: v3(0.25 * o, -0.25, 0.9), f: v3(0.1 * o, -0.1, 1) } : idle;
    case "explain": return { u: v3(0.45 * o, -0.7, 0.35), f: v3(-0.25 * o + Math.sin(t * 3 + (isRight ? 0 : 1.5)) * 0.25, -0.15, 1) };
    case "apologize": return { u: v3(0.2 * o, -0.9, 0.3), f: v3(-0.75 * o, 0.35, 0.8) };
    case "think": return isRight ? { u: v3(0.2 * o, -0.7, 0.4), f: v3(-0.35 * o, 0.9, 0.45) } : idle;
    default:
      if (talking && isRight) return { u: v3(0.3 * o, -0.85, 0.35), f: v3(-0.1 * o, -0.3 + beat * 0.3, 1) };
      return idle;
  }
}

const HEAD_POSES = {
  idle: () => ({}),
  wave: (t) => ({ r: 0.05 + Math.sin(t * 5) * 0.04, y: -0.1 }),
  point: () => ({ y: -0.2 }),
  nod: (t) => ({ p: 0.03 + Math.sin(t * 5) * 0.12 }),
  explain: (t) => ({ y: Math.sin(t * 1.5) * 0.12 }),
  apologize: () => ({ p: 0.2, r: 0.06 }),
  think: () => ({ y: 0.18, r: 0.08, p: -0.05 }),
};

export async function loadGlbAvatar(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  const group = new THREE.Group();
  group.add(model);

  // Normalise to ~1.75 m tall, centred, feet on the floor.
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const s = 1.75 / (size.y || 1);
  model.scale.setScalar(s);
  box.setFromObject(model);
  const c = box.getCenter(new THREE.Vector3());
  model.position.set(-c.x, -box.min.y, -c.z);
  group.updateMatrixWorld(true);

  // Morph targets for face animation.
  const morphMeshes = [];
  model.traverse((o) => {
    if (o.isMesh) { o.frustumCulled = false; if (o.morphTargetDictionary) morphMeshes.push(o); }
  });
  const morph = (name, v) => morphMeshes.forEach((m) => {
    const i = m.morphTargetDictionary[name];
    if (i !== undefined) m.morphTargetInfluences[i] = v;
  });

  // Rest-pose data for rig-agnostic bone aiming.
  const q = new THREE.Quaternion();
  const restOf = (bone, child) => {
    const a = bone.getWorldPosition(new THREE.Vector3());
    const b = (child || bone.children.find((x) => x.isBone))?.getWorldPosition(new THREE.Vector3());
    return { bone, dir: b ? b.sub(a).normalize() : v3(0, -1, 0), q: bone.getWorldQuaternion(new THREE.Quaternion()) };
  };
  const arms = [];
  for (const side of ["right", "left"]) {
    const up = findBone(model, side + "arm"), fo = findBone(model, side + "fore");
    if (up && fo) {
      arms.push({
        isRight: side === "right",
        up: restOf(up, fo), fo: restOf(fo),
        cu: v3(0, -1, 0), cf: v3(0, -1, 0), // current smoothed directions
      });
    }
  }
  const headBone = findBone(model, "head");
  const headRest = headBone && { bone: headBone, q: headBone.getWorldQuaternion(new THREE.Quaternion()) };

  // Rotate `r.bone` so its rest direction points along `dir` (world space).
  const aim = (r, dir) => {
    const worldQ = new THREE.Quaternion().setFromUnitVectors(r.dir, dir).multiply(r.q);
    r.bone.parent.getWorldQuaternion(q);
    r.bone.quaternion.copy(q.invert().multiply(worldQ));
    r.bone.updateWorldMatrix(false, true);
  };

  const headY = 1.75 * 0.93;
  let gesture = "idle", gestureT = 0, gestureLeft = 0;
  let speaking = false, pulseAmt = 0, open = 0, clock = 0, frozen = false;
  let nextBlink = 2, blinkPhase = -1, beat = 0, nextBeat = 0.5;
  const pose = { p: 0, y: 0, r: 0 };

  return {
    group,
    camera: { pos: [0, headY - 0.1, 2.4], look: [0, headY - 0.35, 0], fov: 28 },
    setFrozen(v) { frozen = v; },
    play(name, duration = 3) { gesture = HEAD_POSES[name] ? name : "idle"; gestureT = 0; gestureLeft = duration; },
    setSpeaking(v) { speaking = v; },
    pulse() { pulseAmt = 1; },

    update(dt) {
      clock += dt; gestureT += dt;
      if (gestureLeft > 0 && (gestureLeft -= dt) <= 0) gesture = "idle";
      const g = frozen ? "idle" : gesture;

      beat *= Math.exp(-dt * 4);
      if (speaking && (nextBeat -= dt) <= 0) { beat = 1; nextBeat = 0.5 + Math.random() * 0.9; }

      // Arms: smooth direction vectors toward the gesture target, then aim bones.
      const k = 1 - Math.exp(-dt * 7);
      for (const a of arms) {
        const tg = armTarget(g, a.isRight, gestureT, beat, speaking && !frozen);
        a.cu.lerp(tg.u, k).normalize();
        a.cf.lerp(tg.f, k).normalize();
        aim(a.up, a.cu);
        aim(a.fo, a.cf);
      }

      // Head: gesture + idle noise, applied as a world-space rotation on the rest pose.
      if (headRest) {
        const hp = HEAD_POSES[g](gestureT);
        const n = frozen ? 0 : 1;
        const tp = (hp.p || 0) + n * (Math.sin(clock * 0.9) * 0.02 + beat * 0.04);
        const ty = (hp.y || 0) + n * (Math.sin(clock * 0.5) * 0.05 + Math.sin(clock * 0.23 + 1) * 0.03);
        const tr = (hp.r || 0) + n * Math.sin(clock * 0.41 + 4) * 0.02;
        pose.p += (tp - pose.p) * k; pose.y += (ty - pose.y) * k; pose.r += (tr - pose.r) * k;
        const off = new THREE.Quaternion().setFromEuler(new THREE.Euler(pose.p, pose.y, pose.r));
        headBone.parent.getWorldQuaternion(q);
        headBone.quaternion.copy(q.invert().multiply(off.multiply(headRest.q)));
      }
      group.rotation.y = Math.sin(clock * 0.5) * 0.03;

      // Face morphs.
      pulseAmt = Math.max(0, pulseAmt - dt * 6);
      const wobble = Math.abs(Math.sin(clock * 11)) * Math.abs(Math.sin(clock * 3.7 + 1));
      const target = speaking && !frozen ? 0.2 + 0.6 * wobble + 0.25 * pulseAmt : 0;
      open += (target - open) * (1 - Math.exp(-dt * 25));
      morph("jawOpen", open * 0.55);
      morph("mouthOpen", open * 0.25);
      morph("viseme_aa", open * 0.35);
      morph("mouthSmileLeft", 0.15); morph("mouthSmileRight", 0.15);

      let blink = 0;
      if (blinkPhase < 0 && (nextBlink -= dt) <= 0) blinkPhase = 0;
      if (blinkPhase >= 0) {
        blinkPhase += dt / 0.17;
        blink = Math.sin(Math.min(blinkPhase, 1) * Math.PI);
        if (blinkPhase >= 1) { blinkPhase = -1; nextBlink = Math.random() < 0.2 ? 0.15 : 2 + Math.random() * 4; }
      }
      morph("eyeBlinkLeft", blink); morph("eyeBlinkRight", blink); morph("eyesClosed", blink);
    },

    dispose() {
      model.traverse((o) => {
        o.geometry?.dispose();
        [].concat(o.material || []).forEach((m) => { Object.values(m).forEach((v) => v?.isTexture && v.dispose()); m.dispose(); });
      });
    },
  };
}
