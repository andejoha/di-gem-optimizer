import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import checkedIcon from '../../assets/images/buttons/checked-box.png';
import uncheckedIcon from '../../assets/images/buttons/unchecked-box.png';

interface Props {
  label: ReactNode;
  tooltipLabel: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}

export default function FeatureToggle({ label, tooltipLabel, checked, onChange, disabled = false }: Props) {
  return (
    <Tooltip title={`${tooltipLabel}: ${checked ? 'on' : 'off'}`}>
      <ButtonBase
        onClick={onChange}
        disabled={disabled}
        sx={{ borderRadius: 1, opacity: disabled ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 0.75 }}
      >
        <Box component="img" src={checked ? checkedIcon : uncheckedIcon} sx={{ width: 40, height: 40 }} />
        <Typography variant="body1" color="text.secondary" sx={{ userSelect: 'none', display: 'flex', alignItems: 'center', gap: 0.4 }}>
          {label}
        </Typography>
      </ButtonBase>
    </Tooltip>
  );
}
