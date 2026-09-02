const {
  proposeRelationship,
  activateRelationship,
  terminateRelationship,
  openContestation,
  resolveContestation,
  addEvidence,
  addAnnotation
} = require('../relationship/service');

module.exports = {
  propose: proposeRelationship,
  activate: activateRelationship,
  terminate: terminateRelationship,
  openContestation,
  resolveContestation,
  addEvidence,
  addAnnotation
};
