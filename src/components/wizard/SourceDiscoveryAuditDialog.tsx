'use client';

import { ExternalLink, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { SourceDecisionRecord } from '@/lib/ai/agents/sourcePortfolioPolicy';

interface SourceDiscoveryAuditDialogProps {
  records: SourceDecisionRecord[];
  selectedUrls: Set<string>;
  onClose: () => void;
}

function DecisionRow({
  record,
  selectedUrls,
}: {
  record: SourceDecisionRecord;
  selectedUrls: Set<string>;
}) {
  const adopted = record.decision === 'accepted';
  const selected = selectedUrls.has(record.source.url);
  return (
    <div className="border-b border-border/50 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-sm">{record.source.title}</span>
        <Badge className={adopted
          ? 'h-5 bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30'
          : 'h-5 bg-muted text-muted-foreground border-border'}
        >
          {adopted ? 'AI 采用' : 'AI 未采用'}
        </Badge>
        {adopted && (
          <Badge className={selected
            ? 'h-5 bg-primary/15 text-primary border-primary/30'
            : 'h-5 bg-muted text-muted-foreground border-border'}
          >
            {selected ? '本次使用' : '本次不使用'}
          </Badge>
        )}
      </div>
      <a
        href={record.source.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-primary break-all"
      >
        {record.source.url}<ExternalLink className="h-3 w-3 flex-shrink-0" />
      </a>
      <p className="mt-2 text-xs leading-relaxed text-foreground/85">
        <span className="font-medium">原因：</span>{record.reason}
      </p>
      {record.evidence.length > 0 && (
        <div className="mt-2 rounded-md bg-muted/50 px-2.5 py-2 text-xs">
          <p className="mb-1 font-medium text-muted-foreground">检索证据</p>
          <div className="space-y-1">
            {record.evidence.map((evidence, index) => (
              <a
                key={`${evidence.url}-${index}`}
                href={evidence.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate text-primary/80 hover:text-primary hover:underline"
                title={evidence.title || evidence.url}
              >
                {evidence.title || evidence.url}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SourceDiscoveryAuditDialog({
  records,
  selectedUrls,
  onClose,
}: SourceDiscoveryAuditDialogProps) {
  const adopted = records.filter((record) => record.decision === 'accepted');
  const rejected = records.filter((record) => record.decision === 'rejected');

  return (
    <div className="fixed inset-0 md:left-64 z-50 flex items-end md:items-center justify-center p-0 md:p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-card text-card-foreground border border-cyan-300/25 w-full md:max-w-3xl rounded-t-2xl md:rounded-xl shadow-[0_24px_80px_rgba(2,10,31,0.55)] flex flex-col h-[90vh] md:h-[80vh]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b flex-shrink-0">
          <div>
            <h2 className="font-semibold text-sm">AI 找源记录</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              采用 {adopted.length} 个，未采用 {rejected.length} 个；原因来自本次真实检索和来源组合审查。
            </p>
          </div>
          <button onClick={onClose} className="ml-3 text-muted-foreground hover:text-foreground" aria-label="关闭">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 nebula-scroll">
          <section className="py-3">
            <h3 className="text-xs font-semibold text-green-700 dark:text-green-400">AI 采用</h3>
            {adopted.length > 0
              ? adopted.map((record, index) => <DecisionRow key={`${record.source.url}-${index}`} record={record} selectedUrls={selectedUrls} />)
              : <p className="py-5 text-sm text-muted-foreground">暂无采用来源。</p>}
          </section>
          <section className="py-3 border-t">
            <h3 className="text-xs font-semibold text-muted-foreground">AI 未采用</h3>
            {rejected.length > 0
              ? rejected.map((record, index) => <DecisionRow key={`${record.source.url}-${index}`} record={record} selectedUrls={selectedUrls} />)
              : <p className="py-5 text-sm text-muted-foreground">本次没有被排除的候选来源。</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
