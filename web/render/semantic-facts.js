const { canonicalStringify } = require('../../core/canonical-json');

function walk(value,path,out){
  if(value===null || typeof value!=='object') { out.push({path,value}); return; }
  if(Array.isArray(value)) {
    if(value.length===0) out.push({path,value:[]});
    value.forEach((item,index)=>walk(item,`${path}[${index}]`,out));
    return;
  }
  const keys=Object.keys(value).sort();
  if(keys.length===0) out.push({path,value:{}});
  for(const key of keys) walk(value[key],path?`${path}.${key}`:key,out);
}

function semanticFactsFromViewModel(resourceType,value){
  const facts=[{path:'$resource_type',value:resourceType}];
  walk(value,'$',facts);
  return facts.sort((a,b)=>a.path.localeCompare(b.path)||canonicalStringify(a.value).localeCompare(canonicalStringify(b.value)));
}
function encodeFact(fact){return Buffer.from(canonicalStringify(fact),'utf8').toString('base64url');}
function renderSemanticFactMarkers(resourceType,value){
  const facts=semanticFactsFromViewModel(resourceType,value);
  return `<div class="semantic-facts" hidden data-semantic-resource="${resourceType}">${facts.map(f=>`<span data-semantic-fact="${encodeFact(f)}"></span>`).join('')}</div>`;
}
function parseSemanticFactMarkers(html){
  const facts=[]; const re=/data-semantic-fact="([A-Za-z0-9_-]+)"/g; let match;
  while((match=re.exec(html))) facts.push(JSON.parse(Buffer.from(match[1],'base64url').toString('utf8')));
  return facts.sort((a,b)=>a.path.localeCompare(b.path)||canonicalStringify(a.value).localeCompare(canonicalStringify(b.value)));
}
module.exports={semanticFactsFromViewModel,renderSemanticFactMarkers,parseSemanticFactMarkers};
