# SQL-Console

Read-only BigQuery preview inside OWOX Data Marts.

Write one `SELECT` or `WITH` query, save it, and page through the rows. Saved queries stay in your member collection for this project. Each save keeps the SQL. Versions compares that save with the previous one, and Base and Compare can pick any pair. The diff shows line numbers on both sides. SQL and Description are two editor modes. A description is Markdown of up to 2,500 characters. Create data mart asks for a BigQuery storage, then creates a SQL data mart with the current query and opens it. The plugin opens an empty `Untitled query` even when older queries are saved.

Suggestions use the BigQuery tables, views, and connector tables behind data marts you can open. After `FROM` or `JOIN`, the list offers `project.dataset.table`. After `SELECT`, and in `WHERE`, `ON`, and `GROUP BY`, it offers fields from the tables already named in the query. Those fields come from the schema saved on the data mart. A calculated field is omitted, because it is not a column of the warehouse table.

Focus Project or Location and pick a BigQuery storage. The list names the storage and shows the GCP project and location that will be filled in. You can still type either value. The Credential does not include the project id. Leave location empty to let BigQuery choose.

The query runs with the Google Service Account Credential you grant when installing the plugin. One installation uses one Credential. OWOX keeps that key and attaches a token for the plugin scopes to requests to `*.googleapis.com`. A Storage's own saved key is not used. The editor foot names that Credential, and shows the service account email when Google or the BigQuery job reports it.

Download CSV saves the rows on the current preview page. A later page is a separate file.

Export this page opens a side sheet and sends that same preview page to a Google Sheet or Google Doc saved on the query. Several queries can share one spreadsheet and write different sheets. Leave the sheet name empty to use the query title. Re-export replaces that sheet. A document gets a new heading and table at the end, and earlier text stays.

The Credential also requests Sheets, Docs, and read-only Drive file metadata. After this update, select the Credential again. Enable the Google Sheets API, Google Docs API, and Google Drive API on the GCP project that owns the key.

The plugin cannot share a file. Open the Sheet or Doc, choose Share, and add the service account address as Editor. The list shows files that account can already open. Pasting a link uses the same access.

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
