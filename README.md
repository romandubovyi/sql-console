# SQL-Console

Read-only BigQuery preview inside OWOX Data Marts.

Write one `SELECT` or `WITH` query, save it, and page through the rows. Saved queries stay in your member collection for this project. Each save keeps the SQL. Versions compares that save with the previous one, and Base and Compare can pick any pair. The diff shows line numbers on both sides. SQL and Description are two editor modes. A description is Markdown of up to 2,500 characters. Create data mart asks for a BigQuery storage, then creates a SQL data mart with the current query and opens it. The plugin opens an empty `Untitled query` even when older queries are saved.

Focus Project or Location and pick a BigQuery storage. The list names the storage and shows the GCP project and location that will be filled in. You can still type either value. The Credential does not include the project id. Leave location empty to let BigQuery choose.

The query runs with the Google Service Account Credential you grant when installing the plugin. One installation uses one Credential. OWOX keeps that key and attaches a `bigquery.readonly` token to requests to `*.googleapis.com`. A Storage's own saved key is not used.

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
