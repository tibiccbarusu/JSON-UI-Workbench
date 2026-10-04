/** 共通の純粋ロジックをNodeで検査する。ブラウザDOM実行の代用とは判定しない。 */
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
const root=new URL('../',import.meta.url);
const testsRoot=new URL('editor-core/tests/',root);
const {getRegisteredTests,runRegisteredTests}=await import(new URL('test-harness.js',testsRoot));
const sources=new Map(),hashes={};
for(const name of (await readdir(testsRoot)).filter(x=>/^suite-.*\.js$/u.test(x)).sort()){
 const before=new Set(getRegisteredTests().map(x=>x.fn));
 const url=new URL(name,testsRoot);hashes[name]=createHash('sha256').update(await readFile(url)).digest('hex');
 await import(url);
 for(const item of getRegisteredTests())if(!before.has(item.fn)&&!sources.has(item.name))sources.set(item.name,'editor-core/tests/'+name);
}
const report=await runRegisteredTests();
report.run_id='core-'+randomUUID();report.node=process.version;report.platform=process.platform;
report.scope='純粋ロジック・mock付きCanvas呼び出し。ブラウザDOMや実機合格を意味しない';
report.suite_sha256=hashes;
report.results=report.results.map(row=>({...row,registrationModule:sources.get(row.name)||null,status:row.ok?'PASS':'FAIL'}));
report.finished_at=new Date().toISOString();report.status=report.totals.failed?'FAIL':'PASS';
const serialized=JSON.stringify(report,null,2)+'\n';
if(process.argv[2])await writeFile(process.argv[2],serialized);else process.stdout.write(serialized);
if(report.totals.failed)process.exitCode=1;
console.error(JSON.stringify({status:report.status,...report.totals}));
