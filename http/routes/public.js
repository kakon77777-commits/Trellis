const { renderHomePage } = require('../../web/render/home');
const { renderExplorePage } = require('../../web/render/explore');
function jsonResponse(value,status=200){return {status,headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify(value)};}
function parseLimit(url){
  if(!url.searchParams.has('limit')) return 20;
  const value=Number(url.searchParams.get('limit'));
  if(!Number.isInteger(value)||value<1||value>100) throw new TypeError('INVALID_PUBLIC_LIMIT');
  return value;
}
function createPublicRoutes(){
  return async ({url,services})=>{
    if(url.pathname==='/'){return {status:200,headers:{'content-type':'text/html; charset=utf-8'},body:renderHomePage(await services.loadPublicFeed({limit:20,cursor:null}))};}
    if(url.pathname==='/discover'){return {status:200,headers:{'content-type':'text/html; charset=utf-8'},body:renderExplorePage(await services.loadPublicDirectory())};}
    if(url.pathname==='/api/public/feed'){
      return jsonResponse(await services.loadPublicFeed({limit:parseLimit(url),cursor:url.searchParams.get('cursor')}));
    }
    if(url.pathname==='/api/public/directory') return jsonResponse(await services.loadPublicDirectory());
    return null;
  };
}
module.exports={createPublicRoutes,jsonResponse,parseLimit};
