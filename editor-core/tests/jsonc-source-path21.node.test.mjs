import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonc } from '../src/json/jsonc.js';

test('JSONC source path alias retains asset diagnostic provenance', () => {
 const a = parseJsonc('{"broken":}', { filePath: 'textures/ui/panel.json' });
 const b = parseJsonc('{"broken":}', { fileName: 'textures/ui/panel.json' });
 assert.equal(a.ok, false); assert.deepEqual(a, b);
 assert.match(a.errors[0].message, /^textures\/ui\/panel\.json:/);
});
test('JSONC fileName keeps precedence and path alias does not alter values', () => {
 const a = parseJsonc('{"broken":}', { fileName: 'ui/primary.json', filePath: 'ui/secondary.json' });
 assert.match(a.errors[0].message, /^ui\/primary\.json:/);
 assert.deepEqual(parseJsonc('\ufeff{ /*c*/ "s":"literal",}', {filePath:'ui/good.json'}), {ok:true,value:{s:'literal'},errors:[]});
});
