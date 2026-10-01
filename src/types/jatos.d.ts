/** Ambient types for the JATOS runtime (jatos.js injected at page load). */
interface JatosWorkerId { workerId: string | null; }
interface JatosBatchSession { [key: string]: any; }

interface JatosGlobal {
  /** Unique study result ID for this run. */
  studyResultId: string;
  /** Component position within the study. */
  componentPos: number;
  /** Arbitrary metadata set in the JATOS GUI (study/batch/component JSON). */
  studyJson: unknown;
  batchSession: JatosBatchSession;
  componentJson: unknown;
  studySession: unknown;
  /** Run when the study page has loaded and jatos.js is ready. */
  onJatosLoad: (fn: () => void) => void;
  /** Resolve the (workerId, batchId, studyResultId) triple. */
  getStudyResultId: () => string;
  resolveWorkerId: () => Promise<JatosWorkerId | null>;
  /** Finish the study run and submit `resultData` to the JATOS server. */
  endStudy: (resultData?: unknown, jsonData?: unknown) => void;
  /** Abort the study run (marks it as an error, not a completed result). */
  abortStudy: (errorMsg?: string) => void;
  /** Per-trial/component logging endpoint. */
  addJatosData: (data: Record<string, unknown>) => void;
}

declare global {
  const jatos: JatosGlobal;
}

export {};
