import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import type { RemainingInventoryItem } from '../../types/api';
import { remainingItemsToStacks } from '../../types/inventory';
import { useGemData } from '../../contexts/GemDataContext';
import InventoryGrid from '../inventory/InventoryGrid';

interface Props {
  items: RemainingInventoryItem[];
}

export default function RemainingInventory({ items }: Props) {
  const { gems } = useGemData();
  const gemOrder = new Map(gems.map((g, i) => [g.id, i]));

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
            stacks={remainingItemsToStacks(items)}
            gemOrder={gemOrder}
            onTileClick={() => {}}
            onEmptyClick={() => {}}
          />
        )}
      </CardContent>
    </Card>
  );
}
