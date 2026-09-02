const { addEntityAssertion } = require('./service');

function assertField(field_ref) {
  return (command, context) => addEntityAssertion({
    ...command,
    field_ref,
    operation: 'assert'
  }, context);
}

function retractField(field_ref) {
  return (command, context) => addEntityAssertion({
    ...command,
    field_ref,
    operation: 'retract'
  }, context);
}

const setDisplayName = assertField('profile:display_name:v1');
const setBio = assertField('profile:bio:v1');
const setAvatarUrl = assertField('profile:avatar_url:v1');
const setWebsite = assertField('profile:website:v1');
const addAlias = assertField('profile:alias:v1');
const removeAlias = retractField('profile:alias:v1');
const addExternalLink = assertField('profile:external_link:v1');
const removeExternalLink = retractField('profile:external_link:v1');

module.exports = {
  setDisplayName,
  setBio,
  setAvatarUrl,
  setWebsite,
  addAlias,
  removeAlias,
  addExternalLink,
  removeExternalLink
};
