const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'); const path=require('node:path');
const {CONTRACT_REGISTRY}=require('../foundation/cross-domain-contract');

function filesUnder(dir){
  if(!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?filesUnder(path.join(dir,entry.name)):[path.join(dir,entry.name)]);
}

test('http presentation adapters and web have no storage or independent Authority imports',()=>{
  const files=[...filesUnder(path.join(__dirname,'..','http','routes')),...filesUnder(path.join(__dirname,'..','http','view-models')),...filesUnder(path.join(__dirname,'..','web')),path.join(__dirname,'..','http','app.js'),path.join(__dirname,'..','http','request-context.js'),path.join(__dirname,'..','http','errors.js')].filter(f=>f.endsWith('.js'));
  const forbidden=["node:sqlite","../db/","../../db/","authority/policy","evaluateAuthority",".prepare(","SELECT ","INSERT ","UPDATE ","DELETE FROM"];
  for(const file of files){const source=fs.readFileSync(file,'utf8');for(const token of forbidden)assert.equal(source.includes(token),false,`${file} contains ${token}`);}
});

test('http and web are intentionally absent from Foundation state-domain registry',()=>{
  assert.equal(CONTRACT_REGISTRY.http,undefined); assert.equal(CONTRACT_REGISTRY.web,undefined);
});

test('http server is only a composition root and contains no social queries or Authority decisions',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','http','server.js'),'utf8');
  for(const token of ['.prepare(','SELECT ','INSERT ','UPDATE ','DELETE FROM','authority/policy','evaluateAuthority']) assert.equal(source.includes(token),false,token);
});
