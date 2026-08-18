import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

interface Props {
  label: ReactNode;
  control: ReactNode;
}

/**
 * Renders a settings-popover row with a label on the left and an arbitrary
 * control on the right, matching `FeatureToggle`'s row metrics
 * (`width: '100%', minHeight: 40`).
 */
export default function SettingRow({ label, control }: Props) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.75, width: '100%', minHeight: 40 }}>
      <Typography variant="body1" color="text.secondary" sx={{ userSelect: 'none', display: 'flex', alignItems: 'center', gap: 0.4 }}>
        {label}
      </Typography>
      {control}
    </Box>
  );
}
