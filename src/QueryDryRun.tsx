import { exactCredential, type PluginContext } from '@owox/plugin-sdk';
import { Check, LoaderCircle, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { dryRunBigQuery, formatBytes } from './bigquery.ts';
import { GOOGLE_SERVICE_ACCOUNT } from './credential.ts';
import { describeError } from './errors.ts';

const DRY_RUN_DELAY_MS = 300;

interface QueryDryRunProps {
  ctx: PluginContext;
  sql: string;
  projectId: string;
  location: string;
  enabled: boolean;
}

type DryRunState =
  | { key: string; phase: 'valid'; bytes: string | null }
  | { key: string; phase: 'invalid'; message: string };

export function QueryDryRun({ ctx, sql, projectId, location, enabled }: QueryDryRunProps) {
  const [state, setState] = useState<DryRunState | null>(null);
  const query = sql.trim();
  const project = projectId.trim();
  const place = location.trim();
  const key = `${project}\0${place}\0${query}`;

  useEffect(() => {
    if (!enabled || query === '' || project === '') return;
    const google = exactCredential(ctx.credentials, GOOGLE_SERVICE_ACCOUNT);
    const fetchImpl = google?.asFetch();
    if (!fetchImpl) return;
    const controller = new AbortController();
    const parent = ctx.signal;
    const onAbort = () => controller.abort();
    parent?.addEventListener('abort', onAbort);
    const timer = window.setTimeout(() => {
      void dryRunBigQuery({
        fetchImpl,
        projectId: project,
        location: place || null,
        sql: query,
        signal: controller.signal,
      })
        .then(outcome => {
          if (controller.signal.aborted) return;
          setState(
            outcome.valid
              ? { key, phase: 'valid', bytes: outcome.bytesProcessed }
              : { key, phase: 'invalid', message: outcome.message ?? 'This SQL is not valid.' },
          );
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setState({ key, phase: 'invalid', message: describeError(cause) });
        });
    }, DRY_RUN_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      parent?.removeEventListener('abort', onAbort);
    };
  }, [ctx, enabled, key, place, project, query]);

  if (!enabled || query === '') return null;
  if (project === '') {
    return (
      <span className="dry-run" title="Open settings and set the GCP project">
        Set a project to check this query
      </span>
    );
  }
  if (exactCredential(ctx.credentials, GOOGLE_SERVICE_ACCOUNT) == null) return null;

  const current = state?.key === key ? state : null;
  if (!current) {
    return (
      <span className="dry-run" title="Checking this SQL with BigQuery">
        <LoaderCircle className="spin" size={12} aria-hidden="true" />
        Validating…
      </span>
    );
  }
  if (current.phase === 'invalid') {
    return (
      <span className="dry-run invalid" title={current.message}>
        <X size={12} aria-hidden="true" />
        <span>{current.message}</span>
      </span>
    );
  }
  const bytes = formatBytes(current.bytes);
  return (
    <span className="dry-run valid" title="Estimated volume. It can differ when the query runs.">
      <Check size={12} aria-hidden="true" />
      <span>{bytes ? `Valid SQL · ${bytes}` : 'Valid SQL'}</span>
    </span>
  );
}
