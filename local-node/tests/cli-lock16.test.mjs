import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rename, rm, stat, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { lockSession } from '../cli-files.mjs';

async function fixture(t) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'jsonui-lock16-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const session=path.join(directory,'session.json');
  return {session,lock:`${session}.lock`,directory};
}

test('own token survives filesystem file-ID replacement and permits next command',async t=>{
  const {session,lock}=await fixture(t),release=await lockSession(session);
  const bytes=await readFile(lock),original=await stat(lock);
  assert.match(JSON.parse(bytes).owner_token,/^[a-f0-9-]{36}$/u);
  await rename(lock,lock+'.moved');await writeFile(lock,bytes);
  const changed=await stat(lock);assert.notEqual(changed.ino,original.ino);
  await release();await assert.rejects(stat(lock),{code:'ENOENT'});
  const next=await lockSession(session);await next();
});

test('changed owner token on the same file identity is preserved',async t=>{
  const {session,lock}=await fixture(t),release=await lockSession(session);
  const first=await readFile(lock,'utf8'),row=JSON.parse(first),original=await stat(lock);
  row.owner_token='00000000-0000-4000-8000-000000000000';
  const replacement=JSON.stringify(row)+'\n';await writeFile(lock,replacement);
  assert.equal((await stat(lock)).ino,original.ino);
  await release();assert.equal(await readFile(lock,'utf8'),replacement);
  await assert.rejects(lockSession(session),{code:'CLI_SESSION_LOCKED'});
});

test('replacement, oversized files and symlinks are never removed by older owner',async t=>{
  for(const kind of ['replacement','oversized','symlink']){
    const {session,lock,directory}=await fixture(t),release=await lockSession(session);
    await rm(lock);
    let replacementRelease;
    if(kind==='replacement')replacementRelease=await lockSession(session);
    else if(kind==='oversized')await writeFile(lock,'x'.repeat(4096));
    else { const target=path.join(directory,'target');await writeFile(target,'preserve');await symlink(target,lock); }
    const before=await readFile(lock);await release();await release();
    assert.deepEqual(await readFile(lock),before);
    await replacementRelease?.();
  }
});
