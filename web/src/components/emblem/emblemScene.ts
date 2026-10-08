import {
  ACESFilmicToneMapping, BackSide, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide,
  ExtrudeGeometry, Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, Path, PerspectiveCamera, PlaneGeometry,
  PMREMGenerator, PointLight, RepeatWrapping, SRGBColorSpace, Scene, Shape, WebGLRenderer,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CANVAS_SCALE } from "./constants";

/* The HanMarket coin in WebGL. Loaded on demand (CoinJourney imports this module dynamically), so three.js never
   weighs on the landing page's first paint. The component decides the pose every frame; this only draws it.

   The coin is built here, not loaded: the mark is plain geometry (a ring cut into four hooked quarters around a
   square), so it is extruded from its own measurements with a rounded chamfer on every edge. That keeps the edges
   exact at any size and needs no model download.

   It is finished in two ways, to match the logo on HanMarket's X profile: the faces a fine cast grain (a soft sparkle,
   not a mirror), the walls and chamfers smoother, so the edges carry the light. The colour and exposure were tuned
   until the rendered face's spread of golds matched that logo's. */

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
const COIN_DIAMETER = 1.9; // world units, chamfer included
/** camera distance at which the coin, at zoom 1, fills 1 / CANVAS_SCALE of the canvas height (with a little margin) */
const DISTANCE = (COIN_DIAMETER / 0.94) * CANVAS_SCALE / (2 * Math.tan((FOV / 2) * (Math.PI / 180)));

/* The mark, in units of its outer radius, measured from public/HanMarketLogo.png. */
const RING_OUT = 1;
const RING_IN = 0.805;
const GAP = 0.072; // half the width of the cuts between the quarters
const HOOK = 0.144; // width of each hook
const HOOK_REACH = 0.57; // how far toward the centre a hook reaches
const SQUARE_OUT = 0.48;
const SQUARE_IN = 0.31;
const GOLD = 0xffcc55;
const THICKNESS = 0.15;
const CHAMFER = 0.05;

/** The top-left quarter: an arc of the ring with a hook at each end, one down toward the centre, one across. */
function quarter(): Shape {
  const s = new Shape();
  const yOut = Math.sqrt(RING_OUT ** 2 - GAP ** 2);
  const yIn = Math.sqrt(RING_IN ** 2 - (GAP + HOOK) ** 2);
  s.moveTo(-GAP, yOut);
  s.lineTo(-GAP, HOOK_REACH);
  s.lineTo(-(GAP + HOOK), HOOK_REACH);
  s.lineTo(-(GAP + HOOK), yIn);
  s.absarc(0, 0, RING_IN, Math.atan2(yIn, -(GAP + HOOK)), Math.atan2(GAP + HOOK, -yIn), false);
  s.lineTo(-HOOK_REACH, GAP + HOOK);
  s.lineTo(-HOOK_REACH, GAP);
  s.lineTo(-yOut, GAP);
  s.absarc(0, 0, RING_OUT, Math.atan2(GAP, -yOut), Math.atan2(yOut, -GAP), true);
  return s;
}

function square(): Shape {
  const s = new Shape();
  s.moveTo(-SQUARE_OUT, -SQUARE_OUT);
  s.lineTo(SQUARE_OUT, -SQUARE_OUT);
  s.lineTo(SQUARE_OUT, SQUARE_OUT);
  s.lineTo(-SQUARE_OUT, SQUARE_OUT);
  s.closePath();
  const hole = new Path();
  hole.moveTo(-SQUARE_IN, -SQUARE_IN);
  hole.lineTo(-SQUARE_IN, SQUARE_IN);
  hole.lineTo(SQUARE_IN, SQUARE_IN);
  hole.lineTo(SQUARE_IN, -SQUARE_IN);
  hole.closePath();
  s.holes.push(hole);
  return s;
}

/** ExtrudeGeometry keeps its caps (group 0) apart from its walls and chamfers (group 1): split them into two geometries. */
function splitCapsAndWalls(source: BufferGeometry): [BufferGeometry, BufferGeometry] {
  const out: [BufferGeometry, BufferGeometry] = [new BufferGeometry(), new BufferGeometry()];
  for (const name of ["position", "normal", "uv"]) {
    const attr = source.getAttribute(name);
    const slices: Float32Array[][] = [[], []];
    for (const g of source.groups) {
      slices[g.materialIndex ?? 0].push((attr.array as Float32Array).slice(g.start * attr.itemSize, (g.start + g.count) * attr.itemSize));
    }
    slices.forEach((parts, i) => {
      const joined = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
      parts.reduce((offset, p) => (joined.set(p, offset), offset + p.length), 0);
      out[i].setAttribute(name, new BufferAttribute(joined, attr.itemSize));
    });
  }
  return out;
}

