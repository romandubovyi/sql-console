import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jobUserEmail, loadJobUserEmail, loadServiceAccountEmail, serviceAccountEmail } from './credential.ts';

test('reads a service account email and ignores anything else', () => {
  assert.equal(serviceAccountEmail({ email: ' reader@project.iam.gserviceaccount.com ' }), 'reader@project.iam.gserviceaccount.com');
  assert.equal(serviceAccountEmail({ email: 'not-an-email' }), null);
  assert.equal(serviceAccountEmail({ scope: 'bigquery.readonly' }), null);
  assert.equal(serviceAccountEmail(null), null);
  assert.equal(jobUserEmail({ user_email: 'reader@project.iam.gserviceaccount.com' }), 'reader@project.iam.gserviceaccount.com');
});

test('loads the email from tokeninfo and treats a refusal as unknown', async () => {
  const found = await loadServiceAccountEmail(async () =>
    Response.json({ email: 'reader@project.iam.gserviceaccount.com' }),
  );
  assert.equal(found, 'reader@project.iam.gserviceaccount.com');

  const missing = await loadServiceAccountEmail(async () => new Response('no', { status: 403 }));
  assert.equal(missing, null);

  const thrown = await loadServiceAccountEmail(async () => {
    throw new Error('offline');
  });
  assert.equal(thrown, null);
});

test('reads the job principal and asks BigQuery for that job', async () => {
  let requested = '';
  const email = await loadJobUserEmail(
    async input => {
      requested = String(input);
      return Response.json({ user_email: 'reader@project.iam.gserviceaccount.com' });
    },
    { projectId: 'owox-marketing', jobId: 'job 1', location: 'EU' },
  );
  assert.equal(email, 'reader@project.iam.gserviceaccount.com');
  const url = new URL(requested);
  assert.match(url.pathname, /\/projects\/owox-marketing\/jobs\/job%201$/);
  assert.equal(url.searchParams.get('location'), 'EU');
});
