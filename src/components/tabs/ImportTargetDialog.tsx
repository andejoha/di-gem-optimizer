import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { MAX_TABS } from '../../utils/setupTabs';
import TextButton from '../buttons/TextButton';

interface Props {
  open: boolean;
  currentTabName: string;
  canCreateTab: boolean;
  onOverwrite: () => void;
  onCreateNew: () => void;
  onClose: () => void;
}

export default function ImportTargetDialog({ open, currentTabName, canCreateTab, onOverwrite, onCreateNew, onClose }: Props) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Import Setup</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Overwrite the current tab (&ldquo;{currentTabName}&rdquo;) with the imported setup, or create a new tab for it?
          {!canCreateTab && ` The maximum of ${MAX_TABS} tabs has been reached, so a new tab can’t be created.`}
        </DialogContentText>
      </DialogContent>
      <DialogActions sx={{ gap: 1, px: 3, pb: 2, flexWrap: 'wrap' }}>
        <TextButton size="xs" variant="secondary" scale={0.7} onClick={onClose}>
          Cancel
        </TextButton>
        <TextButton size="xs" variant="secondary" scale={0.7} disabled={!canCreateTab} onClick={onCreateNew}>
          New tab
        </TextButton>
        <TextButton size="xs" scale={0.7} onClick={onOverwrite}>
          Overwrite
        </TextButton>
      </DialogActions>
    </Dialog>
  );
}
