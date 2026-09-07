const { loadPublicFeed } = require('../../feed/public');
const { buildPublicDirectory } = require('../../discovery/public-directory');
const { buildActorProfile } = require('../../profile/read-service');
const { loadPublicationSurface } = require('../../publication/read-service');
const { buildCommunitySurface } = require('../../community/read-service');

function createPublicServiceFacade({ db, eventStore, disclosurePolicy }) {
  return Object.freeze({
    loadPublicFeed: ({limit=20,cursor=null}={}) => loadPublicFeed({db,eventStore,disclosurePolicy,limit,cursor}),
    loadPublicDirectory: () => buildPublicDirectory({db,eventStore,disclosurePolicy}),
    loadActor: actorId => buildActorProfile({actorId,viewerContext:{},eventStore,db,disclosurePolicy}),
    loadPublication: publicationId => loadPublicationSurface({publicationId,viewerContext:{},eventStore,db,disclosurePolicy}),
    loadCommunity: communityId => buildCommunitySurface({communityId,viewerContext:{},db,eventStore,disclosurePolicy})
  });
}
module.exports={createPublicServiceFacade};
