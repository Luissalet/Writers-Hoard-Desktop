const { app } = require('electron');
const { build } = require('esbuild');
const path = require('node:path');
const temporary = process.env.WH_MEDIA_TEST_ROOT;
if (!temporary) throw new Error('Use run-media-commons-tests.mjs');
app.setPath('userData', path.join(temporary, 'user-data'));
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  let exitCode = 0;
  try {
    const outfile = path.join(temporary, 'media-commons.cjs');
    await build({ entryPoints: [path.join(__dirname, '..', 'tests', 'media-commons.ts')], outfile,
      bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['electron'],
      plugins: [{ name: 'production-ffmpeg', setup(builder) {
        builder.onResolve({ filter: /^ffmpeg-static$/ }, () => ({ path: require.resolve('ffmpeg-static'), external: true }));
      } }],
    });
    const result = await require(outfile).runMediaCommonsTests(temporary);
    for (const name of result) console.log(`PASS ${name}`);
    console.log(`${result.length} media integration/security checks passed`);
  } catch (error) {
    console.error(error); exitCode = 1;
  }
  app.exit(exitCode);
});
