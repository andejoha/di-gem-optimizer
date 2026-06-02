import { useEffect, useMemo, useState } from 'react';
import { PAGE_MAX_WIDTH } from '../theme';
import { useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Snackbar from '@mui/material/Snackbar';
import Typography from '@mui/material/Typography';
import type { GemSetup, OptimizeRequest } from '../types/api';
import TextButton from '../components/buttons/TextButton';
import IconButton from '../components/buttons/IconButton';
import SettingsPopover from '../components/toolbar/SettingsPopover';
import WelcomeDialog from '../components/tutorial/WelcomeDialog';
import TutorialDialog from '../components/tutorial/TutorialDialog';
import ImportExportDialog from '../components/toolbar/ImportExportDialog';
import type { InventoryGemStack } from '../types/inventory';
import { stacksToInventoryItems } from '../types/inventory';
import GearGrid from '../components/gear/GearGrid';
import InventorySection from '../components/inventory/InventorySection';
import { optimize, optimizeWithProgress } from '../services/gemApi';
import OptimizationProgress from '../components/progress/OptimizationProgress';
import type { ProgressEvent } from '../types/progress';
import { useGemData } from '../contexts/GemDataContext';
import { encodeSetup } from '../utils/setupCodec';
import type { CodecState } from '../utils/setupCodec';

const STORAGE_KEY = 'gem-optimizer:state';
const TUTORIAL_SEEN_KEY = 'gem-optimizer:tutorial-seen';

interface PersistedState {
  gemSetup: GemSetup;
  gemPower: number;
  stacks: InventoryGemStack[];
  enableUpgrades: boolean;
  convert1Star: boolean;
}

function loadState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Discard old format that stored gem names instead of gem IDs
    const stacks = parsed.stacks as Array<Record<string, unknown>> | undefined;
    if (stacks && stacks.length > 0 && 'gem_name' in stacks[0]) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    const gemSetup = parsed.gemSetup as Record<string, unknown> | undefined;
    if (gemSetup) {
      const firstSlot = Object.values(gemSetup).find(Boolean) as Record<string, unknown> | undefined;
      if (firstSlot && 'gem_name' in firstSlot) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
    }
    return parsed as unknown as PersistedState;
  } catch {
    return null;
  }
}

