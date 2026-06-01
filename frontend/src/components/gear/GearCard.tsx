import { memo } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import type { GemSetupItem, SlotName } from '../../types/api';
import { SLOT_META, getGearImageUrl, getGemImageUrl, starFilled, starEmpty } from '../../utils/gearAssets';
import { formatRank } from '../../utils/rankUtils';

const gearBackground = getGearImageUrl('gear-background.png');
const gemSlotIcon = getGearImageUrl('gem-slot.png');

interface GearCardProps {
  slotName: SlotName;
  gemSetupItem: GemSetupItem | null;
  onSlotClick: (slot: SlotName) => void;
}

export default memo(function GearCard({ slotName, gemSetupItem, onSlotClick }: GearCardProps) {
  const meta = SLOT_META[slotName];
  const gearIconUrl = getGearImageUrl(meta.iconFile);

  function handleClick() {
    onSlotClick(slotName);
  }

  return (
    <ButtonBase
      onClick={handleClick}
      sx={{
        position: 'relative',
        display: 'block',
        width: '100%',
        overflow: 'hidden',
        borderRadius: 1,
        outline: 'none',
        transition: 'filter 0.15s, box-shadow 0.15s',
        '&:hover': {
          filter: 'brightness(1.25)',
          boxShadow: '0 0 10px rgba(255, 200, 0, 0.4)',
        },
      }}
    >
      {/* Layer 1: gear background — defines the card's natural shape */}
      <Box
        component="img"
        src={gearBackground}
        sx={{ display: 'block', width: '100%', height: 'auto' }}
      />
      {/* Layer 2: gear type icon (watermark) */}
      <Box
        component="img"
        src={gearIconUrl}
        sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '55%',
          height: '55%',
          objectFit: 'contain',
          opacity: 0.2,
        }}
      />
      {/* Layer 3a: empty socket (no gem configured) */}
      {!gemSetupItem && (
        <Box
          component="img"
          src={gemSlotIcon}
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '35%',
            height: '35%',
            objectFit: 'contain',
          }}
        />
      )}
      {/* Layer 3b: rank + gem icon + stars (gem configured) */}
      {gemSetupItem && (
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 0.5,
            width: '100%',
            pointerEvents: 'none',
          }}
        >
          {(() => {
            const starRating = Math.floor(gemSetupItem.gem_id / 1000);
            return <>
              <Typography sx={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.9)', lineHeight: 1 }}>
                {formatRank(gemSetupItem.target_rank, starRating)}
              </Typography>
              <Box
                component="img"
                src={getGemImageUrl(gemSetupItem.gem_id)}
                sx={{ width: '75%', objectFit: 'contain' }}
              />
              <Box sx={{ display: 'flex', gap: '2px' }}>
                {Array.from({ length: starRating }, (_, i) => (
                  <Box
                    key={i}
                    component="img"
                    src={i < gemSetupItem.active_stars ? starFilled : starEmpty}
                    sx={{ width: 12, height: 12 }}
                  />
                ))}
              </Box>
            </>;
          })()}
        </Box>
      )}
      {/* Slot label */}
      <Typography
        sx={{
          position: 'absolute',
          bottom: 8,
          width: '100%',
          textAlign: 'center',
          fontSize: '1rem',
          color: 'rgba(255,255,255,0.75)',
          lineHeight: 1,
          pointerEvents: 'none',
        }}
      >
        {meta.label}
      </Typography>
    </ButtonBase>
  );
});
