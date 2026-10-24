import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { createAvatar } from "../lib/avatar.js";
import { buildFaceCanvas } from "../lib/faceTexture.js";
import { createPhotoAvatar } from "../lib/photoAvatar.js";
import { loadGlbAvatar } from "../lib/glbAvatar.js";

/**
 * 3D viewport hosting one active "avatar" at a time (photo / glb model / cartoon).
 * Every avatar exposes: group, camera preset, update(dt), play, setSpeaking, pulse.
 * The parent drives it through the imperative handle below.
 */
const AvatarViewport = forwardRef(function AvatarViewport({ background, onPick }, ref) {
  const mountRef = useRef(null);
  const S = useRef({});
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useImperativeHandle(ref, () => {
    const cur = () => S.current.current;
    return {
      play: (g, d) => cur()?.play(g, d),
      setSpeaking: (v) => cur()?.setSpeaking(v),
      pulse: () => cur()?.pulse(),
      setFrozen: (v) => cur()?.setFrozen?.(v),
      showPhoto: (img) => S.current.swap(createPhotoAvatar(img)),
      showModel: async (url) => S.current.swap(await loadGlbAvatar(url)),
      showCartoon: () => S.current.swap(S.current.cartoon),
      setPhotoParams: (p) => cur()?.setParams?.(p),
      setStrength: (v) => cur()?.setStrength?.(v),
      setColors: (c) => S.current.cartoon?.setColors(c),
    };
  });

  useEffect(() => {
    const el = mountRef.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);

    // Studio-style lighting (used by the 3D model and cartoon; the photo is unlit).
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
    const key = new THREE.DirectionalLight("#fff4e6", 1.5);
    key.position.set(1.5, 3, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0005;
    scene.add(key);
    const rim = new THREE.DirectionalLight("#bcd4ff", 0.7);
    rim.position.set(-2, 2, -2);
    scene.add(rim);

    const cartoon = createAvatar();
    cartoon.setFaceCanvas(buildFaceCanvas({}));

    const st = S.current;
    Object.assign(st, { scene, camera, renderer, cartoon, current: null });

    const applyCamera = () => {
      const a = st.current;
      if (!a) return;
      const c = a.camera;
      camera.fov = c.fov;
      camera.aspect = el.clientWidth / Math.max(el.clientHeight, 1);
      camera.position.set(...c.pos);
      camera.lookAt(...c.look);
      camera.updateProjectionMatrix();
      a.fit?.(camera, camera.aspect);
    };
    st.swap = (next) => {
      if (st.current) {
        scene.remove(st.current.group);
        if (st.current !== cartoon) st.current.dispose?.();
      }
      st.current = next;
      scene.background = new THREE.Color(next.background || st.userBg || "#dfe7f2");
      scene.add(next.group);
      applyCamera();
    };

    const resize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      applyCamera();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // Click-to-calibrate: convert a click into photo UV coordinates.
    const ray = new THREE.Raycaster();
    const onDown = (e) => {
      if (!pickRef.current || !st.current?.pick) return;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const uv = st.current.pick(ray);
      if (uv) pickRef.current(uv);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);

    const clock = new THREE.Clock();
    let raf;
    const loop = () => {
      st.current?.update(Math.min(clock.getDelta(), 0.05));
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      if (st.current && st.current !== cartoon) st.current.dispose?.();
      cartoon.dispose();
      pmrem.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    const scene = S.current.scene;
    S.current.userBg = background;
    if (scene && !S.current.current?.background) scene.background = new THREE.Color(background);
  }, [background]);

  return <div className={`viewport${onPick ? " picking" : ""}`} ref={mountRef} />;
});

export default AvatarViewport;
