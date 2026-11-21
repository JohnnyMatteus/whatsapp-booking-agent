// Empacota os entrypoints de um serviço Node com esbuild.
// Os pacotes do workspace (@wba/*) entram no bundle (são código-fonte TypeScript); as
// dependências npm ficam externas e são instaladas na imagem com `pnpm deploy --prod`.
// Uso: node ../../tools/bundle.mjs src/main.ts [src/outro.ts ...]
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import process from 'node:process';

const entryPoints = process.argv.slice(2);
if (entryPoints.length === 0) {
  process.stderr.write('informe ao menos um entrypoint\n');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith('@wba/'));

await build({
  entryPoints,
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external,
  logLevel: 'warning',
});
