const Database = require('better-sqlite3');
const db = new Database('./data/subscribe-anything.db', { readonly: true });

console.log('=== User ===');
const user = db.prepare("SELECT id, email, name, is_admin, is_guest FROM users WHERE email = 'lts2438@163.com'").get();
console.log(user);

if (!user) { db.close(); process.exit(0); }

console.log('\n=== user_industry_subscriptions ===');
const subs = db.prepare(`
  SELECT uis.id, uis.user_id, uis.industry_config_id, uis.monitoring_profile_id,
         uis.status, uis.custom_criteria, uis.recipient_emails_json, uis.last_delivered_at,
         ic.name AS industry_name, ic.delivery_enabled, ic.delivery_cron
  FROM user_industry_subscriptions uis
  LEFT JOIN industry_configs ic ON ic.id = uis.industry_config_id
  WHERE uis.user_id = ?
`).all(user.id);
console.log(JSON.stringify(subs, null, 2));

if (subs.length === 0) {
  console.log('No subscriptions found for this user');
  db.close();
  process.exit(0);
}

const configIds = subs.map(s => s.industry_config_id);

console.log('\n=== monitoring_profile ===');
const profiles = db.prepare(`
  SELECT id, industry_config_id, title, status, shared_subscription_id,
         requires_admin_approval, approved_by, last_provisioned_at
  FROM industry_monitoring_profiles
  WHERE industry_config_id IN (${configIds.map(() => '?').join(',')})
`).all(...configIds);
console.log(JSON.stringify(profiles, null, 2));

console.log('\n=== shared_subscription message_cards count ===');
for (const p of profiles) {
  if (!p.shared_subscription_id) { console.log(`  profile=${p.id} → no shared_subscription_id`); continue; }
  const count = db.prepare("SELECT COUNT(*) AS n FROM message_cards WHERE subscription_id = ?").get(p.shared_subscription_id);
  const sub = db.prepare("SELECT id, topic, is_enabled FROM subscriptions WHERE id = ?").get(p.shared_subscription_id);
  const recent = db.prepare("SELECT id, title, created_at FROM message_cards WHERE subscription_id = ? ORDER BY created_at DESC LIMIT 3").all(p.shared_subscription_id);
  console.log(`  profile=${p.id}`);
  console.log(`    shared_sub=${p.shared_subscription_id} topic=${sub && sub.topic} enabled=${sub && sub.is_enabled} cards=${count.n}`);
  if (recent.length) console.log(`    recent:`, recent);
}

console.log('\n=== existing delivery runs ===');
const runs = db.prepare("SELECT id, industry_config_id, status, started_at, finished_at, error FROM industry_delivery_runs ORDER BY created_at DESC LIMIT 5").all();
console.log(JSON.stringify(runs, null, 2));

console.log('\n=== existing user_delivery_logs for lts2438 ===');
const logs = db.prepare(`
  SELECT udl.id, udl.run_id, udl.user_industry_subscription_id, udl.recipient_emails_json,
         udl.subject, udl.status, udl.error, udl.sent_at, udl.created_at
  FROM user_delivery_logs udl
  WHERE udl.user_id = ?
  ORDER BY udl.created_at DESC LIMIT 5
`).all(user.id);
console.log(JSON.stringify(logs, null, 2));

db.close();