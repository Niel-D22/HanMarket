import {
  ACESFilmicToneMapping, AmbientLight, Box3, DirectionalLight, Group, Mesh, MeshStandardMaterial, PerspectiveCamera,
  PMREMGenerator, PointLight, SRGBColorSpace, Scene, Vector3, WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { CANVAS_SCALE } from "./constants";

/* The HanMarket coin in WebGL. Loaded on demand (CoinJourney imports this module dynamically), so three.js never
   weighs on the landing page's first paint. The component decides the pose every frame; this only draws it. */

/** One frame's pose, chosen by CoinJourney. */
export interface EmblemPose {
  /** turn about the vertical axis, radians (0 = the face toward the viewer) */
  spin: number;
  /** tilt toward the pointer, radians */
  tiltX: number;
  tiltY: number;
  /** 1 = the coin fills 1 / CANVAS_SCALE of the canvas, the size of the hero slot; the canvas leaves room to zoom */
  zoom: number;
  /** where the travelling highlight is, -1 (left of the coin) to 1 (right); outside that range it is off */
  glint: number;
}

export interface EmblemScene {
  render: (pose: EmblemPose) => void;
  resize: (width: number, height: number, dpr: number) => void;
  dispose: () => void;
}

const FOV = 30;
const COIN_DIAMETER = 1.9; // the model's own size, in its units
/** camera distance at which the coin, at zoom 1, fills 1 / CANVAS_SCALE of the canvas height (with a little margin) */
const DISTANCE = (COIN_DIAMETER / 0.94) * CANVAS_SCALE / (2 * Math.tan((FOV / 2) * (Math.PI / 180)));

export async function createEmblemScene(canvas: HTMLCanvasElement, url: string): Promise<EmblemScene> {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new Scene();
  // a soft studio room for the gold to reflect; without an environment a metal renders nearly black
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envMap = pmrem.fromScene(room, 0.04).texture;
  scene.environment = envMap;

  const camera = new PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.set(0, 0, DISTANCE);

  scene.add(new AmbientLight(0xffffff, 0.25));
  const key = new DirectionalLight(0xfff0d6, 2.2);
  key.position.set(-3, 4, 5);
  scene.add(key);
  const rim = new DirectionalLight(0xffd9a0, 1.4);
  rim.position.set(4, -2, -3);
  scene.add(rim);
  // the travelling highlight: a small warm light that sweeps across in front of the coin every few seconds
  const glint = new PointLight(0xfff4d8, 0, 7, 1.6);
  glint.position.set(0, 0.6, 1.8);
  scene.add(glint);

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  const model = gltf.scene;
  model.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as MeshStandardMaterial;
    // the exported roughness map reads as brushed brass; scaling it down gives a polished, reflective gold
    mat.roughness = 0.42;
    mat.metalness = 1;
    mat.envMapIntensity = 1.35;
  });
  // centred on its own middle, and turned so its face (the model lies flat along Y) looks at the camera
  const center = new Box3().setFromObject(model).getCenter(new Vector3());
  model.position.sub(center);
  const facing = new Group();
  facing.rotation.x = Math.PI / 2;
  facing.add(model);
  const pivot = new Group();
  pivot.add(facing);
  scene.add(pivot);

  return {
    render(pose) {
      pivot.rotation.set(pose.tiltX, pose.spin + pose.tiltY, 0);
      pivot.scale.setScalar(pose.zoom);
      const on = pose.glint >= -1 && pose.glint <= 1;
      glint.intensity = on ? 9 * Math.sin(((pose.glint + 1) / 2) * Math.PI) : 0;
      glint.position.x = pose.glint * 1.6 * pose.zoom;
      renderer.render(scene, camera);
    },
    resize(width, height, dpr) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    dispose() {
      model.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const mat = mesh.material as MeshStandardMaterial;
        [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap].forEach((t) => t?.dispose());
        mat.dispose();
      });
      envMap.dispose();
      room.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
