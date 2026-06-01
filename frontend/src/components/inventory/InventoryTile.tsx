import { memo } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import type { InventoryGemStack } from '../../types/inventory';
import { getGemImageUrl } from '../../utils/gearAssets';
import { inventoryEmptyBg, inventoryFilledBg } from '../../utils/inventoryAssets';
import { parseRank, getMaxSubRank, subRankToPercent } from '../../utils/rankUtils';

interface InventoryTileProps {
  stack: InventoryGemStack | null;
  onTileClick: (id: string) => void;
  onEmptyClick: () => void;
}

export default memo(function InventoryTile({ stack, onTileClick, onEmptyClick }: InventoryTileProps) {
  const [mainRank, subRank] = stack ? parseRank(stack.rank) : [0, 0];
  const rankLabel = stack ? `R${mainRank}` : '';
  const pctLabel = stack && subRank > 0
    ? `${subRankToPercent(subRank, getMaxSubRank(stack.star_rating, mainRank))}%`
    : '';

  function handleClick() {
    if (stack) onTileClick(stack.id);
    else onEmptyClick();
  }

  return (
    <ButtonBase
      onClick={handleClick}
      sx={{
        display: 'block',
        width: '100%',
        borderRadius: 0.5,
        overflow: 'hidden',
        transition: stack ? 'filter 0.15s, box-shadow 0.15s' : 'filter 0.15s',
        '&:hover': {
          filter: 'brightness(1.25)',
          ...(stack && { boxShadow: '0 0 8px rgba(255, 200, 0, 0.4)' }),
        },
      }}
    >
      <Box sx={{ position: 'relative', width: '100%' }}>
        <Box
          component="img"
          src={stack ? inventoryFilledBg : inventoryEmptyBg}
          sx={{ display: 'block', width: '100%', height: 'auto' }}
        />
        {stack && (
          <>
            <Box
              component="img"
              src={getGemImageUrl(stack.gem_id)}
              sx={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '75%',
                objectFit: 'contain',
                pointerEvents: 'none',
              }}
            />
            {pctLabel && (
              <Typography
                sx={{
                  position: 'absolute',
                  top: 8,
                  left: 10,
                  fontSize: '1rem',
                  color: 'rgba(255,255,255,0.9)',
                  lineHeight: 1,
                  pointerEvents: 'none',
                  textShadow: '0 0 3px rgba(0,0,0,0.8)',
                }}
              >
                {pctLabel}
              </Typography>
            )}
            <Typography
              sx={{
                position: 'absolute',
                bottom: 8,
                left: 10,
                fontSize: '1rem',
                color: 'rgba(255,255,255,0.9)',
                lineHeight: 1,
                pointerEvents: 'none',
                textShadow: '0 0 3px rgba(0,0,0,0.8)',
              }}
            >
              {rankLabel}
            </Typography>
            {stack.quantity > 1 && (
              <Typography
                sx={{
                  position: 'absolute',
                  bottom: 8,
                  right: 10,
                  fontSize: '1rem',
                  color: 'rgba(255,255,255,0.9)',
                  lineHeight: 1,
                  pointerEvents: 'none',
                  textShadow: '0 0 3px rgba(0,0,0,0.8)',
                }}
              >
                {stack.quantity}
              </Typography>
            )}
          </>
        )}
      </Box>
    </ButtonBase>
  );
});
