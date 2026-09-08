async function listPublicRelationships(db,disclosurePolicy=()=> 'allow'){
  const rows=await db.all(`SELECT * FROM relationships_current WHERE visibility = 'public' ORDER BY relationship_id`);
  return rows.filter(row=>{try{return disclosurePolicy(row)==='allow';}catch{return false;}});
}
module.exports={listPublicRelationships};
