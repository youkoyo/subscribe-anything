import type { RunResult } from '@/lib/sandbox/contract';
import { articleCandidateFromCollectedItem } from '../ingestArticles';
import type { CollectorSource, SourceCollector } from './types';

export type RunScriptFunction = (script: string) => Promise<RunResult>;

export interface ScriptSourceCollectorDependencies {
  runScriptFn?: RunScriptFunction;
}

async function defaultRunScript(script: string) {
  const { runScript } = await import('@/lib/sandbox/runner');
  return runScript(script);
}

export function createScriptSourceCollector(
  dependencies: ScriptSourceCollectorDependencies = {},
): SourceCollector {
  const runScriptFn = dependencies.runScriptFn ?? defaultRunScript;

  return {
    async collectCandidates(source: CollectorSource) {
      const result = await runScriptFn(source.script);
      if (!result.success) {
        throw new Error(result.error ?? 'Feed script failed');
      }

      const items = result.items ?? [];
      if (items.length === 0) {
        throw new Error('Feed script did not return any data');
      }

      return items.map((item) => articleCandidateFromCollectedItem(item, 'feed'));
    },
  };
}
