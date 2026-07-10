/**
 * 查询产业信息池统计 —— 在项目根目录运行: node --import tsx scripts/industry-stats.ts
 *
 * 统计内容：
 *  - 产业配置数量（总数 / 已发布 / 开启）
 *  - 监控画像数量（按状态分）
 *  - 关联的订阅数、数据源数
 *  - 采集到的消息卡片总数（按产业配置分组）
 */

import { getDb } from '../src/lib/db';
import { sql, eq, and, inArray } from 'drizzle-orm';
import {
  industryConfigs,
  industryMonitoringProfiles,
  subscriptions,
  sources,
  messageCards,
  userIndustrySubscriptions,
} from '../src/lib/db/schema';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd(), true);

async function main() {
  const db = getDb();

  // ── 产业配置概览 ──
  const allConfigs = await db.select().from(industryConfigs).orderBy(sql`${industryConfigs.updatedAt} DESC`);
  const published = allConfigs.filter((c) => c.visibility === 'published');
  const enabled = allConfigs.filter((c) => c.isEnabled);

  console.log('═══════════════════════════════════════════');
  console.log('  产业信息池统计');
  console.log('═══════════════════════════════════════════');
  console.log();
  console.log(`产业配置总数: ${allConfigs.length}（已发布 ${published.length}，已启用 ${enabled.length}）`);
  console.log();

  // ── 监控画像 ──
  const allProfiles = await db.select().from(industryMonitoringProfiles);
  const profileStatus = { pending: 0, creating: 0, active: 0, failed: 0, disabled: 0 };
  for (const p of allProfiles) {
    if (p.status in profileStatus) profileStatus[p.status as keyof typeof profileStatus]++;
  }
  console.log(`监控画像总数: ${allProfiles.length}`);
  console.log(`  待审核 (pending):  ${profileStatus.pending}`);
  console.log(`  创建中 (creating): ${profileStatus.creating}`);
  console.log(`  活跃   (active):   ${profileStatus.active}`);
  console.log(`  失败   (failed):   ${profileStatus.failed}`);
  console.log(`  已禁用 (disabled): ${profileStatus.disabled}`);
  console.log();

  // ── 用户订阅 ──
  const allUserSubs = await db.select().from(userIndustrySubscriptions);
  const subStatus: Record<string, number> = {};
  for (const s of allUserSubs) {
    subStatus[s.status] = (subStatus[s.status] || 0) + 1;
  }
  console.log(`用户产业订阅总数: ${allUserSubs.length}`);
  for (const [status, count] of Object.entries(subStatus)) {
    const labels: Record<string, string> = {
      pending_approval: '待审批',
      pending_profile: '待配置画像',
      active: '活跃',
      rejected: '已拒绝',
      paused: '已暂停',
    };
    console.log(`  ${labels[status] || status}: ${count}`);
  }
  console.log();

  // ── 关联的 Subscriptions 和 Sources ──
  const industrySubIds = new Set(
    allConfigs.flatMap((c) => allProfiles.filter((p) => p.industryConfigId === c.id).map((p) => p.sharedSubscriptionId)).filter(Boolean) as string[]
  );

  if (industrySubIds.size > 0) {
    const idsArray = [...industrySubIds];
    const linkedSubs = await db.select().from(subscriptions).where(inArray(subscriptions.id, idsArray));

    const allSources: typeof sources.$inferSelect[] = [];
    for (const sub of linkedSubs) {
      const srcs = await db.select().from(sources).where(eq(sources.subscriptionId, sub.id));
      allSources.push(...srcs);
    }

    const activeSources = allSources.filter((s) => s.status === 'active');
    const failedSources = allSources.filter((s) => s.status === 'failed');

    console.log(`关联订阅（shared_subscription）: ${linkedSubs.length} 个`);
    console.log(`关联数据源: ${allSources.length} 个`);
    console.log(`  状态: active=${activeSources.length}, failed=${failedSources.length}, other=${allSources.length - activeSources.length - failedSources.length}`);

    // ── 消息卡片 ──
    let totalCards = 0;
    for (const sub of linkedSubs) {
      const cards = await db.select({ count: sql<number>`count(*)` }).from(messageCards).where(eq(messageCards.subscriptionId, sub.id));
      totalCards += Number(cards[0]?.count ?? 0);
    }
    console.log(`采集到的消息卡片总数: ${totalCards}`);
    console.log();

    // ── 按产业配置分组明细 ──
    console.log('── 按产业配置分组明细 ──');
    for (const config of allConfigs) {
      const configProfiles = allProfiles.filter((p) => p.industryConfigId === config.id);
      const configSubIds = configProfiles.map((p) => p.sharedSubscriptionId).filter(Boolean) as string[];
      if (configSubIds.length === 0) continue;

      let configCards = 0;
      let configSources = 0;
      for (const sid of configSubIds) {
        const srcs = await db.select({ id: sources.id }).from(sources).where(eq(sources.subscriptionId, sid));
        configSources += srcs.length;
        for (const src of srcs) {
          const cards = await db.select({ count: sql<number>`count(*)` }).from(messageCards).where(eq(messageCards.sourceId, src.id));
          configCards += Number(cards[0]?.count ?? 0);
        }
      }

      const label = `${config.name}${config.visibility === 'published' ? ' [已发布]' : ' [草稿]'}${config.isEnabled ? '' : ' [已禁用]'}`;
      console.log(`  ${label}`);
      console.log(`    画像: ${configProfiles.length}  |  订阅: ${configSubIds.length}  |  源: ${configSources}  |  卡片: ${configCards}`);
    }
  } else {
    console.log('⚠ 暂无活跃的产业信息池（没有 shared_subscription 的 active 画像）');
  }

  console.log();
  console.log('═══════════════════════════════════════════');

  await (db as unknown as { $client?: { end: () => Promise<void> } }).$client?.end?.();
  process.exit(0);
}

main().catch((err) => {
  console.error('查询失败:', err);
  process.exit(1);
});
