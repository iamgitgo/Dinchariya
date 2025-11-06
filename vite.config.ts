import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  // This should be the name of your GitHub repository.
  base: '/Dinchariya/',
  build: {
    // Output directory for the build. GitHub Pages can be configured to use this folder.
    outDir: 'docs'
  }
})
