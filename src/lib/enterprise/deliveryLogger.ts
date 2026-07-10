// Per-user-subscription delivery trace. Structured log of the full decision chain
// for one email send: load → meets-criteria filter → score → select → send.

function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export interface TraceCard {
  id: string;
  title: string;
  sourceName: string | null;
  publishedAt: Date | string | null;
  createdAt: Date | string;
  text: string;
}

export interface ScoredTraceCard extends TraceCard {
  score: number;
  matched: boolean;
  matchedTerms: string[];
  reason: string;
  disposition: 'selected' | 'ranked_outside_top_n' | 'not_matched';
}

export interface DeliveryTrace {
  userSubId: string;
  userId: string;
  industryName: string;
  customCriteria: string;
  parsedCriteriaSummary: {
    groups: number;
    groupSummaries: string[];
    timeWindowDays: number | null;
  };
  recipients: string[];
  candidatesLoaded: number;
  candidatesFiltered: {
    failsMeetsCriteria: number;
    poolTotal: number;
  };
  scored: ScoredTraceCard[];
  selectedCount: number;
  sendResult: 'pending' | 'sent' | 'failed' | 'skipped';
  sendError?: string;
  durationMs: number;
}

function shortTitle(s: string, max = 50): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

export function formatDeliveryTrace(trace: DeliveryTrace): string[] {
  const lines: string[] = [];
  lines.push(`[Delivery] === ${trace.industryName} / userSub=${trace.userSubId} ===`);
  lines.push(`  收件邮箱: ${trace.recipients.length} 个${trace.recipients.length > 0 ? ` (${trace.recipients.join(', ')})` : ''}`);
  lines.push(`  自定义条件: "${trace.customCriteria}"`);
  const gp = trace.parsedCriteriaSummary;
  const gpInfo = gp.groups === 0
    ? '无（条件全空）'
    : `${gp.groups} 组 (${gp.groupSummaries.join('; ')})`;
  lines.push(`  解析: ${gpInfo}`);
  if (gp.timeWindowDays != null) lines.push(`  时间窗: 最近 ${gp.timeWindowDays} 天`);
  lines.push(`  池中共有: ${trace.candidatesFiltered.poolTotal} 条 (满足条件: ${trace.candidatesLoaded}, 未满足: ${trace.candidatesFiltered.failsMeetsCriteria})`);
  lines.push(`  评分: ${trace.scored.length} 条`);
  for (const s of trace.scored) {
    const mark = s.disposition === 'selected' ? '✓' : s.matched ? '…' : '✗';
    const flag = s.matchedTerms.length > 0 ? `命中: ${s.matchedTerms.join(', ')}` : '无命中';
    const reason = s.matched ? '' : ` — ${s.reason}`;
    const disp = s.disposition === 'ranked_outside_top_n' ? ' (排名超出上限)' : s.disposition === 'not_matched' ? ' (未命中条件)' : '';
    lines.push(
      `    ${mark} [${String(s.score).padStart(3)}] ${shortTitle(s.title)}` +
        `  来源=${s.sourceName ?? '?'}  ${flag}${reason}${disp}`
    );
  }
  lines.push(`  选中: ${trace.selectedCount} 条`);
  if (trace.sendResult === 'sent') {
    lines.push(`  邮件: 已发送 (${trace.durationMs}ms)`);
  } else if (trace.sendResult === 'failed') {
    lines.push(`  邮件: 发送失败 — ${trace.sendError ?? '未知错误'}`);
  } else if (trace.sendResult === 'skipped') {
    lines.push(`  邮件: 跳过 — ${trace.sendError ?? '?'}`);
  } else {
    lines.push(`  邮件: ${trace.sendResult}`);
  }
  return lines;
}

export function logDeliveryTrace(trace: DeliveryTrace): void {
  for (const line of formatDeliveryTrace(trace)) {
    console.log(line);
  }
}

export function summarizeTrace(trace: DeliveryTrace): string {
  return (
    `[Delivery] ${trace.industryName} userSub=${trace.userSubId} ` +
    `criteria="${trace.customCriteria}" ` +
    `loaded=${trace.candidatesLoaded} ` +
    `filtered=${trace.candidatesFiltered.failsMeetsCriteria} ` +
    `scored=${trace.scored.length} ` +
    `selected=${trace.selectedCount} ` +
    `send=${trace.sendResult}` +
    (trace.sendError ? ` err="${trace.sendError.slice(0, 80)}"` : '')
  );
}
