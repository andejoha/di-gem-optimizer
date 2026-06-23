import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import type { DormantGemItem, RemainingInventoryItem } from '../../types/api';
import { remainingItemsToStacks } from '../../types/inventory';
import { useGemData } from '../../contexts/GemDataContext';
import InventoryGrid from '../inventory/InventoryGrid';

interface Props {
  items: RemainingInventoryItem[];
  dormantGems?: DormantGemItem[];
}

export default function RemainingInventory({ items, dormantGems = [] }: Props) {
  const { gems } = useGemData();
  const gemOrder = new Map(gems.map((g, i) => [g.id, i]));

  // Build a set of "gem_id|rank|active_stars" keys for dormant gems so we can
  // mark matching stacks as dormant (renders greyscale in InventoryGrid).
  const dormantKeySet = new Set(
    dormantGems.map((d) => `${d.gem_id}|${d.rank}|${d.active_stars}`)
  );
  const stacks = remainingItemsToStacks(items).map((stack) => {
    const key = `${stack.gem_id}|${stack.rank}|${stack.active_stars}`;
    return dormantKeySet.has(key) ? { ...stack, dormant: true } : stack;
  });

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Remaining Inventory
        </Typography>
        {items.length === 0 ? (
          <Typography variant="body1" color="text.secondary">
            No remaining inventory — all gems were assigned.
          </Typography>
        ) : (
          <InventoryGrid
            stacks={stacks}
            gemOrder={gemOrder}
            onTileClick={() => {}}
            onEmptyClick={() => {}}
          />
        )}
      </CardContent>
    </Card>
  );
}
