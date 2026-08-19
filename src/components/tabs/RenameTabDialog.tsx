import { useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import { MAX_TAB_NAME_LENGTH } from '../../utils/setupTabs';
import TextButton from '../buttons/TextButton';

interface Props {
  open: boolean;
  currentName: string;
  onSave: (name: string) => void;
  onClose: () => void;
}

/** Edits `currentName` in a local text field seeded once on mount. The caller must remount
 *  this component (for example with a `key` tied to the open state) to reset the field when
 *  reopening it for a different tab. */
export default function RenameTabDialog({ open, currentName, onSave, onClose }: Props) {
  const [name, setName] = useState(currentName);

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && trimmed !== currentName;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (canSave) onSave(trimmed);
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>Rename Tab</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
            inputProps={{ maxLength: MAX_TAB_NAME_LENGTH }}
            helperText={`${name.length}/${MAX_TAB_NAME_LENGTH}`}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions sx={{ gap: 1, px: 3, pb: 2 }}>
          <TextButton size="xs" variant="secondary" scale={0.7} onClick={onClose}>
            Cancel
          </TextButton>
          <TextButton size="xs" scale={0.7} disabled={!canSave} onClick={() => onSave(trimmed)}>
            Save
          </TextButton>
        </DialogActions>
      </form>
    </Dialog>
  );
}
