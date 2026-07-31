/// <reference types="vitest/config" />
import { copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// GitHub Pagesはリポジトリ名のサブパスで配信されるため、
// pages.ymlがactions/configure-pagesの出力（例: /mhlw-facility-standards）を渡す。
const rawBase = process.env.SITE_BASE_PATH ?? "/";
const base = rawBase.endsWith("/") ? rawBase : `${rawBase}/`;

// パス方式のルーティングをGitHub Pagesで成立させるため、
// index.htmlと同じ内容の404.htmlを出力してSPAフォールバックにする。
function spaFallback(): Plugin {
  let outDir = "dist";
  return {
    name: "spa-fallback-404",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      await copyFile(resolve(outDir, "index.html"), resolve(outDir, "404.html"));
    },
  };
}

export default defineConfig({
  base,
  plugins: [react(), tailwindcss(), spaFallback()],
  test: {
    include: [
      "src/**/*.test.ts",
      "updater/**/*.test.ts",
      "shared/**/*.test.ts",
    ],
    environment: "node",
  },
});
