function readRootTokens(css){
  const match=String(css).match(/:root\s*\{([^}]*)\}/s);
  if(!match)return{};
  const out={};
  for(const decl of match[1].split(';')){
    const i=decl.indexOf(':');
    if(i<0)continue;
    const key=decl.slice(0,i).trim();
    const value=decl.slice(i+1).trim();
    if(key.startsWith('--')&&value)out[key]=value;
  }
  return out;
}
function hexToRgb(hex){
  const value=String(hex).trim().replace('#','');
  if(!/^[0-9a-f]{6}$/i.test(value))throw new TypeError(`HEX_COLOR_REQUIRED:${hex}`);
  return [0,2,4].map(i=>parseInt(value.slice(i,i+2),16)/255);
}
function channel(v){return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;}
function luminance(hex){const [r,g,b]=hexToRgb(hex).map(channel);return 0.2126*r+0.7152*g+0.0722*b;}
function contrast(a,b){const l1=luminance(a),l2=luminance(b);const hi=Math.max(l1,l2),lo=Math.min(l1,l2);return (hi+0.05)/(lo+0.05);}
module.exports={readRootTokens,contrast};
