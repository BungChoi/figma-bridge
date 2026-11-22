import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, '..');
const distDir = resolve(pkgRoot, 'dist');

async function build() {
  await mkdir(distDir, { recursive: true });

  // Bundle Figma plugin sandbox code (QuickJS-compatible ES2017 IIFE)
  await esbuild.build({
    entryPoints: [resolve(pkgRoot, 'src/code.ts')],
    outfile: resolve(distDir, 'code.js'),
    bundle: true,
    platform: 'neutral',
    mainFields: ['module', 'main'],
    format: 'iife',
    target: 'es2017',
    sourcemap: false,
    logLevel: 'info',
  });

  // Bundle UI script in memory and inline it into dist/ui.html
  const uiResult = await esbuild.build({
    entryPoints: [resolve(pkgRoot, 'src/ui.ts')],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    sourcemap: false,
    logLevel: 'info',
  });

  const uiScript = uiResult.outputFiles[0]?.text ?? '';
  const safeUiScript = uiScript.replace(/<\/script>/gi, '<\\/script>');
  const template = await readFile(resolve(pkgRoot, 'src/ui.html'), 'utf8');
  const html = template.replace('<!-- INLINE_UI_SCRIPT -->', `<script>${safeUiScript}</script>`);

  await writeFile(resolve(distDir, 'ui.html'), html, 'utf8');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
