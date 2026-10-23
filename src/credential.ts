export const GOOGLE_SERVICE_ACCOUNT = 'google-service-account';
export const ANTHROPIC_CREDENTIAL = 'anthropic';

const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface CredentialJob {
  projectId: string;
  jobId: string;
  location: string | null;
}

/** Email from a Google tokeninfo body, when the access token includes one. */
export function serviceAccountEmail(body: unknown): string | null {
  return emailField(body, 'email');
}

/** Email of the principal that ran a BigQuery job. */
export function jobUserEmail(body: unknown): string | null {
  return emailField(body, 'user_email');
}

export async function loadServiceAccountEmail(fetchImpl: FetchLike, signal?: AbortSignal): Promise<string | null> {
  try {
    const response = await fetchImpl(TOKENINFO_URL, {
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!response.ok) return null;
    return serviceAccountEmail(await response.json());
  } catch {
    return null;
  }
}

export async function loadJobUserEmail(
  fetchImpl: FetchLike,
  job: CredentialJob,
  signal?: AbortSignal,
): Promise<string | null> {
  const url = new URL(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(job.projectId)}/jobs/${encodeURIComponent(job.jobId)}`,
  );
  if (job.location) url.searchParams.set('location', job.location);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!response.ok) return null;
    return jobUserEmail(await response.json());
  } catch {
    return null;
  }
}

function emailField(body: unknown, key: string): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[key];
  if (typeof value !== 'string') return null;
  const email = value.trim();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return null;
  return email;
}
