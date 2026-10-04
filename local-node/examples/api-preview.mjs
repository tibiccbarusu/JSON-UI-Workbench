#!/usr/bin/env node
/** Runnable SDK example: node local-node/examples/api-preview.mjs request.json
 * request.json: { "pack":"/absolute/addon.mcpack", "file":"ui/example.json",
 * "definition":"example.screen", "out":"/absolute/frame.png", "width":1280,
 * "height":720, "uiScale":4, "state":{ "form":{ "type":"action", "title":"Sample",
 * "body":"Explicit preview data", "buttons":[{ "text":"Continue" }] } } }
 * Use a pack and definition you own. PNG requires the optional Canvas backend.
 */
import { createRenderer } from '../api.mjs';
import { atomicWrite, readJson, checkedPath } from '../cli-files.mjs';

let renderer;
try {
  if (process.argv.length !== 3) throw new Error('Usage: node local-node/examples/api-preview.mjs request.json');
  const input = checkedPath(process.argv[2]);
  const { pack, vanilla, resourcePack, out, settings, ...renderRequest } = await readJson(input);
  if (typeof out !== 'string' || !out) throw new Error('request.json must include out: "/absolute/frame.png".');
  renderer = await createRenderer(settings === undefined ? {} : { settings });
  await renderer.import({ ...(pack === undefined ? {} : { pack }), ...(vanilla === undefined ? {} : { vanilla }),
    ...(resourcePack === undefined ? {} : { resourcePack }) });
  const result = await renderer.render({ ...renderRequest, format: 'png' });
  const artifact = await atomicWrite(out, result.png, { extensions: ['.png'], protectedPaths: [input, pack, vanilla, resourcePack].filter(Boolean), replace: false });
  process.stdout.write(JSON.stringify({ schema: 'jsonui-api-example-v1', ok: true, artifact,
    selected: result.selected, quality: result.quality, native_equivalence: result.native_equivalence }) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({ error: typeof error.toJSON === 'function' ? error.toJSON()
    : { code: 'API_EXAMPLE_FAILED', message: 'Check the configuration, input pack and output path.' } }) + '\n');
  process.exitCode = 1;
} finally { await renderer?.close(); }
