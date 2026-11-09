import * as THREE from 'three';

export function createShoppingCharacter(canvas: HTMLCanvasElement): () => void {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(90, 150, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 90 / 150, 0.1, 20);
  camera.position.set(0, 1.2, 5.4);
  camera.lookAt(0, 1.2, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x7b5d5d, 2));
  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(2, 4, 5);
  scene.add(light);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const material = (color: number) => {
    const result = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
    materials.push(result);
    return result;
  };
  const rose = material(0xc43d58);
  const skin = material(0xb87558);
  const dark = material(0x282628);
  const gold = material(0xd7ae72);
  const mesh = (geometry: THREE.BufferGeometry, surface: THREE.Material, x: number, y: number, z = 0) => {
    geometries.push(geometry);
    const result = new THREE.Mesh(geometry, surface);
    result.position.set(x, y, z);
    return result;
  };

  const character = new THREE.Group();
  scene.add(character);
  character.add(mesh(new THREE.CylinderGeometry(0.29, 0.34, 0.82, 20), rose, 0, 1.17));
  character.add(mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.12, 20), dark, 0, 0.76));
  character.add(mesh(new THREE.SphereGeometry(0.31, 24, 16), skin, 0, 1.91));
  const hair = mesh(new THREE.SphereGeometry(0.33, 24, 16), dark, 0, 1.95, -0.1);
  hair.scale.set(1, 1.1, 0.75);
  for (const side of [-1, 1]) {
    const lock = mesh(new THREE.SphereGeometry(0.15, 16, 12), dark, side * 0.25, 1.68, -0.02);
    lock.scale.set(0.8, 1.5, 0.8);
  }

  const texture = new THREE.TextureLoader().load('/beulah-avatar.jpg', undefined, undefined, () => {
    console.error('Unable to load the shopping assistant portrait');
  });
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.repeat.set(0.68, 0.58);
  texture.offset.set(0.16, 0.34);
  texture.needsUpdate = true;
  const faceMaterial = new THREE.MeshBasicMaterial({ map: texture });
  materials.push(faceMaterial);
  character.add(mesh(new THREE.CircleGeometry(0.26, 32), faceMaterial, 0, 1.91, 0.31));
  character.add(mesh(new THREE.SphereGeometry(0.035, 12, 8), gold, 0, 1.27, 0.32));
  character.add(mesh(new THREE.SphereGeometry(0.035, 12, 8), gold, 0, 1.08, 0.32));

  function limb(x: number, y: number, length: number, surface: THREE.Material, radius: number) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    pivot.add(mesh(new THREE.CapsuleGeometry(radius, length - 2 * radius, 4, 8), surface, 0, -length / 2));
    if (surface === rose) pivot.add(mesh(new THREE.SphereGeometry(radius * 1.15, 12, 8), skin, 0, -length + radius));
    character.add(pivot);
    return pivot;
  }
  const leftArm = limb(-0.3, 1.48, 0.62, rose, 0.085);
  const rightArm = limb(0.3, 1.48, 0.62, rose, 0.085);
  const leftLeg = limb(-0.16, 0.78, 0.72, dark, 0.095);
  const rightLeg = limb(0.16, 0.78, 0.72, dark, 0.095);
  character.add(mesh(new THREE.SphereGeometry(0.12, 16, 10), dark, -0.16, 0.08, 0.08));
  character.add(mesh(new THREE.SphereGeometry(0.12, 16, 10), dark, 0.16, 0.08, 0.08));

  let frame = 0;
  const start = performance.now();
  const animate = (now: number) => {
    const time = (now - start) / 1000;
    const stride = Math.sin(time * 10) * 0.55;
    leftLeg.rotation.z = stride;
    rightLeg.rotation.z = -stride;
    leftArm.rotation.z = -stride;
    rightArm.rotation.z = stride;
    character.position.y = Math.abs(Math.sin(time * 10)) * 0.035;
    character.rotation.y = Math.sin(time * 2) * 0.12;
    renderer.render(scene, camera);
    frame = requestAnimationFrame(animate);
  };
  frame = requestAnimationFrame(animate);

  return () => {
    cancelAnimationFrame(frame);
    texture.dispose();
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((surface) => surface.dispose());
    renderer.dispose();
  };
}
