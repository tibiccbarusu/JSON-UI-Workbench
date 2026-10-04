import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayoutBoxesForFile } from '../../editor-core/src/preview/canvas-preview.js';

function layout(value) {
  const source = { rootId: 'root', nodesById: {
    root: { id: 'root', type: 'panel', props: { size: [value, 20] }, children: [] },
  } };
  const before = JSON.stringify(source);
  const result = computeLayoutBoxesForFile(source, { width: 100, height: 100 });
  assert.equal(JSON.stringify(source), before);
  return result;
}

test('演算子のない寸法項を黙って加算・連結せず、元の属性位置を診断する', () => {
  for (const input of ['10px20px', '50%10%', '1.2.3', '10 20', '10px 20px']) {
    const result = layout(input);
    assert.ok(result.warnings.includes('LAYOUT_SCALAR_UNSUPPORTED:root:size:0'), input);
    assert.equal(result.boxes[0].w, 100, input);
  }
});

test('符号と空白付きの正しい加減算、割合、小数、負の項は保持する', () => {
  for (const [input, expected] of [
    ['100% - 12', 88], ['-10px+30px', 20], ['50% + .5px', 50.5],
    ['10px - 2px + 3px', 11], ['- 10px + 30px', 20],
  ]) {
    const result = layout(input);
    assert.equal(result.boxes[0].w, expected, input);
    assert.equal(result.warnings.some(item => item.startsWith('LAYOUT_SCALAR_UNSUPPORTED')), false, input);
  }
});
