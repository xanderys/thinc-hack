const STEPS = ["Lead", "Plan system", "Approve", "Check"];

// Reonic-style step header: done steps in ink, the current one underlined in blue.
export default function StepHead({ title, at }: { title: string; at: number }) {
  return (
    <div className="s-stephead">
      <h1>{title}</h1>
      <ol className="s-steps">
        {STEPS.map((s, k) => <li key={s} className={k === at ? "on" : k < at ? "done" : undefined} aria-current={k === at ? "step" : undefined}><i>{k + 1}</i>{s}</li>)}
      </ol>
    </div>
  );
}
