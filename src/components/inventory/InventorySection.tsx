import { useCallback, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import IconButton from '../buttons/IconButton';
import { useGemData } from '../../contexts/useGemData';
import type { InventoryGemStack } from '../../types/inventory';
import { inventoryStackKey } from '../../types/inventory';
import { generateId } from '../../utils/setupCodec';
import { dormantContribution } from '../../utils/gemPowerCost';
import GemPowerInput from './GemPowerInput';
import InventoryGemDialog from './InventoryGemDialog';
import InventoryGrid from './InventoryGrid';

interface InventorySectionProps {
  gemPower: number;
  onGemPowerChange: (value: number) => void;
  stacks: InventoryGemStack[];
  onStacksChange: (stacks: InventoryGemStack[]) => void;
}

export default function InventorySection({ gemPower, onGemPowerChange, stacks, onStacksChange }: InventorySectionProps) {
  const { gems } = useGemData();
  const gemOrder = useMemo(() => new Map(gems.map((g, i) => [g.id, i])), [gems]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [gpAlert, setGpAlert] = useState<{ delta: number } | null>(null);

  const handleOpenAdd = useCallback(() => {
    setEditingId(null);
    setDialogOpen(true);
  }, []);

  const handleTileClick = useCallback((id: string) => {
    setEditingId(id);
    setDialogOpen(true);
  }, []);

  function handleClose() {
    setDialogOpen(false);
    setEditingId(null);
  }

  function handleSave(data: Omit<InventoryGemStack, 'id'>) {
    const key = inventoryStackKey(data);

    // GP delta applies only when editing an existing stack (not when adding a new gem).
    const prev = editingId ? (stacks.find((s) => s.id === editingId) ?? null) : null;
    const gpDelta = prev !== null ? dormantContribution(data) - dormantContribution(prev) : 0;

    if (editingId === null) {
      const existing = stacks.find((s) => inventoryStackKey(s) === key);
      if (existing) {
        onStacksChange(stacks.map((s) => (s.id === existing.id ? { ...s, quantity: s.quantity + data.quantity } : s)));
      } else {
        onStacksChange([...stacks, { ...data, id: generateId() }]);
      }
    } else {
      const collision = stacks.find((s) => s.id !== editingId && inventoryStackKey(s) === key);
      if (collision) {
        onStacksChange(
          stacks.filter((s) => s.id !== editingId).map((s) => (s.id === collision.id ? { ...s, quantity: s.quantity + data.quantity } : s)),
        );
      } else {
        onStacksChange(stacks.map((s) => (s.id === editingId ? { ...s, ...data } : s)));
      }
    }

    if (gpDelta !== 0) {
      onGemPowerChange(Math.max(0, gemPower + gpDelta));
      setGpAlert({ delta: gpDelta });
    }

    handleClose();
  }

  function handleRemove() {
    onStacksChange(stacks.filter((s) => s.id !== editingId));
    handleClose();
  }

  const currentStack = editingId ? (stacks.find((s) => s.id === editingId) ?? null) : null;

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <GemPowerInput value={gemPower} onChange={onGemPowerChange} />
        </Stack>
        <IconButton size="xxs" icon="plus" onClick={handleOpenAdd} />
      </Stack>
      <InventoryGrid stacks={stacks} gemOrder={gemOrder} onTileClick={handleTileClick} onEmptyClick={handleOpenAdd} />
      {dialogOpen && (
        <InventoryGemDialog
          key={editingId ?? 'new'}
          open
          currentStack={currentStack}
          gems={gems}
          gemPower={gemPower}
          onSave={handleSave}
          onRemove={handleRemove}
          onClose={handleClose}
        />
      )}
      <Snackbar
        open={gpAlert !== null}
        autoHideDuration={5000}
        onClose={() => setGpAlert(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="info" variant="filled" onClose={() => setGpAlert(null)} sx={{ width: '100%' }}>
          {gpAlert && gpAlert.delta > 0
            ? `Added ${gpAlert.delta} Gem Power to the pool.`
            : gpAlert
              ? `Removed ${-gpAlert.delta} Gem Power from the pool.`
              : ''}
        </Alert>
      </Snackbar>
    </Box>
  );
}
