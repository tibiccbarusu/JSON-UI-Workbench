import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildUiScreenModelFromJson } from '../../editor-core/src/model/ui-screen-model.js';
import { buildTreeFromUiScreenModel } from '../../editor-core/src/editor/ui-model-tree.js';
import { computeLayoutBoxesForFile } from '../../editor-core/src/preview/canvas-preview.js';
import { applyPendingGeometry21 } from '../../editor-core/src/ui/editor-draft-geometry21.js';
import { mergePendingProperties21 } from '../../editor-core/src/ui/editor-draft-layout21.js';

test('実mainのドラッグclip再交差は確定属性でなく表示中の草稿属性を使う', async () => {
  const source = await readFile(new URL('../../editor-core/src/main.js', import.meta.url), 'utf8');
  const start = source.indexOf('function applyCanvasDraftToLayout('), end = source.indexOf('\n}\n', start);
  assert(start >= 0 && end > start);
  const draw = source.indexOf('function drawCanvasFrame(');
  const a = source.indexOf('  const pendingTransforms =', draw), b = source.indexOf('  // S041:', a);
  assert(a >= 0 && b > a);
  const origin = { anchor_from: 'top_left', anchor_to: 'top_left' };
  const uiModel = buildUiScreenModelFromJson({ namespace: 'demo', screen: { type: 'screen', ...origin, size: [100, 100], clips_children: false,
    controls: [{ child: { type: 'label', ...origin, offset: [95, 0], size: [20, 20], text: 'clip' } }] } }, { filePath: 'ui/a.json' });
  const file = { uiModel, ...buildTreeFromUiScreenModel(uiModel) }, id = uiModel.root.children[0].id;
  const props = { [id]: { clips_children: true } };
  const layout = computeLayoutBoxesForFile(file, { width: 100, height: 100 }, { propsByIdOverride: props });
  const parent = layout.boxes.find(box => box.id === id);
  const cs = { layout, propsByIdOverride: {}, view: {}, interaction: { active: true, moved: true, mode: 'move', targetId: id,
    startBox: parent, draftBox: { ...parent, x: parent.x + 10 } } };
  const context = vm.createContext({ file, committedFile23: file, fileId: 'f', cs,
    draftScene23: { file, layout, propsByIdOverride: props }, sourceWorkspace: { state: {} },
    applyPendingGeometry21, mergePendingProperties21 });
  vm.runInContext(source.slice(start, end + 2) + '\n' + source.slice(a, b) + '\nthis.result = layoutForDraw;', context);
  const child = context.result.boxes.find(box => box.id.endsWith('/child'));
  assert.equal(child.x, 105); assert.deepEqual(child.clipRect, { x: 10, y: 0, w: 100, h: 100 });
  assert.equal(layout.boxes.find(box => box.id.endsWith('/child')).clipRect.x, 0, '確定・草稿の元layoutは変更しない');
});
