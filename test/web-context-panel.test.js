const test=require('node:test');
const assert=require('node:assert/strict');
const {renderRankingExplanation}=require('../web/render/context-panel');

test('ranking explanation renders backend reason codes and points without synthesizing reasons',async ()=>{
 const item={score:{total_points:8200},ranking_reasons:[
  {type:'source_subscription',component:'source',points:3000},
  {type:'recent_publication',component:'recency',points:4200},
  {type:'not_seen_before',component:'novelty',points:1000}
 ]};
 const html=renderRankingExplanation(item);
 for(const reason of item.ranking_reasons){
   assert.match(html,new RegExp(`data-reason-code="${reason.type}"`));
   assert.match(html,new RegExp(`data-reason-points="${reason.points}"`));
 }
 assert.match(html,/data-total-points="8200"/);
 assert.equal(item.ranking_reasons.reduce((n,r)=>n+r.points,0),item.score.total_points);
});

test('unknown backend reason code remains visible as raw code',async ()=>{
 const html=renderRankingExplanation({score:{total_points:7},ranking_reasons:[{type:'future_reason_xyz',component:'future',points:7}]});
 assert.match(html,/future_reason_xyz/);
 assert.match(html,/data-reason-code="future_reason_xyz"/);
});
