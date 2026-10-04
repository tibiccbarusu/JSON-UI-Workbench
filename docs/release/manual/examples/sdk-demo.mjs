#!/usr/bin/env node
/** node docs/release/manual/examples/sdk-demo.mjs [pack] [new-output-directory] */
import { createRenderer } from '../../../../local-node/api.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const pack = path.resolve(process.argv[2] || 'outputs/manual-demo.mcpack');
const directory = path.resolve(process.argv[3] || 'outputs/sdk-demo');
// Require a new directory, so this teaching example never replaces a previous result.
await mkdir(directory, { recursive: false });
const renderer = await createRenderer();
try {
  await renderer.import({ pack });
  const selector = { file: 'ui/manual_demo.json', definition: 'manual.screen', width: 640, height: 360, uiScale: 2, frame: 0 };
  const uiInstanceId = 'manual-instance-1';
  const initial = await renderer.render({ ...selector, format: 'json', strictSemantics: true, uiInstanceId });
  const localToggleState = initial.frame.bindings.localToggleState;
  const target = initial.frame.layout.boxes.find(box => box.id.endsWith('/switch'));
  if (!target) throw new Error('The tutorial switch was not found. Use the pack created by build-demo.mjs.');
  const before = await renderer.render({ ...selector, format: 'png', strictSemantics: true, uiInstanceId, localToggleState });
  const changed = await renderer.interact({ ...selector, uiInstanceId, localToggleState, expectedRevision: localToggleState.revision,
    nodeId: target.id, event: 'activate', inputSource: 'mouse' });
  const after = await renderer.render({ ...selector, format: 'png', strictSemantics: true, uiInstanceId, localToggleState: changed.localToggleState });
  const sound = changed.audioIntent ? await renderer.resolveSound({ soundId: changed.audioIntent.soundName, selectionSeed: uiInstanceId }) : null;
  await writeFile(path.join(directory, 'before.png'), before.png, { flag: 'wx' });
  await writeFile(path.join(directory, 'after.png'), after.png, { flag: 'wx' });
  const report = { schema: 'jsonui-manual-sdk-demo-v1', ok: true, before_quality: before.quality, after_quality: after.quality,
    interaction: changed, sound, playback: 'not_executed', native_equivalence: 'not_evaluated' };
  await writeFile(path.join(directory, 'result.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ ok: true, directory, interaction_status: changed.interaction.status, revision: changed.localToggleState.revision,
    audio_intent: Boolean(changed.audioIntent), playback: 'not_executed', native_equivalence: 'not_evaluated' }));
} finally { await renderer.close(); }
