import '../vendor/zip.js-2.8.16/zip.min.js';
import { ZipReader } from '../src/pack-io/zip-reader.js';

const zipLib = globalThis.zip;
if (!zipLib) throw new Error('VENDORED_ZIP_LIBRARY_NOT_LOADED');

zipLib.configure({ useWebWorkers: false });

const writer = new zipLib.ZipWriter(new zipLib.BlobWriter('application/zip'));
await writer.add('probe.txt', new zipLib.TextReader('integrity-probe'), { useWebWorkers: false });
const validBlob = await writer.close();
const validBytes = new Uint8Array(await validBlob.arrayBuffer());

function findSignature(bytes, signature) {
  for (let i = 0; i <= bytes.length - signature.length; i += 1) {
    let match = true;
    for (let j = 0; j < signature.length; j += 1) {
      if (bytes[i + j] !== signature[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

// Central directory file header signature 0x02014b50; its CRC-32 field starts
// 16 bytes after the signature. Alter only the advertised checksum so the
// compressed payload remains readable and the integrity gate is what rejects it.
const corruptBytes = validBytes.slice();
const centralOffset = findSignature(corruptBytes, [0x50, 0x4b, 0x01, 0x02]);
if (centralOffset < 0) throw new Error('CENTRAL_DIRECTORY_NOT_FOUND');
new DataView(corruptBytes.buffer).setUint32(centralOffset + 16, 0xdeadbeef, true);
const corruptBlob = new Blob([corruptBytes], { type: 'application/zip' });

async function readProbe(blob, filename) {
  const reader = new ZipReader({ limits: { useWebWorkers: false } });
  try {
    await reader.openFromFile(new File([blob], filename, { type: 'application/zip' }));
    return await reader.readText('probe.txt');
  } finally {
    await reader.close();
  }
}

const validText = await readProbe(validBlob, 'valid.zip');
if (validText !== 'integrity-probe') throw new Error('VALID_ZIP_READ_MISMATCH');

let corruptRejected = false;
let corruptError = null;
try {
  await readProbe(corruptBlob, 'corrupt-crc.zip');
} catch (error) {
  corruptRejected = true;
  corruptError = error instanceof Error ? error.message : String(error);
}

const result = {
  status: corruptRejected ? 'PASS' : 'FAIL',
  validZipRead: validText === 'integrity-probe',
  corruptCrcRejected: corruptRejected,
  corruptError,
};
console.log(JSON.stringify(result, null, 2));
if (!corruptRejected) process.exitCode = 1;
