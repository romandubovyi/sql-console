import { limitDescription } from './queries.ts';

const MAX_TITLE_LENGTH = 255;

export interface DataMartClient {
  postJson<T>(path: string, body: unknown): Promise<T>;
  putJson<T>(path: string, body: unknown): Promise<T>;
  deleteJson<T>(path: string): Promise<T>;
}

export interface SqlDataMartInput {
  title: string;
  storageId: string;
  sql: string;
  description: string;
}

export interface CreatedSqlDataMart {
  id: string;
  title: string;
  /** False when the SQL data mart exists but its description was not copied. */
  descriptionSaved: boolean;
}

export function dataMartTitle(title: string): string {
  const trimmed = title.trim();
  const next = trimmed || 'Untitled query';
  return next.length <= MAX_TITLE_LENGTH ? next : next.slice(0, MAX_TITLE_LENGTH);
}

export function dataMartPath(projectId: string, id: string): string {
  return `/ui/${encodeURIComponent(projectId)}/data-marts/${encodeURIComponent(id)}/data-setup`;
}

/** Creates a SQL data mart on the chosen storage and copies the current query onto it. */
export async function createSqlDataMart(client: DataMartClient, input: SqlDataMartInput): Promise<CreatedSqlDataMart> {
  const storageId = input.storageId.trim();
  if (!storageId) throw new Error('Choose a storage before creating a data mart.');
  if (input.sql.trim() === '') throw new Error('Write a SQL query before creating a data mart.');

  const title = dataMartTitle(input.title);
  const created = await client.postJson<unknown>('/api/data-marts', { title, storageId });
  const id = readId(created);
  try {
    await client.putJson(`/api/data-marts/${encodeURIComponent(id)}/definition`, {
      definitionType: 'SQL',
      definition: { sqlQuery: input.sql },
    });
  } catch (cause) {
    await client.deleteJson(`/api/data-marts/${encodeURIComponent(id)}`).catch(() => undefined);
    throw cause;
  }

  const description = limitDescription(input.description);
  if (description.trim() === '') return { id, title, descriptionSaved: true };
  try {
    await client.putJson(`/api/data-marts/${encodeURIComponent(id)}/description`, { description });
  } catch {
    return { id, title, descriptionSaved: false };
  }
  return { id, title, descriptionSaved: true };
}

function readId(value: unknown): string {
  if (typeof value !== 'object' || value === null || !('id' in value)) {
    throw new Error('Data mart was created without an id.');
  }
  const id = value.id;
  if (typeof id !== 'string' || id.trim() === '') throw new Error('Data mart was created without an id.');
  return id;
}
