const { loadPublicFeed } = require('../../feed/public');
const { buildPublicDirectory } = require('../../discovery/public-directory');
const { buildActorProfile } = require('../../profile/read-service');
const { loadPublicationSurface } = require('../../publication/read-service');
const { buildCommunitySurface } = require('../../community/read-service');

function createPublicServiceFacade({ sql, eventStore, disclosurePolicy }) {
  const db = sql;
  return Object.freeze({
    loadPublicFeed: async ({limit=20,cursor=null}={}) => loadPublicFeed({db,eventStore,disclosurePolicy,limit,cursor}),
    loadPublicDirectory: async () => buildPublicDirectory({db,eventStore,disclosurePolicy}),
    loadActor: async actorId => buildActorProfile({actorId,viewerContext:{},eventStore,db,disclosurePolicy}),
    loadPublication: async publicationId => loadPublicationSurface({publicationId,viewerContext:{},eventStore,db,disclosurePolicy}),
    loadCommunity: async communityId => buildCommunitySurface({communityId,viewerContext:{},db,eventStore,disclosurePolicy})
  });
}
module.exports={createPublicServiceFacade};
