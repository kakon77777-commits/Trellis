function reactionActionHints(viewerReaction) {
  if (!viewerReaction) return [{ action:'react', implied_execution_authority:false }];
  if (viewerReaction.lifecycle==='active') return [
    { action:'change_reaction', implied_execution_authority:false },
    { action:'withdraw_reaction', implied_execution_authority:false }
  ];
  if (viewerReaction.lifecycle==='withdrawn') return [{ action:'restore_reaction', implied_execution_authority:false }];
  return [];
}
module.exports={reactionActionHints};
