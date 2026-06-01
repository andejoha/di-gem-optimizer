import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import TextButton from '../buttons/TextButton';

interface WelcomeDialogProps {
  open: boolean;
  onOpenTutorial: () => void;
  onClose: () => void;
}

export default function WelcomeDialog({ open, onOpenTutorial, onClose }: WelcomeDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth fullScreen={fullScreen}>
      <DialogContent
        sx={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center',
          gap: 2,
          px: 4,
          py: 4,
        }}
      >
        <Box component="img" src="/logo.png" sx={{ height: 200, width: 'auto' }} />
        <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
          Gem Optimizer
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Optimize your Diablo Immortal legendary gem setup. This tool is designed to maximize the
          gem power benefit from the awakening system. Configure your gear slots and inventory, then
          let the optimizer find the best gem arrangement for maximum gem power utilization.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'center', gap: 1, pt: 0, pb: 3 }}>
        <TextButton size="xs" variant="secondary" onClick={onClose}>
          Skip
        </TextButton>
        <TextButton size="xs" onClick={onOpenTutorial}>
          Tutorial
        </TextButton>
      </DialogActions>
    </Dialog>
  );
}
