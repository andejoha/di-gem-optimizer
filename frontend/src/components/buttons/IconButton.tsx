import type React from 'react';
import type { IconButtonSize, ButtonVariant, IconName } from '../../utils/buttonAssets';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import { getButtonBackgroundUrl, getButtonIconUrl } from '../../utils/buttonAssets';

interface Props {
  size: IconButtonSize;
  variant?: ButtonVariant;
  icon: IconName | 'cross' | 'back';
  scale?: number;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
}

export default function IconButton({ size, variant = 'primary', icon, scale = 1, onClick, disabled = false }: Props) {
  const backgroundUrl = getButtonBackgroundUrl(variant, size);
  const isCross = icon === 'cross';
  const isBack = icon === 'back';
  const iconUrl = getButtonIconUrl(isCross ? 'plus' : isBack ? 'next' : icon);
  const iconSize = size === 'diamond' ? '40%' : '50%';

  return (
    <ButtonBase
      onClick={onClick}
      disabled={disabled}
      style={scale !== 1 ? { zoom: scale } : undefined}
      sx={{
        display: 'inline-block',
        maxWidth: '100%',
        minWidth: 0,
        borderRadius: '2px',
        transition: 'filter 0.15s',
        '&:hover': { filter: 'brightness(1.25)' },
        '&:active': { filter: 'brightness(0.9)' },
        '&.Mui-disabled': { opacity: 0.4, pointerEvents: 'none' },
      }}
    >
      <Box sx={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}>
        <Box
          component="img"
          src={backgroundUrl}
          sx={{ display: 'block', maxWidth: '100%', height: 'auto' }}
        />
        <Box
          component="img"
          src={iconUrl}
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: isCross
              ? 'translate(-50%, -50%) rotate(45deg)'
              : isBack
                ? 'translate(-50%, -50%) scaleX(-1)'
                : 'translate(-50%, -50%)',
            width: iconSize,
            height: iconSize,
            objectFit: 'contain',
            pointerEvents: 'none',
          }}
        />
      </Box>
    </ButtonBase>
  );
}
