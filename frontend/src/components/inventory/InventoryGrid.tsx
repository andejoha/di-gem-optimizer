import { useMemo } from 'react';
import Box from '@mui/material/Box';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import type { InventoryGemStack } from '../../types/inventory';
import { parseRank } from '../../utils/rankUtils';
import InventoryTile from './InventoryTile';

const COLS_DEFAULT = 6;
const COLS_MOBILE = 4;
const MIN_ROWS = 5;

function sortStacks(stacks: InventoryGemStack[], gemOrder: Map<number, number>): InventoryGemStack[] {
  return [...stacks].sort((a, b) => {
    // Dormant gems sort before active gems (priority #1).
    const ad = a.dormant ? 1 : 0, bd = b.dormant ? 1 : 0;
    if (ad !== bd) return bd - ad;
    if (b.star_rating !== a.star_rating) return b.star_rating - a.star_rating;
    const [aMain, aSub] = parseRank(a.rank);
    const [bMain, bSub] = parseRank(b.rank);
    if (bMain !== aMain) return bMain - aMain;
    if (bSub !== aSub) return bSub - aSub;
    const aIdx = gemOrder.get(a.gem_id) ?? Infinity;
    const bIdx = gemOrder.get(b.gem_id) ?? Infinity;
    if (aIdx !== bIdx) return aIdx - bIdx;
    if (b.active_stars !== a.active_stars) return b.active_stars - a.active_stars;
    return b.quantity - a.quantity;
  });
}

interface InventoryGridProps {
  stacks: InventoryGemStack[];
  gemOrder: Map<number, number>;
  onTileClick: (id: string) => void;
  onEmptyClick: () => void;
}

export default function InventoryGrid({ stacks, gemOrder, onTileClick, onEmptyClick }: InventoryGridProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const COLS = isMobile ? COLS_MOBILE : COLS_DEFAULT;
  const sorted = useMemo(() => sortStacks(stacks, gemOrder), [stacks, gemOrder]);
  const baseRows = Math.max(MIN_ROWS, Math.ceil(stacks.length / COLS));
  const rows = stacks.length > 0 && stacks.length % COLS === 0 ? baseRows + 1 : baseRows;
  const totalCells = rows * COLS;
  const emptyCount = totalCells - sorted.length;

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(${COLS}, 1fr)`,
        gap: '2px',
      }}
    >
      {sorted.map((stack) => (
        <InventoryTile
          key={stack.id}
          stack={stack}
          onTileClick={onTileClick}
          onEmptyClick={onEmptyClick}
        />
      ))}
      {Array.from({ length: emptyCount }, (_, i) => (
        <InventoryTile key={`empty-${i}`} stack={null} onTileClick={onTileClick} onEmptyClick={onEmptyClick} />
      ))}
    </Box>
  );
}
