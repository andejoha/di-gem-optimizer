import { useState } from 'react';
import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Popover from '@mui/material/Popover';
import Select from '@mui/material/Select';
import type { SelectChangeEvent } from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import starFilledIcon from '../../assets/images/buttons/star-filled.png';
import type { BonusMode } from '../../core/models';
import IconButton from '../buttons/IconButton';
import TextButton from '../buttons/TextButton';
import FeatureToggle from './FeatureToggle';
import SettingRow from './SettingRow';

interface Props {
  enableUpgrades: boolean;
  onEnableUpgradesChange: () => void;
  convert1Star: boolean;
  onConvert1StarChange: () => void;
  bonusMode: BonusMode;
  onBonusModeChange: (mode: BonusMode) => void;
  disabled: boolean;
  onImportClick: () => void;
  onExportClick: () => void;
}

const convert1StarLabel: ReactNode = (
  <>
    Convert R1 <Box component="img" src={starFilledIcon} sx={{ width: 13, height: 13, verticalAlign: 'middle' }} /> gems
  </>
);

export default function SettingsPopover({
  enableUpgrades,
  onEnableUpgradesChange,
  convert1Star,
  onConvert1StarChange,
  bonusMode,
  onBonusModeChange,
  disabled,
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
        <Box sx={{ p: 1.5, minWidth: 280 }}>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ display: 'block', mb: 1, textTransform: 'uppercase', letterSpacing: '0.08em' }}
          >
            Settings
          </Typography>
          <Divider sx={{ mb: 1.5 }} />
          <Stack spacing={1} alignItems="stretch">
            <FeatureToggle label="Suggest upgrades" checked={enableUpgrades} onChange={onEnableUpgradesChange} disabled={disabled} />
            <FeatureToggle label={convert1StarLabel} checked={convert1Star} onChange={onConvert1StarChange} disabled={disabled} />
            <SettingRow
              label="Activate bonuses"
              control={
                <Select<BonusMode>
                  size="small"
                  value={bonusMode}
                  disabled={disabled}
                  onChange={(e: SelectChangeEvent<BonusMode>) => onBonusModeChange(e.target.value as BonusMode)}
                  sx={{ minWidth: 100 }}
                >
                  <MenuItem value="off">Off</MenuItem>
                  <MenuItem value="budget">Budget</MenuItem>
                  <MenuItem value="forced">Forced</MenuItem>
                </Select>
              }
            />
          </Stack>
          <Divider sx={{ my: 1.5 }} />
          <Stack direction="row" spacing={1}>
            <TextButton size="s" variant="secondary" scale={0.6} onClick={handleImportClick}>
              Import
            </TextButton>
            <TextButton size="s" variant="secondary" scale={0.6} onClick={handleExportClick}>
              Export
            </TextButton>
          </Stack>
        </Box>
      </Popover>
    </>
  );
}
