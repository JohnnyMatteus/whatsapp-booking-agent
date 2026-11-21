// Empacota os entrypoints de um serviço Node num único arquivo por entrypoint (esbuild).
// Tudo entra no bundle, inclusive as dependências npm (todas JavaScript puro): a imagem final
// leva só dist/ sobre o Node, sem node_modules nem gerenciador de pacotes.
// Uso: node ../../tools/bundle.mjs src/main.ts [src/outro.ts ...]
import { build } from 'esbuild';
import process from 'node:process';

const entryPoints = process.argv.slice(2);
if (entryPoints.length === 0) {
  process.stderr.write('informe ao menos um entrypoint\n');
  process.exit(1);
}

await build({
  entryPoints,
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  // Dependências CommonJS chamam require() de módulos do Node; no ESM ele precisa existir.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'warning',
});
