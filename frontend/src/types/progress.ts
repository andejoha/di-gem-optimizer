export interface ProgressEvent {
  stage: string;
  status: string;
  iteration: number | null;
  detail: string | null;
  candidates_done: number | null;
  candidates_total: number | null;
}