/** The coin as two geometries: its faces (grained) and its walls with their chamfers (smoother). */
function coinGeometry(): [BufferGeometry, BufferGeometry] {
  const options = { depth: THICKNESS, bevelEnabled: true, bevelThickness: CHAMFER, bevelSize: CHAMFER, bevelSegments: 3, curveSegments: 96 };
  const q = new ExtrudeGeometry(quarter(), options);
  // the mark has quarter-turn symmetry: the other three quarters are the first one turned
  const parts = [0, 1, 2, 3].map((k) => q.clone().rotateZ((-k * Math.PI) / 2));
  parts.push(new ExtrudeGeometry(square(), options));
  const split = parts.map(splitCapsAndWalls);
  const toWorld = COIN_DIAMETER / 2 / (RING_OUT + CHAMFER); // the chamfer adds to the outline, so it counts in the size
  const result = [0, 1].map((i) => {
    const merged = mergeGeometries(split.map((s) => s[i]));
    merged.translate(0, 0, -THICKNESS / 2);
    merged.scale(toWorld, toWorld, toWorld);
    return merged;
  }) as [BufferGeometry, BufferGeometry];
  [q, ...parts, ...split.flat()].forEach((g) => g.dispose());
  return result;
}

/** Cast gold: a fine noise, used as the faces' bump map, so the faces sparkle softly instead of mirroring the studio. */
function grainTexture(size = 1024) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = image.data[i + 1] = image.data[i + 2] = 128 + (Math.random() - 0.5) * 70;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(4, 4);
  return texture;
}

/**
 * The studio the gold reflects. A metal shows its surroundings, not its own colour, so this is where the look is
 * made: a dim warm wall behind the camera, brighter toward one corner, for the flat faces (gold with a gradient
 * across it), bright softboxes above and to the left for the chamfers (the lines of light along every edge), and a
 * dark warm floor so the lower edges fall into amber.
 */
function studioScene() {
  const scene = new Scene();
  scene.add(new Mesh(new BoxGeometry(30, 30, 30), new MeshBasicMaterial({ color: 0x0a0704, side: BackSide })));
  const panels: [number, number, [number, number, number], number, number][] = [
    [16, 12, [0, 0, 10.5], 0xffdcaa, 0.45],
    [6, 6, [2.5, -2.5, 10], 0xffe9c6, 2.4],
    [6, 6, [-2.5, 2.5, 10], 0xffe0b0, 0.45],
    [10, 3, [0, 8, 4], 0xfff6e8, 14],
    [3, 10, [-8, 2, 4], 0xfff0d8, 11],
    [3, 10, [8, -1, 4], 0xffd9a0, 3.85],
    [10, 3, [0, -8, 3], 0x8a5a20, 0.8],
  ];
  for (const [w, h, position, color, power] of panels) {
    const panel = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(power), side: DoubleSide }));
    panel.position.set(...position);
    panel.lookAt(0, 0, 0);
    scene.add(panel);
  }
  return scene;
}

export async function createEmblemScene(canvas: HTMLCanvasElement): Promise<EmblemScene> {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.88;

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const studio = studioScene();
  const envMap = pmrem.fromScene(studio, 0.02).texture;
  scene.environment = envMap;

  const camera = new PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.set(0, 0, DISTANCE);

  // the travelling highlight: a small warm light that sweeps across in front of the coin every few seconds
  const glint = new PointLight(0xfff4d8, 0, 7, 1.6);
  glint.position.set(0, 0.6, 1.8);
  scene.add(glint);

  const grain = grainTexture();
  // rough enough that the faces average the studio rather than mirror one softbox: the gold then holds its colour as
  // the coin rocks and turns, instead of flashing pale whenever a face swings toward a light
  const faceMaterial = new MeshPhysicalMaterial({ color: GOLD, metalness: 1, roughness: 0.5, bumpMap: grain, bumpScale: 0.35 });
  const wallMaterial = new MeshPhysicalMaterial({ color: GOLD, metalness: 1, roughness: 0.25 });
  const [faces, walls] = coinGeometry();
  const pivot = new Group();
  pivot.add(new Mesh(faces, faceMaterial), new Mesh(walls, wallMaterial));
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
      faces.dispose();
      walls.dispose();
      faceMaterial.dispose();
      wallMaterial.dispose();
      grain.dispose();
      envMap.dispose();
      studio.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        (mesh.material as MeshBasicMaterial).dispose();
      });
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
