import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/index.ts"],
    outDir: "dist",
    sourcemap: true,
    clean: true,
    format: ["esm"],
    dts: {
        // Enable declaration file generation with more stable settings
        entry: "./src/index.ts",
        resolve: true
    },
    external: [
        "twilio",
        "express",
        "express-rate-limit",
        "@elizaos/core",
        "uuid",
        "elevenlabs-node",
    ],
    treeshake: true,
    splitting: false,
    minify: false
});
