const { createPublicRequestContext } = require('./request-context');
const { publicErrorResponse } = require('./errors');

const SECURITY_HEADERS = Object.freeze({
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY'
});

function withSecurityHeaders(response) {
  return { ...response, headers:{...SECURITY_HEADERS,...(response.headers??{})} };
}

async function dispatchRequest(request, { routeHandlers = [], services = {}, assets = {} } = {}) {
  const method=String(request.method ?? 'GET').toUpperCase();
  if (!['GET','HEAD'].includes(method)) {
    return withSecurityHeaders({status:405,headers:{allow:'GET, HEAD','content-type':'text/plain; charset=utf-8'},body:'Method Not Allowed'});
  }
  try {
    const context=createPublicRequestContext(request);
    const url=new URL(request.url ?? '/', 'https://trellis.evemisslab.com');
    let response=null;
    for (const handler of routeHandlers) {
      response=await handler({request,url,context,services,assets});
      if (response) break;
    }
    if (!response) response={status:404,headers:{'content-type':'text/plain; charset=utf-8'},body:'Not Found'};
    response=withSecurityHeaders(response);
    if (method==='HEAD') response={...response,body:''};
    return response;
  } catch(error) {
    const response=withSecurityHeaders(publicErrorResponse(error));
    return method==='HEAD'?{...response,body:''}:response;
  }
}

function createHttpApp(options={}) {
  return async function httpApp(req,res) {
    const response=await dispatchRequest(req,options);
    res.writeHead(response.status,response.headers);
    res.end(response.body ?? '');
  };
}

module.exports={SECURITY_HEADERS,dispatchRequest,createHttpApp};
