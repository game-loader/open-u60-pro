import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// 构建产物为单个 index.html（JS/CSS 全部内联），
// 输出到 zte-agent/web-dist，由 Rust 端 rust-embed 嵌入二进制。
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  base: './',
  build: {
    outDir: '../zte-agent/web-dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4096,
  },
  server: {
    port: 5173,
    // 本地开发时代理到真实设备
    proxy: {
      '/api': {
        target: process.env.ZTE_AGENT_URL || 'http://192.168.0.1:9090',
        changeOrigin: true,
      },
    },
  },
})
