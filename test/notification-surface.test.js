const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {availableNotificationActions}=require('../notification/action-hints');
const {renderNotificationJson}=require('../notification/render-json');
const {renderNotificationHtml}=require('../notification/render-html');

test('Notification action hints are advisory only',()=>{
 assert.deepEqual(availableNotificationActions({notification_type:'reply_to_your_publication'}),['open_source','reply','open_actor']);
 assert.deepEqual(availableNotificationActions({notification_type:'reaction_to_your_publication'}),['open_source','open_actor']);
});

test('HTML and JSON render the same already-filtered item facts and HTML escapes previews',()=>{
 const surface={recipient_actor_id:'actor:A',unread_count:1,algorithm_ref:'trellis-notification-inbox:v1',snapshot_ref:'abc',projection_version:'trellis-notification-inbox:0.1',items:[{notification_id:'notification:1',notification_type:'reply_to_your_publication',source_actor_id:'actor:B',source:{kind:'publication',publication_id:'pub:r',preview:'<script>x</script>'},acknowledged:false,available_actions:['open_source'],execution_authority:{implied_by_notification_read:false}}],next_cursor:null};
 const json=renderNotificationJson(surface);const html=renderNotificationHtml(surface);assert.match(json,/notification:1/);assert.match(json,/<script>x<\/script>/);assert.match(html,/notification:1/);assert.equal(html.includes('<script>x</script>'),false);assert.match(html,/&lt;script&gt;x&lt;\/script&gt;/);
});

test('Notification renderers are pure presentation modules with no storage imports',()=>{
 for(const file of ['render-html.js','render-json.js']){const source=fs.readFileSync(path.join(__dirname,'..','notification',file),'utf8');assert.equal(/event-store|sqlite|\.\.\/db\//.test(source),false,file);}
});
