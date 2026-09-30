import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      react(),
      nodePolyfills({
        include: ['buffer'],
        globals: {
          Buffer: true,
        },
      }),
    ],
    // `npm run dev` only. The terminal's prices, candles and option quotes come from /api, which in production is the
    // serverless functions in web/api. Locally /api is forwarded to the deployed site, so the dev server alone gives a
    // working terminal. To run this checkout's own handlers instead: `npm run dev:api` in a second terminal, then start
    // the dev server with VITE_API_PROXY=http://localhost:8787 (a build never reads this).
    server: {
      proxy: {
        // not /api/_lib/*: those are source files the terminal imports (ABIs, deployment parsing), which Vite itself serves
        '^/api/(?!_lib/)': { target: env.VITE_API_PROXY || 'https://hanmarket.vercel.app', changeOrigin: true },
      },
    },
  }
})
