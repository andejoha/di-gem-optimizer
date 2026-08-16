import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { gemPowerIcon } from '../../utils/inventoryAssets';

interface GemPowerInputProps {
  value: number;
  onChange: (value: number) => void;
}

export default function GemPowerInput({ value, onChange }: GemPowerInputProps) {
  const [display, setDisplay] = useState(String(value));

  // Sync display when value is changed externally (e.g. Reset All)
  useEffect(() => {
    setDisplay(String(value));
  }, [value]);

  function handleBlur() {
    const parsed = Math.max(0, parseInt(display, 10) || 0);
    onChange(parsed);
    setDisplay(String(parsed));
  }

  return (
    <Stack direction="row" spacing={1.5} alignItems="center">
      <Box component="img" src={gemPowerIcon} sx={{ width: 66, height: 66, objectFit: 'contain', flexShrink: 0 }} />
      <TextField
        label="Gem Power"
        type="number"
        size="small"
        value={display}
        onChange={(e) => setDisplay(e.target.value)}
        onBlur={handleBlur}
        inputProps={{ min: 0 }}
        sx={{ width: 160 }}
      />
    </Stack>
  );
}
