import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'
import { existsSync, readFileSync } from 'node:fs'
import { remoteRelay } from './remote-relay.ts'
import { serviceWorker } from './pwa.ts'

// `bun run dev:phone` serves over HTTPS on the LAN so a phone can use Web MIDI
// (browsers only allow it in secure contexts). Uses the self-signed cert in
// ../.cache/dev-cert; see README for how to create it.
const certDir = new URL('../.cache/dev-cert/', import.meta.url)
const https = process.env.HTTPS && existsSync(new URL('cert.pem', certDir))
  ? { key: readFileSync(new URL('key.pem', certDir)), cert: readFileSync(new URL('cert.pem', certDir)) }
  : undefined

// https://vite.dev/config/
export default defineConfig({
  // Relative paths, so the built app also works from a subfolder (GitHub Pages).
  base: './',
  // remoteRelay: phones control the amp through the browser it is connected to.
  // serviceWorker: the installed app works offline.
  plugins: [svelte(), remoteRelay(), serviceWorker()],
  server: {
    https,
    // Demo mode loads the recorded session from ../test/fixtures.
    fs: { allow: ['..'] },
  },
})
