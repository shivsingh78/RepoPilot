import { RunForm } from "./run-form";

export default function HomePage() {
  return (
    <>
      <h1 style={{ marginBottom: 4 }}>RepoPilot</h1>
      <p style={{ color: "#9aa3b2", marginTop: 0 }}>
        Paste a GitHub repository URL. RepoPilot ingests it, finds issues, proposes patches and verifies them in a sandbox.
        Results are labelled as <b>AI inference</b> or <b>Observed in sandbox</b>; the two are never mixed.
      </p>
      <RunForm />
    </>
  );
}
