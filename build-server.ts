import * as esbuild from 'esbuild';

esbuild.build({
  entryPoints: ['server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: 'dist/server.cjs',
  format: 'cjs',
  external: ['express', 'multer', 'cors', 'xlsx', 'lodash', 'fuse.js', 'date-fns', 'vite'],
}).catch(() => process.exit(1));
