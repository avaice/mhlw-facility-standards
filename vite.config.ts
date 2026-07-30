/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pagesのサブパス配信でも動くよう相対パスで出力する
  base: "./",
  plugins: [react()],
  test: {
    include: ["src/**/*.test.ts", "updater/**/*.test.ts"],
    environment: "node",
  },
});
