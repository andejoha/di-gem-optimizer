import { useCallback, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import IconButton from '../buttons/IconButton';
import { useGemData } from '../../contexts/GemDataContext';
import type { InventoryGemStack } from '../../types/inventory';
import { inventoryStackKey } from '../../types/inventory';
import { generateId } from '../../utils/setupCodec';
import GemPowerInput from './GemPowerInput';
import InventoryGemDialog from './InventoryGemDialog';
import InventoryGrid from './InventoryGrid';
import TelluricFragmentsInput from './TelluricFragmentsInput';

interface InventorySectionProps {
  gemPower: number;
  onGemPowerChange: (value: number) => void;
  showTelluricInput: boolean;
  telluricFragments: number;
  onTelluricFragmentsChange: (value: number) => void;
  stacks: InventoryGemStack[];
  onStacksChange: (stacks: InventoryGemStack[]) => void;
}

export default function InventorySection({
  gemPower,
  onGemPowerChange,
  showTelluricInput,
  telluricFragments,
  onTelluricFragmentsChange,
  stacks,
  onStacksChange,
}: InventorySectionProps) {
  const { gems } = useGemData();
  const gemOrder = useMemo(() => new Map(gems.map((g, i) => [g.id, i])), [gems]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

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

    if (editingId === null) {
      const existing = stacks.find((s) => inventoryStackKey(s) === key);
      if (existing) {
        onStacksChange(stacks.map((s) =>
          s.id === existing.id ? { ...s, quantity: s.quantity + data.quantity } : s
        ));
      } else {
        onStacksChange([...stacks, { ...data, id: generateId() }]);
      }
    } else {
      const collision = stacks.find((s) => s.id !== editingId && inventoryStackKey(s) === key);
      if (collision) {
        onStacksChange(
          stacks
            .filter((s) => s.id !== editingId)
            .map((s) => s.id === collision.id ? { ...s, quantity: s.quantity + data.quantity } : s)
        );
      } else {
        onStacksChange(stacks.map((s) => s.id === editingId ? { ...s, ...data } : s));
      }
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
          {showTelluricInput && (
            <TelluricFragmentsInput value={telluricFragments} onChange={onTelluricFragmentsChange} />
          )}
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
          onSave={handleSave}
          onRemove={handleRemove}
          onClose={handleClose}
        />
      )}
    </Box>
  );
}
