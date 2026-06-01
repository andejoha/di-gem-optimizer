import { useState, useRef } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import type { GemInfo } from '../../types/api';
import type { CodecState } from '../../utils/setupCodec';
import { decodeSetup } from '../../utils/setupCodec';
import TextButton from '../buttons/TextButton';

interface Props {
  open: boolean;
  mode: 'import' | 'export';
  exportCode: string;
  gemById: Map<number, GemInfo>;
  onImport: (state: CodecState) => void;
  onClose: () => void;
}

export default function ImportExportDialog({ open, mode, exportCode, gemById, onImport, onClose }: Props) {
  const [importText, setImportText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleCopy() {
    navigator.clipboard.writeText(exportCode).then(() => {
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleImport() {
    setError(null);
    try {
      const state = decodeSetup(importText.trim(), gemById);
      onImport(state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    }
  }

  function handleClose() {
    setImportText('');
    setError(null);
    setCopied(false);
    onClose();
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>{mode === 'export' ? 'Export Setup' : 'Import Setup'}</DialogTitle>
      <DialogContent>
        {mode === 'export' ? (
          <TextField
            value={exportCode}
            fullWidth
            multiline
            minRows={3}
            inputProps={{ readOnly: true, style: { fontFamily: 'monospace', fontSize: '0.75rem' } }}
            sx={{ mt: 1 }}
          />
        ) : (
          <Box sx={{ mt: 1 }}>
            <TextField
              value={importText}
              onChange={(e) => { setImportText(e.target.value); setError(null); }}
              fullWidth
              multiline
              minRows={3}
              placeholder="Paste import code here…"
              inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.75rem' } }}
            />
            {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ gap: 1, px: 3, pb: 2 }}>
        {mode === 'export' ? (
          <>
            <TextButton size="xs" variant="secondary" scale={0.7} onClick={handleClose}>Close</TextButton>
            <TextButton size="xs" scale={0.7} onClick={handleCopy}>{copied ? 'Copied!' : 'Copy'}</TextButton>
          </>
        ) : (
          <>
            <TextButton size="xs" variant="secondary" scale={0.7} onClick={handleClose}>Cancel</TextButton>
            <TextButton size="xs" scale={0.7} disabled={!importText.trim()} onClick={handleImport}>Import</TextButton>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
