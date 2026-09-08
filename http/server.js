const http=require('node:http');
const path=require('node:path');
const {openDatabase}=require('../db/sqlite');
const {SQLiteAsyncAdapter}=require('../storage/sqlite-adapter');
const {createHttpApp}=require('./app');
const {buildHttpRuntime}=require('../runtime/build-dependencies');

function createNodeDependencies({db,eventStore,disclosurePolicy}={}){
  if(!db) throw new TypeError('SQLITE_DATABASE_REQUIRED');
  const sql=new SQLiteAsyncAdapter(db);
  return buildHttpRuntime({sql,eventStore,disclosurePolicy});
}
function createTrellisHandler({sql,eventStore,disclosurePolicy}={}){
  const runtime=buildHttpRuntime({sql,eventStore,disclosurePolicy});
  return createHttpApp({routeHandlers:runtime.routeHandlers,services:runtime.services});
}
function createTrellisServer(dependencies){return http.createServer(createTrellisHandler(dependencies));}
function startDefaultServer(){
  const filename=process.env.TRELLIS_DB_PATH??path.join(process.cwd(),'trellis.sqlite');
  const host=process.env.HOST??'0.0.0.0';
  const port=Number(process.env.PORT??8787);
  if(!Number.isInteger(port)||port<0||port>65535) throw new TypeError('INVALID_WEB_PORT');
  const db=openDatabase(filename);
  const runtime=createNodeDependencies({db});
  const server=createTrellisServer(runtime);
  server.listen(port,host,()=>{
    const address=server.address();
    const bound=typeof address==='object'&&address?address.port:port;
    console.log(`Trellis Web v0.1 listening on http://${host}:${bound}`);
  });
  return server;
}
if(require.main===module) startDefaultServer();
module.exports={createNodeDependencies,createTrellisHandler,createTrellisServer,startDefaultServer};
