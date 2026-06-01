import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import type { ProgressEvent } from '../../types/progress';

const STAGE_LABELS: Record<string, string> = {
  ilp_assignment: 'Solving gem assignment...',
  global_swaps: 'Optimizing bonus activations...',
  reorder: 'Reordering sockets...',
  leftover: 'Assigning remaining gems...',
  upgrades: 'Evaluating upgrades...',
  upgrades_rerun: 'Re-optimizing with upgrades...',
  rerun_ilp_assignment: 'Re-solving gem assignment...',
  rerun_global_swaps: 'Re-optimizing bonus activations...',
  rerun_reorder: 'Re-ordering sockets...',
  rerun_leftover: 'Re-assigning remaining gems...',
};

const ILP_STAGES = new Set(['ilp_assignment', 'rerun_ilp_assignment']);

interface Props {
  progress: ProgressEvent | null;
  disableIlpTimeLimit: boolean;
}

export default function OptimizationProgress({ progress, disableIlpTimeLimit }: Props) {
  const isIlp = progress != null && ILP_STAGES.has(progress.stage);
  const isShop = progress != null && progress.stage === 'shop';
  const timeLimit = isIlp && !disableIlpTimeLimit ? (progress!.time_limit ?? null) : null;

  const candidatesDone = isShop ? (progress!.candidates_done ?? null) : null;
  const candidatesTotal = isShop ? (progress!.candidates_total ?? null) : null;
  const shopProgress =
    candidatesDone != null && candidatesTotal != null && candidatesTotal > 0
      ? (candidatesDone / candidatesTotal) * 100
      : null;

  // Label: for shop, use the live detail text; for other stages fall back to static labels.
  const stageLabel = progress
    ? (isShop
        ? (progress.detail ?? 'Analyzing gem purchases...')
        : (STAGE_LABELS[progress.stage] ?? progress.detail ?? 'Optimizing...'))
    : 'Optimizing...';

  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (timeLimit == null) {
      setSecondsLeft(null);
      return;
    }

    setSecondsLeft(timeLimit);
    intervalRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev === null || prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isIlp, timeLimit]);

  const showCountdown = isIlp && timeLimit != null && secondsLeft != null;
  const ilpProgressValue = showCountdown ? ((timeLimit - secondsLeft) / timeLimit) * 100 : 0;

  const isDeterminate = showCountdown || shopProgress != null;
  const progressValue = showCountdown ? ilpProgressValue : (shopProgress ?? 0);

  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: (theme) => theme.zIndex.modal + 1,
        bgcolor: 'rgba(0, 0, 0, 0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Box
        sx={{
          width: 320,
          bgcolor: 'background.paper',
          borderRadius: 2,
          p: 3,
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
        }}
      >
        <Typography variant="body1" sx={{ fontWeight: 'bold', textAlign: 'center' }}>
          Optimizing...
        </Typography>
        <LinearProgress
          variant={isDeterminate ? 'determinate' : 'indeterminate'}
          value={isDeterminate ? progressValue : undefined}
        />
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Typography variant="body2" color="text.secondary">
            {stageLabel}
          </Typography>
          {showCountdown && (
            <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0, ml: 1 }}>
              ~{secondsLeft}s
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
}
