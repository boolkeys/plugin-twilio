import { build } from 'esbuild';
import { glob } from 'glob';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { rm } from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const __dirname = dirname(fileURLToPath(import.meta.url));

async function buildPlugin() {

    // Clean previous build
    console.log('🧹 Cleaning previous build...');
    await rm('dist', { recursive: true, force: true });

    // run TypeScript type checking
    console.log('🔍 Running TypeScript type checking...');
    try {
        await execAsync('tsc --noEmit');
    } catch (error) {
        console.error('❌ TypeScript type checking failed:', error.stdout);
        process.exit(1);
    }

    console.log('🔍 Finding source files...');
    const entryPoints = await glob('src/**/*.ts', {
        cwd: dirname(__dirname),
        absolute: true,
    });
    console.log(`📁 Found ${entryPoints.length} files to build`);

    try {
        console.log('🚀 Starting build...');
        await build({
            entryPoints,
            outdir: 'dist',
            platform: 'node',
            format: 'esm',
            target: 'node18',
            bundle: true,
            sourcemap: true,
            external: [
                '@elizaos/core',
                'twilio',
                'express',
                'uuid',
                'express-rate-limit'
            ],
            logLevel: 'info',
            mainFields: ['module', 'main'],
            banner: {
                js: '// @ts-check\n'
            },
            outExtension: { '.js': '.js' }
        });

        console.log('✅ Build completed successfully');
    } catch (error) {
        console.error('❌ Build failed:', error);
        process.exit(1);
    }
}

buildPlugin().catch(err => {
    console.error('❌ Unhandled error:', err);
    process.exit(1);
});