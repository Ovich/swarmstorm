import type { BoardSnapshot } from "../../../../../swarm-board/src/client/reader.ts";
import { useEffect, useRef, useState } from "react";
import { formatDuration } from "../../../lib/board/duration.ts";
import { MemberTag } from "./chips.tsx";

/** What the lock is, on hover and keyboard focus (D22), read by TipLayer. */
const LOCK_TIP =
  "Merge lock: one member merges at a time, across every run. When a member takes it, the board compares the files its branch changed with its claims: a changed file nobody holds is claimed for it, one another member holds is flagged on the conversation. The member then rebases, runs its check and fast-forwards the branch; its merged line names the files it changed, and the members holding them rebase. Then the lock is free for the next in line.";

const clock = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const span = (from: string, to: string | null): string =>
  to ? formatDuration(Date.parse(to) - Date.parse(from)) : "…";

/** The lock's turns, newest first: who asked, how long it waited, how long it held, refusals. */
function LockHistory({ history }: { history: BoardSnapshot["lockHistory"] }) {
  return (
    <div
      className="lockhistory"
      data-component="LockHistory"
      role="dialog"
      aria-label="Merge lock history"
    >
      <div className="label">Merge lock history</div>
      {history.length === 0 ? (
        <p className="nr">No turn yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>member</th>
              <th>asked</th>
              <th>waited</th>
              <th>held</th>
              <th>refused</th>
            </tr>
          </thead>
          <tbody>
            {history.map((t, i) => (
              <tr
                key={`${t.member}-${t.askedAt}-${i}`}
                className={
                  t.grantedAt ? (t.mergedAt ? "merged" : "holding") : "waiting"
                }
              >
                <td>
                  <MemberTag name={t.member} />
                </td>
                <td>{clock(t.askedAt)}</td>
                <td>
                  {t.grantedAt ? span(t.askedAt, t.grantedAt) : "waiting"}
                </td>
                <td>{t.grantedAt ? span(t.grantedAt, t.mergedAt) : "—"}</td>
                <td>{t.refused || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function MergeLock({
  lock,
  history = [],
}: {
  lock: BoardSnapshot["lock"];
  history?: BoardSnapshot["lockHistory"];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) =>
      ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <span className="lockanchor" ref={ref}>
      <button
        type="button"
        className={lock ? "lock held" : "lock"}
        data-component="MergeLock"
        data-tip={open ? undefined : LOCK_TIP}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <rect x="3" y="7" width="10" height="7" rx="1.5" />
          <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
        </svg>
        {lock ? (
          <>
            <span className="t">merge lock</span>{" "}
            <MemberTag name={lock.holder} />
          </>
        ) : (
          <span className="t">merge lock free</span>
        )}
      </button>
      {open && <LockHistory history={history} />}
    </span>
  );
}
