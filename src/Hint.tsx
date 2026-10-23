import { Info } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

interface HintProps {
  label: string;
  children: ReactNode;
  /** Footer hints open upward so the next pane does not cover them. */
  placement?: 'below' | 'above';
}

export function Hint({ label, children, placement = 'below' }: HintProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <span className="hint" ref={rootRef}>
      <button
        className="hint-button"
        type="button"
        aria-expanded={open}
        aria-label={`About ${label}`}
        title={`About ${label}`}
        onClick={() => setOpen(current => !current)}
      >
        <Info size={12} aria-hidden="true" />
      </button>
      {open ? (
        <span className={placement === 'above' ? 'hint-pop above' : 'hint-pop'} role="note">
          {children}
        </span>
      ) : null}
    </span>
  );
}
