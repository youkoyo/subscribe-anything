// scripts/pool-card-stats.ts
// Reports the message-card count per industry pool so you can see at a glance
// which pools are empty and which have data.
//
// Run with:
//   tsx --env-file=.env.local scripts/pool-card-stats.ts

import { eq, sql, desc } from 'drizzle-orm';
import { getDb } from '../src/lib/db';
import {
  industryConfigs,
  industryMonitoringProfiles,
  messageCards,
  sources,
  subscriptions,
} from '../src/lib/db/schema';

async function main() {
  const db = getDb();

  // Load every industry config
  const configs = await db.select().from(industryConfigs);
  console.log(`[stats] loaded ${configs.length} industry config(s)\n`);

  // Load every monitoring profile
  const profiles = await db
    .select()
    .from(industryMonitoringProfiles)
    .orderBy(desc(industryMonitoringProfiles.updatedAt));

  type Row = {
    industryId: string;
    industryName: string;
    profileId: string | null;
    profileStatus: string | null;
    sharedSubscriptionId: string | null;
    sourceCount: number;
    activeSourceCount: number;
    failedSourceCount: number;
    cardCount: number;
    meetsCriteriaCount: number;
    lastCollectedAt: Date | null;
  };

  const rows: Row[] = [];

  for (const config of configs) {
    // Find the active pool for this industry
    const profile = profiles.find(
      (p) =>
        p.industryConfigId === config.id &&
        p.status === 'active' &&
        !!p.sharedSubscriptionId
    );
    const sharedSubscriptionId = profile?.sharedSubscriptionId ?? null;

    // Source stats (tied to the shared subscription, if any)
    let sourceCount = 0;
    let activeSourceCount = 0;
    let failedSourceCount = 0;
    if (sharedSubscriptionId) {
      const srcRows = await db.select().from(sources).where(eq(sources.subscriptionId, sharedSubscriptionId));
      sourceCount = srcRows.length;
      activeSourceCount = srcRows.filter((s) => s.isEnabled && s.status === 'active').length;
      failedSourceCount = srcRows.filter((s) => s.status === 'failed').length;
    }

    // Card stats
    let cardCount = 0;
    let meetsCriteriaCount = 0;
    let lastCollectedAt: Date | null = null;
    if (sharedSubscriptionId) {
      const cardRows = await db
        .select({
          id: messageCards.id,
          meetsCriteriaFlag: messageCards.meetsCriteriaFlag,
          createdAt: messageCards.createdAt,
        })
        .from(messageCards)
        .where(eq(messageCards.subscriptionId, sharedSubscriptionId));
      cardCount = cardRows.length;
      meetsCriteriaCount = cardRows.filter((c) => c.meetsCriteriaFlag).length;
      if (cardRows.length > 0) {
        lastCollectedAt = cardRows.reduce(
          (max, c) => (c.createdAt > max ? c.createdAt : max),
          cardRows[0].createdAt
        );
      }
    }

    rows.push({
      industryId: config.id,
      industryName: config.name,
      profileId: profile?.id ?? null,
      profileStatus: profile?.status ?? null,
      sharedSubscriptionId,
      sourceCount,
      activeSourceCount,
      failedSourceCount,
      cardCount,
      meetsCriteriaCount,
      lastCollectedAt,
    });
  }

  // Sort by card count descending
  rows.sort((a, b) => b.cardCount - a.cardCount);

  // Pretty print
  const nameW = Math.max(8, ...rows.map((r) => r.industryName.length));
  console.log(
    [
      '产业名称'.padEnd(nameW),
      '数据源',
      '已启用',
      '失败',
      '消息卡',
      '·命中条件',
      '最后采集',
      '池状态',
    ].join('  ')
  );
  console.log('-'.repeat(nameW + 60));
  for (const r of rows) {
    const last = r.lastCollectedAt ? r.lastCollectedAt.toISOString().slice(0, 16) : '—';
    const poolState = r.sharedSubscriptionId
      ? r.profileStatus === 'active'
        ? '已构建'
        : r.profileStatus ?? '?'
      : '未构建';
    console.log(
      [
        r.industryName.padEnd(nameW),
        String(r.sourceCount).padStart(4),
        String(r.activeSourceCount).padStart(4),
        String(r.failedSourceCount).padStart(4),
        String(r.cardCount).padStart(5),
        String(r.meetsCriteriaCount).padStart(5),
        last.padStart(16),
        poolState,
      ].join('  ')
    );
  }

  const totalCards = rows.reduce((s, r) => s + r.cardCount, 0);
  const totalOnTopic = rows.reduce((s, r) => s + r.meetsCriteriaCount, 0);
  const poolsWithData = rows.filter((r) => r.cardCount > 0).length;
  const poolsEmpty = rows.filter((r) => r.sharedSubscriptionId && r.cardCount === 0).length;
  const poolsNotBuilt = rows.filter((r) => !r.sharedSubscriptionId).length;
  console.log('');
  console.log('[汇总]');
  console.log(`  产业配置总数: ${rows.length}`);
  console.log(`  已构建池: ${rows.length - poolsNotBuilt}`);
  console.log(`  池里有数据: ${poolsWithData}`);
  console.log(`  池里 0 条: ${poolsEmpty}`);
  console.log(`  未构建池: ${poolsNotBuilt}`);
  console.log(`  消息卡总数: ${totalCards}（其中 ${totalOnTopic} 条命中条件）`);

  // Per-source detail (so you can see which sources are healthy vs failed)
  console.log('\n[数据源明细]');
  for (const r of rows) {
    if (!r.sharedSubscriptionId) continue;
    const srcRows = await db
      .select({
        id: sources.id,
        title: sources.title,
        url: sources.url,
        status: sources.status,
        isEnabled: sources.isEnabled,
        totalRuns: sources.totalRuns,
        successRuns: sources.successRuns,
        itemsCollected: sources.itemsCollected,
        lastRunAt: sources.lastRunAt,
        lastError: sources.lastError,
      })
      .from(sources)
      .where(eq(sources.subscriptionId, r.sharedSubscriptionId))
      .orderBy(desc(sources.itemsCollected));
    console.log(`\n  池：${r.industryName} (${srcRows.length} 个 source)`);
    for (const s of srcRows) {
      const state =
        !s.isEnabled ? '停用'
        : s.status === 'active' ? '运行中'
        : s.status === 'failed' ? '失败'
        : s.status === 'disabled' ? '禁用'
        : s.status;
      const last = s.lastRunAt ? s.lastRunAt.toISOString().slice(0, 16) : '—';
      console.log(
        `    [${state}] ${s.title}  采集 ${s.itemsCollected} 条 / 跑 ${s.successRuns}/${s.totalRuns} 次 / 最近 ${last}`
      );
      if (s.lastError) {
        console.log(`        ↳ 错误: ${s.lastError.slice(0, 120)}`);
      }
    }
  }

  // Card listing (newest first)
  console.log('\n[池内消息卡 - 按时间倒序]');
  for (const r of rows) {
    if (!r.sharedSubscriptionId) continue;
    const cardRows = await db
      .select({
        id: messageCards.id,
        title: messageCards.title,
        createdAt: messageCards.createdAt,
        publishedAt: messageCards.publishedAt,
        meetsCriteriaFlag: messageCards.meetsCriteriaFlag,
        sourceTitle: sources.title,
      })
      .from(messageCards)
      .innerJoin(sources, eq(messageCards.sourceId, sources.id))
      .where(eq(messageCards.subscriptionId, r.sharedSubscriptionId))
      .orderBy(desc(messageCards.createdAt));
    console.log(`\n  池：${r.industryName} (${cardRows.length} 条)`);
    for (const c of cardRows) {
      const flag = c.meetsCriteriaFlag ? '✓' : '✗';
      const pub = c.publishedAt ? c.publishedAt.toISOString().slice(0, 10) : '—';
      console.log(`    ${flag} [${pub}] ${c.title.slice(0, 80)}  — ${c.sourceTitle}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[fatal]', err);
    process.exit(1);
  });
