export interface ProgressEvent {
  stage: string;
  status: string;
  iteration: number | null;
  detail: string | null;
}
