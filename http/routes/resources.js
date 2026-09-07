const { renderProfilePage } = require('../../web/render/profile');
const { renderPublicationPage } = require('../../web/render/publication');
const { renderCommunityPage } = require('../../web/render/community');
const { jsonResponse } = require('./public');
function decodedMatch(pathname,pattern){
  const match=pathname.match(pattern); if(!match) return null;
  try{return decodeURIComponent(match[1]);}catch{return null;}
}
function notFound(){return {status:404,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify({error:'NOT_FOUND'})};}
function createResourceRoutes(){
  return async ({url,services})=>{
    let id=decodedMatch(url.pathname,/^\/actors\/([^/]+)$/);
    if(id!==null){const value=services.loadActor(id); return value?{status:200,headers:{'content-type':'text/html; charset=utf-8'},body:renderProfilePage(value)}:notFound();}
    id=decodedMatch(url.pathname,/^\/publications\/([^/]+)$/);
    if(id!==null){const value=services.loadPublication(id); return value?{status:200,headers:{'content-type':'text/html; charset=utf-8'},body:renderPublicationPage(value)}:notFound();}
    id=decodedMatch(url.pathname,/^\/communities\/([^/]+)$/);
    if(id!==null){const value=services.loadCommunity(id); return value?{status:200,headers:{'content-type':'text/html; charset=utf-8'},body:renderCommunityPage(value)}:notFound();}
    id=decodedMatch(url.pathname,/^\/api\/actors\/([^/]+)$/);
    if(id!==null){const value=services.loadActor(id); return value?jsonResponse(value):notFound();}
    id=decodedMatch(url.pathname,/^\/api\/publications\/([^/]+)$/);
    if(id!==null){const value=services.loadPublication(id); return value?jsonResponse(value):notFound();}
    id=decodedMatch(url.pathname,/^\/api\/communities\/([^/]+)$/);
    if(id!==null){const value=services.loadCommunity(id); return value?jsonResponse(value):notFound();}
    return null;
  };
}
module.exports={createResourceRoutes,decodedMatch,notFound};
