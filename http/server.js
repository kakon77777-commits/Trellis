const http=require('node:http');
const path=require('node:path');
const {openDatabase}=require('../db/sqlite');
const {SQLiteEventStore}=require('../events/sqlite-event-store');
const {createHttpApp}=require('./app');
const {createPublicServiceFacade}=require('./view-models/public');
const {createMachineRoutes}=require('./routes/machine');
const {createPublicRoutes}=require('./routes/public');
const {createResourceRoutes}=require('./routes/resources');

function createTrellisHandler({db,eventStore,disclosurePolicy}){
  const services=createPublicServiceFacade({db,eventStore,disclosurePolicy});
  return createHttpApp({routeHandlers:[createMachineRoutes(),createPublicRoutes(),createResourceRoutes()],services});
}
function createTrellisServer(dependencies){return http.createServer(createTrellisHandler(dependencies));}
function startDefaultServer(){
  const filename=process.env.TRELLIS_DB_PATH??path.join(process.cwd(),'trellis.sqlite');
  const host=process.env.HOST??'0.0.0.0';
  const port=Number(process.env.PORT??8787);
  if(!Number.isInteger(port)||port<0||port>65535) throw new TypeError('INVALID_WEB_PORT');
  const db=openDatabase(filename);
  const eventStore=new SQLiteEventStore(db);
  const server=createTrellisServer({db,eventStore});
  server.listen(port,host,()=>{
    const address=server.address();
    const bound=typeof address==='object'&&address?address.port:port;
    console.log(`Trellis Web v0.1 listening on http://${host}:${bound}`);
  });
  return server;
}
if(require.main===module) startDefaultServer();
module.exports={createTrellisHandler,createTrellisServer,startDefaultServer};
