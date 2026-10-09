/**
 * Frees a canvas's WebGL context once the canvas has really left the page. A browser keeps only about 16 contexts
 * alive and drops the oldest past that, and the landing page remounts its cloud and coin canvases on every language
 * change (their intro replays). Not on an effect rerun, a theme change or React's StrictMode check: those reuse the
 * same canvas, which stays in the page, and losing its context there would leave it blank.
 */
export function releaseWebGLWhenDetached(canvas: HTMLCanvasElement) {
  window.setTimeout(() => {
    if (canvas.isConnected) return;
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }, 0);
}
