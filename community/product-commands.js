const { addCommunityAssertion } = require('./metadata-service');
function setField(field_ref) {
  return (command, context) => addCommunityAssertion({ ...command, field_ref }, context);
}
const setCommunityName = setField('community:name:v1');
const setCommunityDescription = setField('community:description:v1');
const setCommunityAvatarUrl = setField('community:avatar_url:v1');
const setCommunityDiscoverability = setField('community:discoverability:v1');
module.exports = { setCommunityName, setCommunityDescription, setCommunityAvatarUrl, setCommunityDiscoverability };
