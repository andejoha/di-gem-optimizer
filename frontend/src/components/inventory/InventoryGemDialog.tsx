import { useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '../buttons/IconButton';
import checkedIcon from '../../assets/images/buttons/checked-box.png';
import uncheckedIcon from '../../assets/images/buttons/unchecked-box.png';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import type { GemInfo } from '../../types/api';
import type { InventoryGemStack } from '../../types/inventory';
import { getGemImageUrl, defaultGemImage } from '../../utils/gearAssets';
import { getMaxSubRank, parseRank } from '../../utils/rankUtils';
import { dormantContribution } from '../../utils/gemPowerCost';
import StarRatingSelector from '../gear/StarRatingSelector';

interface InventoryGemDialogProps {
  open: boolean;
  currentStack: InventoryGemStack | null;
  gems: GemInfo[];
  gemPower: number;
  onSave: (data: Omit<InventoryGemStack, 'id'>) => void;
  onRemove: () => void;
  onClose: () => void;
}

export default function InventoryGemDialog({ open, currentStack, gems, gemPower, onSave, onRemove, onClose }: InventoryGemDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  const initialGem = currentStack ? (gems.find((g) => g.id === currentStack.gem_id) ?? null) : null;
  const [initialMain, initialProg] = currentStack ? parseRank(currentStack.rank) : [1, 0];

  const [selectedGem, setSelectedGem] = useState<GemInfo | null>(initialGem);
  const [activeStars, setActiveStars] = useState<number>(currentStack?.active_stars ?? 1);
  const [mainRank, setMainRank] = useState<number | ''>(initialMain);
  const [subRank, setSubRank] = useState<number>(initialProg);
  const [quantityStr, setQuantityStr] = useState<string>(String(currentStack?.quantity ?? 1));
  const [dormant, setDormant] = useState<boolean>(currentStack?.dormant ?? false);

  const effectiveMainRank = mainRank || 1;

  const showSubRank = selectedGem !== null && selectedGem.star_rating !== 1 && effectiveMainRank >= 4 && effectiveMainRank < 10;

  const effectiveRank = showSubRank && subRank > 0 ? `${effectiveMainRank}.${subRank}` : `${effectiveMainRank}`;

  // Compute GP delta for dormant toggle (only meaningful when editing an existing stack).
  const isEditing = currentStack !== null;
  const gpDelta =
    isEditing && selectedGem
      ? dormantContribution({
          dormant,
          quantity: Math.max(1, parseInt(quantityStr, 10) || 1),
          star_rating: selectedGem.star_rating,
          rank: effectiveRank,
        }) - dormantContribution(currentStack)
      : 0;
  const gpInsufficient = gpDelta < 0 && gemPower + gpDelta < 0;

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

  function handleQuantityBlur() {
    const parsed = Math.max(1, parseInt(quantityStr, 10) || 1);
    setQuantityStr(String(parsed));
  }

  function handleSave() {
    if (!selectedGem || gpInsufficient) return;
    const quantity = Math.max(1, parseInt(quantityStr, 10) || 1);
    onSave({
      gem_id: selectedGem.id,
      star_rating: selectedGem.star_rating,
      rank: effectiveRank,
      active_stars: activeStars,
      quantity,
      dormant,
    });
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
          <span>{isEditing ? 'Edit Gem' : 'Add Gem'}</span>
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
          <Autocomplete
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
                  <Box component="img" src={getGemImageUrl(option.id)} sx={{ width: 28, height: 28, flexShrink: 0 }} />
                  {option.name}
                </Box>
              );
            }}
          />

          {selectedGem && (
            <Box>
              <Stack direction="row" alignItems="flex-end" justifyContent="space-between">
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                    Active Stars
                  </Typography>
                  <StarRatingSelector starRating={selectedGem.star_rating} activeStars={activeStars} onChange={setActiveStars} />
                </Box>
                {effectiveMainRank > 1 && (
                  <Tooltip title={`Dormant: ${dormant ? 'on' : 'off'}`}>
                    <ButtonBase
                      onClick={() => setDormant((d) => !d)}
                      sx={{ borderRadius: 1, display: 'flex', alignItems: 'center', gap: 0.75 }}
                    >
                      <Typography variant="body1" color="text.secondary" sx={{ userSelect: 'none' }}>
                        Dormant
                      </Typography>
                      <Box component="img" src={dormant ? checkedIcon : uncheckedIcon} sx={{ width: 28, height: 28 }} />
                    </ButtonBase>
                  </Tooltip>
                )}
              </Stack>
              {gpInsufficient && (
                <Typography variant="caption" color="error" display="block" sx={{ mt: 0.5 }}>
                  Not enough Gem Power to reactivate this gem.
                </Typography>
              )}
            </Box>
          )}

          {selectedGem && (
            <Stack direction="row" spacing={2}>
              <Autocomplete
                sx={{ flex: 1 }}
                options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}
                getOptionLabel={(o) => String(o)}
                value={mainRank === '' ? null : mainRank}
                onChange={(_, value) => handleMainRankChange(value === null ? '' : String(value))}
                renderInput={(params) => <TextField {...params} label="Rank" />}
              />
              {showSubRank &&
                (() => {
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
            </Stack>
          )}

          {selectedGem && (
            <TextField
              label="Quantity"
              type="number"
              value={quantityStr}
              onChange={(e) => setQuantityStr(e.target.value)}
              onBlur={handleQuantityBlur}
              inputProps={{ min: 1 }}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {isEditing && <IconButton size="xxs" variant="secondary" icon="delete" onClick={onRemove} />}
        <Box sx={{ flex: 1 }} />
        <IconButton size="xxs" variant="secondary" icon="close" onClick={onClose} />
        <IconButton size="xxs" icon="check" onClick={handleSave} disabled={!selectedGem || gpInsufficient} />
      </DialogActions>
    </Dialog>
  );
}
