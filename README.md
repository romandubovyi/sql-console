# SQL-Console

Read-only BigQuery preview inside OWOX Data Marts.

Pick a BigQuery Storage you can already see in the project, write one `SELECT` or `WITH` query, and preview up to 100 rows.

The query runs with the Google Service Account Credential you grant when installing the plugin. OWOX keeps that key and attaches a `bigquery.readonly` token to requests to `*.googleapis.com`. The Storage's own saved key is not used.

The service account needs **BigQuery Job User** on the GCP project and **BigQuery Data Viewer** on the tables. A Storage that signs in with Google OAuth needs a separate service account Credential.

## Install on app.owox.com

1. Create a **Google Service Account** Credential in the test project and paste the JSON key.
2. Open **Plugins → Publish Plugin**.
3. Enter `romandubovyi/sql-console`, choose **Only me**, then **Publish & Install**.
4. Select that Credential when the install dialog asks for it.

The GitHub repository is private. The Pages site that serves the plugin is public, which GitHub Pages requires.

## Checks

```bash
npm install
npm test
npm run lint
npm run build
```
