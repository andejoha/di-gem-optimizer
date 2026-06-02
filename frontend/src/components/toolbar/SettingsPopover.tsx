import { useState } from 'react';
import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Popover from '@mui/material/Popover';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import starFilledIcon from '../../assets/images/buttons/star-filled.png';
import IconButton from '../buttons/IconButton';
import TextButton from '../buttons/TextButton';
import FeatureToggle from './FeatureToggle';

interface Props {
  enableUpgrades: boolean;
  onEnableUpgradesChange: () => void;
  convert1Star: boolean;
  onConvert1StarChange: () => void;
  isEmpty: boolean;
  disabled: boolean;
  onResetClick: () => void;
  onImportClick: () => void;
  onExportClick: () => void;
}

const convert1StarLabel: ReactNode = (
  <>
    Convert R1{' '}
    <Box component="img" src={starFilledIcon} sx={{ width: 13, height: 13, verticalAlign: 'middle' }} />{' '}
    gems
  </>
);

export default function SettingsPopover({
  enableUpgrades,
  onEnableUpgradesChange,
  convert1Star,
  onConvert1StarChange,
  isEmpty,
  disabled,
  onResetClick,
  onImportClick,
  onExportClick,
}: Props) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  function handleOpen(e: React.MouseEvent<HTMLButtonElement>) {
    setAnchorEl(e.currentTarget);
  }

  function handleClose() {
    setAnchorEl(null);
  }

  function handleResetClick() {
    handleClose();
    onResetClick();
  }

  function handleImportClick() {
    handleClose();
    onImportClick();
  }

  function handleExportClick() {
    handleClose();
    onExportClick();
  }

  return (
    <>
      <IconButton size="xxs" variant="secondary" icon="cog" onClick={handleOpen} />
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { mt: 0.5 } } }}
      >
        <Box sx={{ p: 1.5, minWidth: 220 }}>
          <Typography variant="body2" color="text.secondary" sx={{ display: 'block', mb: 1, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Settings
          </Typography>
          <Divider sx={{ mb: 1.5 }} />
          <Stack spacing={1} alignItems="flex-start">
            <FeatureToggle
              label="Suggest upgrades"
              tooltipLabel="Suggest upgrades"
              checked={enableUpgrades}
              onChange={onEnableUpgradesChange}
              disabled={disabled}
            />
            <FeatureToggle
              label={convert1StarLabel}
              tooltipLabel="Convert R1 1-star gems"
              checked={convert1Star}
              onChange={onConvert1StarChange}
              disabled={disabled}
            />
          </Stack>
          <Divider sx={{ my: 1.5 }} />
          <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            <TextButton size="s" variant="secondary" scale={0.6} onClick={handleImportClick}>Import</TextButton>
            <TextButton size="s" variant="secondary" scale={0.6} onClick={handleExportClick}>Export</TextButton>
          </Stack>
          <IconButton
            size="xxs"
            variant="secondary"
            icon="delete"
            scale={0.6}
            disabled={isEmpty}
            onClick={handleResetClick}
          />
        </Box>
      </Popover>
    </>
  );
}
