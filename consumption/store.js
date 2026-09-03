const {RETENTION_POLICY_REF,expiryFrom}=require('./types');

function rowToState(row){if(!row)return null;return{...row};}
class ConsumptionStore{
  constructor(db){this.db=db;}
  get(consumerActorId,targetKind,targetRef){
    return rowToState(this.db.prepare(`SELECT * FROM consumption_state WHERE consumer_actor_id=? AND target_kind=? AND target_ref=?`).get(consumerActorId,targetKind,targetRef));
  }
  recordSeen({consumerActorId,targetKind,targetRef,now}){
    const expiresAt=expiryFrom(now);
    this.db.prepare(`
      INSERT INTO consumption_state(
        consumer_actor_id,target_kind,target_ref,first_seen_at,first_opened_at,
        last_touched_at,expires_at,state_version,retention_policy_ref
      ) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(consumer_actor_id,target_kind,target_ref) DO UPDATE SET
        first_seen_at=COALESCE(consumption_state.first_seen_at,excluded.first_seen_at),
        last_touched_at=excluded.last_touched_at,
        expires_at=excluded.expires_at,
        state_version=consumption_state.state_version+1,
        retention_policy_ref=excluded.retention_policy_ref
    `).run(consumerActorId,targetKind,targetRef,now,null,now,expiresAt,1,RETENTION_POLICY_REF);
    return this.get(consumerActorId,targetKind,targetRef);
  }
  recordOpened({consumerActorId,targetKind,targetRef,now}){
    if(targetKind!=='publication') throw new TypeError('CONSUMPTION_OPENED_TARGET_INVALID');
    const expiresAt=expiryFrom(now);
    this.db.prepare(`
      INSERT INTO consumption_state(
        consumer_actor_id,target_kind,target_ref,first_seen_at,first_opened_at,
        last_touched_at,expires_at,state_version,retention_policy_ref
      ) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(consumer_actor_id,target_kind,target_ref) DO UPDATE SET
        first_seen_at=COALESCE(consumption_state.first_seen_at,excluded.first_seen_at),
        first_opened_at=COALESCE(consumption_state.first_opened_at,excluded.first_opened_at),
        last_touched_at=excluded.last_touched_at,
        expires_at=excluded.expires_at,
        state_version=consumption_state.state_version+1,
        retention_policy_ref=excluded.retention_policy_ref
    `).run(consumerActorId,targetKind,targetRef,now,now,now,expiresAt,1,RETENTION_POLICY_REF);
    return this.get(consumerActorId,targetKind,targetRef);
  }
  listForConsumer(consumerActorId){
    return this.db.prepare(`
      SELECT * FROM consumption_state WHERE consumer_actor_id=?
      ORDER BY last_touched_at DESC,target_kind ASC,target_ref ASC
    `).all(consumerActorId).map(rowToState);
  }
  deleteExpired(now){
    const result=this.db.prepare(`DELETE FROM consumption_state WHERE expires_at<=?`).run(now);
    return Number(result.changes);
  }
  clearAll(){const result=this.db.prepare(`DELETE FROM consumption_state`).run();return Number(result.changes);}
}
module.exports={ConsumptionStore,rowToState};
