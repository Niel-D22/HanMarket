import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";

/* ============================================================================
   Cloudscape — soft fbm-noise clouds drawn in a WebGL shader.
   Ported for this project (no Tailwind / `cn`), plus a `fadeTop` mode used by
   the HanMarket hero: the canvas is transparent and wispy along its top edge and
   becomes solid `colorMid` toward the bottom, so a solid block of the same
   colour can continue below it without a seam.
   Rendering pauses while the canvas is off screen, and draws one still frame
   for prefers-reduced-motion.
============================================================================ */

const vertexShaderGLSL = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const fragmentShaderGLSL = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_colorBottom;
uniform vec3 u_colorMid;
uniform vec3 u_colorTop;
uniform float u_speed;
uniform float u_fadeTop;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 p, float t) {
  float v = 0.0;
  float a = 0.5;
  float fi = 0.0;
  mat2 rot = mat2(0.86, 0.51, -0.51, 0.86);
  for (int i = 0; i < 6; i++) {
    vec2 morph = vec2(sin(t * 0.5 + fi), cos(t * 0.3 - fi)) * 0.05;
    v += a * noise(p + morph);
    p = rot * p * 2.0;
    a *= 0.5;
    fi += 1.0;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float t = u_time * u_speed;
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  vec2 p = (uv - 0.5) * aspect;
  vec2 wind = vec2(t * 0.1, t * 0.02);
  float pattern = fbm(p * 2.2 - wind, t);

  float bandLow = smoothstep(0.3, 0.65, pattern);
  float bandHigh = smoothstep(0.7, 0.95, pattern);
  vec3 color = mix(u_colorBottom, u_colorMid, bandLow);
  color = mix(color, u_colorTop, bandHigh);

  float alpha = 1.0;
  if (u_fadeTop > 0.5) {
    float depth = 1.0 - uv.y; // 0 at the top edge, 1 at the bottom
    // the noise pushes the edge up and down, so the top reads as billowing cloud, not a gradient
    alpha = smoothstep(0.0, 0.85, depth * 1.05 + (pattern - 0.5) * 0.9);
    // settle into the flat mid colour at the bottom so a solid block can continue below
    color = mix(color, u_colorMid, smoothstep(0.72, 0.99, depth));
  }
  gl_FragColor = vec4(color * alpha, alpha);
}
`;

interface CloudscapeProps {
  colorBottom?: string;
  colorMid?: string;
  colorTop?: string;
  speed?: number;
  height?: string;
  fadeTop?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

function hexToRgb(hex: string): [number, number, number] {
  const v = /^#?[0-9a-fA-F]{6}$/.test(hex.trim()) ? hex.trim().replace("#", "") : "0d1117";
  return [parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255];
}

export function Cloudscape({
  colorBottom = "#87ceeb",
  colorMid = "#f8f8f8",
  colorTop = "#ffffff",
  speed = 1,
  height = "100vh",
  fadeTop = false,
  className,
  style,
  children,
}: CloudscapeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;

    const gl = canvas.getContext("webgl", { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: "low-power" });
    if (!gl) return;

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("Cloudscape shader error:", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vs = compile(gl.VERTEX_SHADER, vertexShaderGLSL);
    const fs = compile(gl.FRAGMENT_SHADER, fragmentShaderGLSL);
    const program = gl.createProgram();
    if (!vs || !fs || !program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Cloudscape link error:", gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const u = (name: string) => gl.getUniformLocation(program, name);
    const uRes = u("u_resolution"), uTime = u("u_time"), uSpeed = u("u_speed"), uFade = u("u_fadeTop");
    gl.uniform3fv(u("u_colorBottom"), hexToRgb(colorBottom));
    gl.uniform3fv(u("u_colorMid"), hexToRgb(colorMid));
    gl.uniform3fv(u("u_colorTop"), hexToRgb(colorTop));
    gl.uniform1f(uSpeed, speed);
    gl.uniform1f(uFade, fadeTop ? 1 : 0);

    const resize = () => {
      // soft, blurry clouds don't need full resolution: render at ~60% and let CSS scale the canvas up
      const dpr = Math.min(window.devicePixelRatio || 1, 1) * 0.6;
      const { width, height: h } = host.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    let raf = 0;
    let visible = true;

    const draw = (now: number) => {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uTime, (now - t0) / 1000);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    // the clouds drift slowly, so 30 fps is indistinguishable from 60 and halves the GPU work
    let last = 0;
    const loop = (now: number) => {
      if (now - last >= 32) {
        draw(now);
        last = now;
      }
      raf = visible && !reduce ? requestAnimationFrame(loop) : 0;
    };

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !raf && !reduce) raf = requestAnimationFrame(loop);
    });
    io.observe(host);
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [colorBottom, colorMid, colorTop, speed, fadeTop]);

  return (
    <div ref={hostRef} className={className} style={{ position: "relative", width: "100%", height, overflow: "hidden", ...style }}>
      <canvas ref={canvasRef} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", pointerEvents: "none" }} />
      {children}
    </div>
  );
}

export default Cloudscape;