export default function HomePage() {
  const navigate = useNavigate();
  const theme = useTheme();
  const isSmallScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const { gemById } = useGemData();
  const [gemSetup, setGemSetup] = useState<GemSetup>(() => loadState()?.gemSetup ?? {});
  const [gemPower, setGemPower] = useState<number>(() => loadState()?.gemPower ?? 0);
  const [stacks, setStacks] = useState<InventoryGemStack[]>(() => loadState()?.stacks ?? []);
  const [welcomeOpen, setWelcomeOpen] = useState<boolean>(
    () => localStorage.getItem(TUTORIAL_SEEN_KEY) !== 'true',
  );
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [enableUpgrades, setEnableUpgrades] = useState<boolean>(() => loadState()?.enableUpgrades ?? false);
  const [convert1Star, setConvert1Star] = useState<boolean>(() => loadState()?.convert1Star ?? false);
  const [error, setError] = useState<string | null>(null);
  const [importExportMode, setImportExportMode] = useState<'import' | 'export' | null>(null);

  const exportCode = useMemo(() => {
    if (importExportMode !== 'export') return '';
    return encodeSetup({ gemSetup, gemPower, stacks });
  }, [importExportMode, gemSetup, gemPower, stacks]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ gemSetup, gemPower, stacks, enableUpgrades, convert1Star }));
  }, [gemSetup, gemPower, stacks, enableUpgrades, convert1Star]);

  const isEmpty =
    Object.values(gemSetup).every((v) => !v) &&
    stacks.length === 0 &&
    gemPower === 0;

  function handleWelcomeClose() {
    localStorage.setItem(TUTORIAL_SEEN_KEY, 'true');
    setWelcomeOpen(false);
  }

  function handleWelcomeOpenTutorial() {
    localStorage.setItem(TUTORIAL_SEEN_KEY, 'true');
    setWelcomeOpen(false);
    setTutorialOpen(true);
  }

  function handleConfirmReset() {
    setGemSetup({});
    setGemPower(0);
    setStacks([]);
    setConfirmOpen(false);
  }

  function handleImport(state: CodecState) {
    setGemSetup(state.gemSetup);
    setGemPower(state.gemPower);
    setStacks(state.stacks);
    setImportExportMode(null);
  }

  async function handleOptimize() {
    setOptimizing(true);
    setError(null);
    setProgress(null);
    try {
      const request: OptimizeRequest = {
        gem_power: gemPower,
        gem_setup: gemSetup,
        inventory: stacksToInventoryItems(stacks),
      };
      let optimizeResponse;
      try {
        optimizeResponse = await optimizeWithProgress(
          request, enableUpgrades, convert1Star,
          (evt) => setProgress(evt),
        );
      } catch {
        // Fall back to plain POST if streaming fails.
        setProgress(null);
        optimizeResponse = await optimize(request, enableUpgrades, convert1Star);
      }
      navigate('/results', { state: { optimizeResponse } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Optimization failed. Is the backend running?');
      setOptimizing(false);
      setProgress(null);
    }
  }

  return (
    <Box sx={{ width: PAGE_MAX_WIDTH, maxWidth: '100%', mx: 'auto' }}>
      <Box sx={{ position: 'sticky', top: 0, zIndex: 10, bgcolor: 'background.default', display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: 'center', gap: 1, py: 0.5, mb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box component="img" src="/logo.png" sx={{ height: 66, width: 'auto' }} />
          <Typography variant="h5" sx={{ fontWeight: 'bold', lineHeight: 1 }}>Gem Optimizer</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <IconButton size="xxs" variant="secondary" icon="question-mark" onClick={() => setTutorialOpen(true)} />
        <SettingsPopover
          enableUpgrades={enableUpgrades}
          onEnableUpgradesChange={() => setEnableUpgrades(!enableUpgrades)}
          convert1Star={convert1Star}
          onConvert1StarChange={() => setConvert1Star(!convert1Star)}
          isEmpty={isEmpty}
          disabled={optimizing}
          onResetClick={() => setConfirmOpen(true)}
          onImportClick={() => setImportExportMode('import')}
          onExportClick={() => setImportExportMode('export')}
        />
        <TextButton size={isSmallScreen ? 's' : 'm'} disabled={isEmpty || optimizing} onClick={handleOptimize}>
          {optimizing ? 'Optimizing…' : 'Optimize'}
        </TextButton>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 3 }}>
        <GearGrid gemSetup={gemSetup} onGemSetupChange={setGemSetup} />
        <InventorySection
          gemPower={gemPower}
          onGemPowerChange={setGemPower}
          stacks={stacks}
          onStacksChange={setStacks}
        />
      </Box>

      <WelcomeDialog
        open={welcomeOpen}
        onOpenTutorial={handleWelcomeOpenTutorial}
        onClose={handleWelcomeClose}
      />
      <TutorialDialog open={tutorialOpen} onClose={() => setTutorialOpen(false)} />

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Reset All</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will clear all gear slots and inventory. Are you sure?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <TextButton size="xs" variant="secondary" onClick={() => setConfirmOpen(false)}>Cancel</TextButton>
          <TextButton size="xs" onClick={handleConfirmReset}>Reset</TextButton>
        </DialogActions>
      </Dialog>

      {optimizing && <OptimizationProgress progress={progress} />}

      <ImportExportDialog
        open={importExportMode !== null}
        mode={importExportMode ?? 'export'}
        exportCode={exportCode}
        gemById={gemById}
        onImport={handleImport}
        onClose={() => setImportExportMode(null)}
      />

      <Snackbar
        open={error !== null}
        autoHideDuration={6000}
        onClose={() => setError(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setError(null)} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </Box>
  );
}
