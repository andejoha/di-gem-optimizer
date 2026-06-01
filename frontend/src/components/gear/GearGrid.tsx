import { useCallback, useState } from 'react';
import Box from '@mui/material/Box';
import type { GemSetup, GemSetupItem, SlotName } from '../../types/api';
import { useGemData } from '../../contexts/GemDataContext';
import { SLOT_ORDER } from '../../utils/gearAssets';
import GearCard from './GearCard';
import GearSlotDialog from './GearSlotDialog';

interface GearGridProps {
  gemSetup: GemSetup;
  onGemSetupChange: (setup: GemSetup) => void;
}

export default function GearGrid({ gemSetup, onGemSetupChange }: GearGridProps) {
  const { gems } = useGemData();
  const [activeSlot, setActiveSlot] = useState<SlotName | null>(null);

  const handleSlotClick = useCallback((slot: SlotName) => {
    setActiveSlot(slot);
  }, []);

  function handleSave(item: GemSetupItem) {
    onGemSetupChange({ ...gemSetup, [activeSlot!]: item });
    setActiveSlot(null);
  }

  function handleClear() {
    onGemSetupChange({ ...gemSetup, [activeSlot!]: null });
    setActiveSlot(null);
  }

  return (
    <Box sx={{ width: 'fit-content', mx: { xs: 'auto', md: 0 } }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 100px)',
          gap: 1.5,
        }}
      >
        {SLOT_ORDER.map((slotName) => (
          <GearCard
            key={slotName}
            slotName={slotName}
            gemSetupItem={gemSetup[slotName] ?? null}
            onSlotClick={handleSlotClick}
          />
        ))}
      </Box>

      {activeSlot !== null && (
        <GearSlotDialog
          key={activeSlot}
          open
          slotName={activeSlot}
          currentItem={gemSetup[activeSlot] ?? null}
          gems={gems}
          onSave={handleSave}
          onClear={handleClear}
          onClose={() => setActiveSlot(null)}
        />
      )}
    </Box>
  );
}
