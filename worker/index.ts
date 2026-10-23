import { createBackend, exactCredential } from '@owox/plugin-sdk/server';
import { GOOGLE_SERVICE_ACCOUNT } from '../src/credential.ts';
import { QUERIES_COLLECTION, type QueryDocument } from '../src/queries.ts';
import { exportSavedSheet, ExportSheetError } from '../src/scheduled-export.ts';

const REPOSITORY_ID = '1427457098';

function queryIdOf(input: unknown): string {
  if (typeof input !== 'object' || input === null || !('queryId' in input)) return '';
  return typeof input.queryId === 'string' ? input.queryId.trim() : '';
}

export default createBackend({
  repositoryId: REPOSITORY_ID,
  hosts: ['https://app.owox.com'],
  actions: {
    'export-sheet': (input, ctx) => {
      const queryId = queryIdOf(input);
      if (!queryId) throw new ExportSheetError('QUERY_NOT_READY', 'Save a schedule before this run.');
      const credential = exactCredential(ctx.credentials, GOOGLE_SERVICE_ACCOUNT);
      return exportSavedSheet({
        queryId,
        fetchImpl: credential ? credential.asFetch() : null,
        collection: ctx.collections<QueryDocument>(QUERIES_COLLECTION),
        signal: ctx.signal,
      });
    },
  },
});
