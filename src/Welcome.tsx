import { CalendarClock, FileInput, Play, Save, Sheet } from 'lucide-react';
import type { ReactNode } from 'react';

const steps: { title: string; text: string; icon: ReactNode }[] = [
  {
    title: 'Write',
    text: 'Type SQL, or import a data mart or the full SQL a report will run.',
    icon: <FileInput size={15} aria-hidden="true" />,
  },
  {
    title: 'Run',
    text: 'Read-only BigQuery on the plugin service account. Page through the rows here.',
    icon: <Play size={15} aria-hidden="true" />,
  },
  {
    title: 'Keep',
    text: 'The text is kept as you type. Save stores a version you can compare.',
    icon: <Save size={15} aria-hidden="true" />,
  },
  {
    title: 'Send',
    text: 'A Sheet, a Doc, or CSV. Or create a SQL data mart from this query.',
    icon: <Sheet size={15} aria-hidden="true" />,
  },
  {
    title: 'Repeat',
    text: 'Replace the same sheet daily or weekly, even while SQL-Console is closed.',
    icon: <CalendarClock size={15} aria-hidden="true" />,
  },
];

export function Welcome({ onNew }: { onNew: () => void }) {
  return (
    <section className="welcome" aria-label="What SQL-Console can do">
      <div className="welcome-copy">
        <h1>Check a result before you make a report</h1>
        <p>
          Write a query, see the rows, and send them to a Sheet or Doc. A report is for a number other people should
          keep.
        </p>
        <button className="primary" type="button" onClick={onNew}>
          New query
        </button>
      </div>
      <ol className="welcome-flow">
        {steps.map((step, index) => (
          <li key={step.title}>
            <span className="welcome-mark">
              <span className="welcome-index">{index + 1}</span>
              {step.icon}
            </span>
            <strong>{step.title}</strong>
            <span>{step.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
