function publicErrorResponse(error) {
  if (error instanceof TypeError && error.message === 'CLIENT_CLAIMED_ACTOR_ID_NOT_ALLOWED') {
    return { status:400, headers:{'content-type':'application/json; charset=utf-8'}, body:JSON.stringify({error:'INVALID_PUBLIC_IDENTITY_CLAIM'}) };
  }
  if (error instanceof TypeError) {
    return { status:400, headers:{'content-type':'application/json; charset=utf-8'}, body:JSON.stringify({error:'INVALID_PUBLIC_REQUEST'}) };
  }
  return { status:500, headers:{'content-type':'application/json; charset=utf-8'}, body:JSON.stringify({error:'INTERNAL_ERROR'}) };
}
module.exports={publicErrorResponse};
