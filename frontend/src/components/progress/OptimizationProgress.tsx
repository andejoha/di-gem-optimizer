import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import type { ProgressEvent } from '../../types/progress';

const STAGE_LABELS: Record<string, string> = {
  assignment: 'Solving gem assignment...',
  rerun_assignment: 'Re-solving gem assignment...',
  fill_empty: 'Filling empty sockets...',
  rerun_fill_empty: 'Re-filling empty sockets...',
  reorder: 'Reordering sockets...',
  leftover: 'Assigning remaining gems...',
  upgrades: 'Evaluating upgrades...',
  upgrades_rerun: 'Re-optimizing with upgrades...',
  rerun_reorder: 'Re-ordering sockets...',
  rerun_leftover: 'Re-assigning remaining gems...',
};

interface Props {
  progress: ProgressEvent | null;
}

export default function OptimizationProgress({ progress }: Props) {
  const isShop = progress != null && progress.stage === 'shop';

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

  const isDeterminate = shopProgress != null;

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
          value={isDeterminate ? shopProgress! : undefined}
        />
        <Typography variant="body2" color="text.secondary">
          {stageLabel}
        </Typography>
      </Box>
    </Box>
  );
}
