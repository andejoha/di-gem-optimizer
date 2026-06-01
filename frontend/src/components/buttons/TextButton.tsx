import type { ReactNode } from 'react';
import type { TextButtonSize, ButtonVariant } from '../../utils/buttonAssets';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import { getButtonBackgroundUrl } from '../../utils/buttonAssets';

const FONT_SIZE_MAP: Record<TextButtonSize, string> = {
  xxs: '0.5rem',
  xs:  '0.85rem',
  s:   '1.15rem',
  m:   '1.5rem',
  l:   '1.8rem',
  xl:  '2.1rem',
  xxl: '2.35rem',
};

interface Props {
  size: TextButtonSize;
  variant?: ButtonVariant;
  scale?: number;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}

export default function TextButton({ size, variant = 'primary', scale = 1, children, onClick, disabled = false }: Props) {
  const backgroundUrl = getButtonBackgroundUrl(variant, size);

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
        <Typography
          variant="body2"
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: 'rgba(255, 255, 255, 0.9)',
            textShadow: '0 0 4px rgba(0, 0, 0, 0.9)',
            whiteSpace: 'nowrap',
            userSelect: 'none',
            pointerEvents: 'none',
            fontSize: FONT_SIZE_MAP[size],
            fontWeight: 600,
            letterSpacing: '0.04em',
          }}
        >
          {children}
        </Typography>
      </Box>
    </ButtonBase>
  );
}
