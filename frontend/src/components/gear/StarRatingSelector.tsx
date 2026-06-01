import Box from '@mui/material/Box';
import type { StarRating } from '../../types/api';
import { starFilled, starEmpty } from '../../utils/gearAssets';

interface StarRatingSelectorProps {
  starRating: StarRating;
  activeStars: number;
  onChange: (stars: number) => void;
}

export default function StarRatingSelector({ starRating, activeStars, onChange }: StarRatingSelectorProps) {
  const interactive = starRating === 5;

  function handleClick(index: number) {
    if (!interactive) return;
    onChange(Math.max(2, index));
  }

  return (
    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
      {Array.from({ length: starRating }, (_, i) => {
        const index = i + 1;
        const filled = index <= activeStars;
        return (
          <Box
            key={index}
            component="img"
            src={filled ? starFilled : starEmpty}
            onClick={() => handleClick(index)}
            sx={{
              width: 28,
              height: 28,
              cursor: interactive ? 'pointer' : 'default',
              transition: 'transform 0.1s',
              '&:hover': interactive ? { transform: 'scale(1.15)' } : undefined,
            }}
          />
        );
      })}
    </Box>
  );
}
