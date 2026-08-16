import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import type { ProgressEvent } from '../../types/progress';

// Keys match the stage names emitted by core/pipeline.ts and
// core/api/runOptimization.ts exactly.
const STAGE_LABELS: Record<string, string> = {
  assignment: 'Solving gem assignment...',
  fill_empty: 'Filling empty sockets...',
  redistribute: 'Redistributing for bonuses...',
  reorder: 'Reordering sockets...',
  upgrades: 'Evaluating upgrades...',
  upgrades_rerun: 'Re-optimizing with upgrades...',
};

interface Props {
  progress: ProgressEvent | null;
}

export default function OptimizationProgress({ progress }: Props) {
  const stageLabel = progress ? (STAGE_LABELS[progress.stage] ?? progress.detail ?? 'Optimizing...') : 'Optimizing...';

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
        <LinearProgress />
        <Typography variant="body2" color="text.secondary">
          {stageLabel}
        </Typography>
      </Box>
    </Box>
  );
}
