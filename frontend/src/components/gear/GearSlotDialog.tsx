import { useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import type { GemInfo, GemSetupItem, SlotName } from '../../types/api';
import { SLOT_META, getGemImageUrl, defaultGemImage } from '../../utils/gearAssets';
import { getMaxSubRank, parseRank } from '../../utils/rankUtils';
import IconButton from '../buttons/IconButton';
import StarRatingSelector from './StarRatingSelector';

interface GearSlotDialogProps {
  open: boolean;
  slotName: SlotName;
  currentItem: GemSetupItem | null;
  gems: GemInfo[];
  onSave: (item: GemSetupItem) => void;
  onClear: () => void;
  onClose: () => void;
}

export default function GearSlotDialog({
  open,
  slotName,
  currentItem,
  gems,
  onSave,
  onClear,
  onClose,
}: GearSlotDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  const initialGem = currentItem
    ? (gems.find((g) => g.id === currentItem.gem_id) ?? null)
    : null;
  const [initialMain, initialProg] = currentItem ? parseRank(currentItem.target_rank) : [1, 0];

  const [selectedGem, setSelectedGem] = useState<GemInfo | null>(initialGem);
  const [activeStars, setActiveStars] = useState<number>(currentItem?.active_stars ?? 1);
  const [mainRank, setMainRank] = useState<number | ''>(initialMain);
  const [subRank, setSubRank] = useState<number>(initialProg);

  const effectiveMainRank = mainRank || 1;

  const showSubRank =
    selectedGem !== null && selectedGem.star_rating !== 1 && effectiveMainRank >= 4 && effectiveMainRank < 10;

  function handleGemChange(gem: GemInfo | null) {
    setSelectedGem(gem);
    if (!gem) return;
    setActiveStars(gem.star_rating === 5 ? 2 : gem.star_rating);
    if (gem.star_rating === 1 || (mainRank || 1) < 4) setSubRank(0);
  }

  function handleMainRankChange(raw: string) {
    if (raw === '') {
      setMainRank('');
      setSubRank(0);
      return;
    }
    const next = Math.max(1, Math.min(10, parseInt(raw, 10) || 1));
    setMainRank(next);
    setSubRank(0);
  }

  function handleSubRankPctChange(pct: number) {
    if (!selectedGem) return;
    const maxSub = getMaxSubRank(selectedGem.star_rating, effectiveMainRank);
    const step = Math.round(100 / (maxSub + 1));
    const next = Math.round(pct / step);
    setSubRank(Math.max(0, Math.min(maxSub, next)));
  }

  function handleSave() {
    if (!selectedGem) return;
    const targetRank = showSubRank && subRank > 0
      ? `${effectiveMainRank}.${subRank}`
      : `${effectiveMainRank}`;
    onSave({ gem_id: selectedGem.id, target_rank: targetRank, active_stars: activeStars });
  }

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} maxWidth="xs" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Box
            component="img"
            src={selectedGem ? getGemImageUrl(selectedGem.id) : defaultGemImage}
            sx={{ width: 40, height: 40, objectFit: 'contain', flexShrink: 0 }}
          />
          <span>Configure {SLOT_META[slotName].label}</span>
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
          <Autocomplete
              sx={{ flex: 1 }}
              options={gems}
              groupBy={(option) => `${option.star_rating}-Star`}
              getOptionLabel={(option) => option.name}
              isOptionEqualToValue={(option, value) => option.name === value.name}
              value={selectedGem}
              onChange={(_, value) => handleGemChange(value)}
              renderInput={(params) => <TextField {...params} label="Gem" />}
              renderOption={(props, option) => {
                const { key, ...liProps } = props as typeof props & { key: React.Key };
                return (
                  <Box key={key} component="li" {...liProps} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box
                      component="img"
                      src={getGemImageUrl(option.id)}
                      sx={{ width: 28, height: 28, flexShrink: 0 }}
                    />
                    {option.name}
                  </Box>
                );
              }}
            />

          {selectedGem && (
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                Active Stars
              </Typography>
              <StarRatingSelector
                starRating={selectedGem.star_rating}
                activeStars={activeStars}
                onChange={setActiveStars}
              />
            </Box>
          )}

          {selectedGem && <Stack direction="row" spacing={2}>
            <Autocomplete
              sx={{ flex: 1 }}
              options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}
              getOptionLabel={(o) => String(o)}
              value={mainRank === '' ? null : mainRank}
              onChange={(_, value) => handleMainRankChange(value === null ? '' : String(value))}
              renderInput={(params) => <TextField {...params} label="Rank" />}
            />
            {showSubRank && (() => {
              const maxSub = getMaxSubRank(selectedGem!.star_rating, effectiveMainRank);
              const step = Math.round(100 / (maxSub + 1));
              const options = Array.from({ length: maxSub + 1 }, (_, i) => i * step);
              return (
                <Autocomplete
                  sx={{ flex: 1 }}
                  options={options}
                  getOptionLabel={(o) => `${o}%`}
                  value={subRank * step}
                  onChange={(_, value) => handleSubRankPctChange(value ?? 0)}
                  disableClearable
                  renderInput={(params) => <TextField {...params} label="Progress" />}
                />
              );
            })()}
          </Stack>}
        </Stack>
      </DialogContent>
      <DialogActions>
        {currentItem && (
          <IconButton size="xxs" variant="secondary" icon="delete" onClick={onClear} />
        )}
        <Box sx={{ flex: 1 }} />
        <IconButton size="xxs" variant="secondary" icon="close" onClick={onClose} />
        <IconButton size="xxs" icon="check" onClick={handleSave} disabled={!selectedGem} />
      </DialogActions>
    </Dialog>
  );
}
