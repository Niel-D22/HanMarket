import React, { useEffect, useRef } from 'react';

// Converts a hex color string to normalized RGB values
const hexToRgb = (hex: string) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16) / 255,
        g: parseInt(result[2], 16) / 255,
        b: parseInt(result[3], 16) / 255,
      }
    : { r: 0.368, g: 0.917, b: 0.831 }; // Default #5EEAD4
};

const vertexShaderSource = `
  attribute vec2 position;
  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const fragmentShaderSource = `
  precision mediump float;
  uniform vec2 u_resolution;
  uniform float u_time;
  uniform vec3 u_color;
  uniform float u_intensity;
  uniform float u_scale;
  uniform vec3 u_bgColor;

  // Simplex 2D noise
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy) );
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1;
    i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m ;
    m = m*m ;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  // Fractal Brownian Motion
  float fbm(vec2 x) {
    float v = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100.0);
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
    for (int i = 0; i < 5; ++i) {
      v += a * snoise(x);
      x = rot * x * 2.0 + shift;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 st = gl_FragCoord.xy / u_resolution.xy;
    // Fix aspect ratio
    st.x *= u_resolution.x / u_resolution.y;

    vec2 q = vec2(0.);
    q.x = fbm( st * u_scale + 0.00 * u_time);
    q.y = fbm( st * u_scale + vec2(1.0));

    vec2 r = vec2(0.);
    r.x = fbm( st * u_scale + 1.0 * q + vec2(1.7,9.2)+ 0.15 * u_time );
    r.y = fbm( st * u_scale + 1.0 * q + vec2(8.3,2.8)+ 0.126 * u_time);

    float f = fbm(st * u_scale + r);

    // Smooth and remap the noise
    f = smoothstep(0.0, 1.0, f);
    
    vec3 bg = u_bgColor;
    
    // Combine colors based on noise
    vec3 color = mix(bg, u_color, clamp(f * u_intensity, 0.0, 1.0));
    
    // Vignette
    vec2 p = gl_FragCoord.xy / u_resolution.xy;
    float vignette = smoothstep(2.0, 0.4, length(p - 0.5) * 2.0);
    color = mix(bg, color, vignette);
    
    // Film grain
    float noise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    color += (noise - 0.5) * 0.04;
    
    gl_FragColor = vec4(color, 1.0);
  }
`;

interface SilkBackgroundProps {
  bgColor?: string;     // Background hex
  color?: string;       // Accent hex
  speed?: number;       // Animation multiplier
  intensity?: number;   // Brightness/contrast
  scale?: number;       // Zoom level
}

export const SilkBackground: React.FC<SilkBackgroundProps> = ({
  bgColor = '#0A0A0A',
  color = '#5EEAD4',
  speed = 1.0,
  intensity = 0.25,
  scale = 2.0,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl');
    if (!gl) {
      console.warn('WebGL not supported');
      return;
    }

    // Compile Shader Function
    const compileShader = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    // Create Program
    const vertexShader = compileShader(gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
    const program = gl.createProgram();
    if (!program || !vertexShader || !fragmentShader) return;

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.useProgram(program);

    // Set up fullscreen quad
    const vertices = new Float32Array([
      -1, -1, 
       1, -1, 
      -1,  1, 
      -1,  1, 
       1, -1, 
       1,  1
    ]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const positionLoc = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    // Uniform locations
    const uResolution = gl.getUniformLocation(program, 'u_resolution');
    const uTime = gl.getUniformLocation(program, 'u_time');
    const uColor = gl.getUniformLocation(program, 'u_color');
    const uBgColor = gl.getUniformLocation(program, 'u_bgColor');
    const uIntensity = gl.getUniformLocation(program, 'u_intensity');
    const uScale = gl.getUniformLocation(program, 'u_scale');

    const rgbColor = hexToRgb(color);
    gl.uniform3f(uColor, rgbColor.r, rgbColor.g, rgbColor.b);
    const bgRgb = hexToRgb(bgColor);
    gl.uniform3f(uBgColor, bgRgb.r, bgRgb.g, bgRgb.b);
    gl.uniform1f(uIntensity, intensity);
    gl.uniform1f(uScale, scale);

    let animationFrameId: number;
    let startTime = performance.now();
    
    // Respect prefers-reduced-motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uResolution, canvas.width, canvas.height);
    };

    const render = (time: number) => {
      // Don't update time if reduced motion is enabled
      if (!prefersReducedMotion) {
        const elapsedTime = (time - startTime) * 0.0005 * speed;
        gl.uniform1f(uTime, elapsedTime);
      }
      
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      
      // Pause animation if tab is hidden
      if (document.visibilityState === 'visible' && !prefersReducedMotion) {
        animationFrameId = requestAnimationFrame(render);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !prefersReducedMotion) {
        const currentTime = typeof gl.getUniform(program, uTime as WebGLUniformLocation) === 'number' 
          ? (gl.getUniform(program, uTime as WebGLUniformLocation) as number) 
          : 0;
        startTime = performance.now() - (currentTime / (0.0005 * speed));
        animationFrameId = requestAnimationFrame(render);
      } else {
        cancelAnimationFrame(animationFrameId);
      }
    };

    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibilityChange);
    
    resize();
    render(performance.now());

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      gl.deleteProgram(program);
    };
  }, [color, speed, intensity, scale]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: -1,
        pointerEvents: 'none',
      }}
    />
  );
};
