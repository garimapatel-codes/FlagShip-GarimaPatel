// Vite settings: the web app lives in web/, the .env file in the project root.
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // Where the site lives on the web server. Locally it is "/" (http://localhost:5173/).
  // On GitHub Pages a project site lives at https://<user>.github.io/<repo>/, so the
  // Pages workflow sets BASE_PATH=/<repo>/ before building. Nothing to set for local dev.
  base: process.env.BASE_PATH || '/',
  root: here('./web'),          // index.html and arena.html are in web/
  envDir: here('./'),           // read VITE_FLAGSMITH_CLIENT_KEY from ./.env
  build: {
    outDir: here('./dist'),
    emptyOutDir: true,
    rollupOptions: {
      // Two pages: the game (/) and the robot arena (/arena.html)
      input: { main: here('./web/index.html'), arena: here('./web/arena.html') },
    },
  },
});
