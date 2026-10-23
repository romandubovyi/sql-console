# SQL-Console

Query BigQuery without leaving OWOX. Save the SQL, look at the rows, and put them where the team already reads them: a Google Sheet, a Doc, or a SQL data mart. A daily or weekly run can replace that sheet even when SQL-Console is closed.

![Write, run, keep, send, and repeat a BigQuery query](docs/flow.svg)

## Why it is useful

- **The warehouse stays read-only.** A query is one `SELECT` or `WITH`. The credential can run jobs and read tables. It cannot change BigQuery data.
- **The SQL stays with the work.** Each save keeps the statement. Compare any two versions side by side, and leave a Markdown note of up to 2,500 characters beside the query.
- **You start from data marts you can already open.** After `FROM` or `JOIN`, suggestions offer `project.dataset.table` for tables, views, and connector tables. Fields from those tables appear in `SELECT`, `WHERE`, `ON`, and `GROUP BY`.
- **A good query can become a data mart.** Create a SQL data mart on a BigQuery storage and open it, without retyping the statement.
- **The sheet can refresh itself.** Save the query, export once so the tab exists, then pick a day and a time. The run uses that saved SQL and the GCP project and location from the moment you saved the schedule.

## What you can do

| | |
| --- | --- |
| Preview | Page through the result. The last run opens again for about 24 hours. Clear cache forgets the job and does not delete a BigQuery table. |
| Download | CSV of the current preview page. A later page is a separate file. |
| Export | This page, or up to 100,000 rows from the current job, into a Google Sheet. A Doc can take 2,000 cells, appended as a new heading and table. Several queries can share one spreadsheet, each with its own tab. |
| Schedule | Daily or weekly replacement of that sheet tab. Pause, resume, and delete also live under Plugins → Schedules. |
| Project | Pick a BigQuery storage to fill the GCP project and location, or type them. Leave location empty and BigQuery chooses. |

## Before the first export

The plugin uses the Google Service Account Credential you select at install. OWOX keeps the key. A storage's own key is not used.

1. Grant that account **BigQuery Job User** on the GCP project and **BigQuery Data Viewer** on the tables.
2. Enable the BigQuery, Sheets, Docs, and Drive APIs on the project that owns the key.
3. Open the Sheet or Doc, choose Share, and add the service account as Editor. SQL-Console lists files that account can already open. It cannot share a file for you.

A Storage that signs in with Google OAuth still needs this separate service account.

## Install

1. Create a **Google Service Account** Credential and paste the JSON key.
2. Open **Plugins → Publish Plugin**.
3. Enter `romandubovyi/sql-console`, choose who can see it, then **Publish & Install**.
4. Select that Credential when the install dialog asks for it.

Installing tells you that scheduled runs use the installing member's access, including while the plugin is closed. The page is on GitHub Pages. The schedule action runs on a Cloudflare Worker.

## Develop

```bash
npm install
npm test
npm run lint
npm run build
```
