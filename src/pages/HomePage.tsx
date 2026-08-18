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
import type { BonusMode, OptimizeRequest } from '../types/api';
import { BONUS_MODES } from '../core/models';
import TextButton from '../components/buttons/TextButton';
import IconButton from '../components/buttons/IconButton';
import SettingsPopover from '../components/toolbar/SettingsPopover';
import WelcomeDialog from '../components/tutorial/WelcomeDialog';
import TutorialDialog from '../components/tutorial/TutorialDialog';
import { LOGO_URL } from '../utils/publicAssets';
import ImportExportDialog from '../components/toolbar/ImportExportDialog';
import { allStacksToInventoryItems } from '../types/inventory';
import { dormantContribution } from '../utils/gemPowerCost';
import GearGrid from '../components/gear/GearGrid';
import InventorySection from '../components/inventory/InventorySection';
import { optimize, optimizeWithProgress } from '../services/gemApi';
import OptimizationProgress from '../components/progress/OptimizationProgress';
import type { ProgressEvent } from '../types/progress';
import { useGemData } from '../contexts/useGemData';
import { encodeSetup } from '../utils/setupCodec';
import type { CodecState } from '../utils/setupCodec';
import SetupTabs from '../components/tabs/SetupTabs';
import RenameTabDialog from '../components/tabs/RenameTabDialog';
import ImportTargetDialog from '../components/tabs/ImportTargetDialog';
import { useSetupTabs } from '../hooks/useSetupTabs';

const STORAGE_KEY = 'gem-optimizer:state';
const TUTORIAL_SEEN_KEY = 'gem-optimizer:tutorial-seen';

interface PersistedState {
  enableUpgrades: boolean;
  convert1Star: boolean;
  bonusMode?: BonusMode;
}

/** Guards against a missing (older-version) or corrupted persisted value reaching the optimizer. */
function sanitizeBonusMode(value: unknown): BonusMode {
  return BONUS_MODES.includes(value as BonusMode) ? (value as BonusMode) : 'off';
}

function loadState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}

export default function HomePage() {
  const navigate = useNavigate();
  const theme = useTheme();
  const isSmallScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const { gemById } = useGemData();
  const {
    tabs,
    activeTab,
    activeTabId,
    canAddTab,
    selectTab,
    addTab,
    renameTab,
    deleteTab,
    setGemSetup,
    setGemPower,
    setStacks,
    replaceActiveSetup,
  } = useSetupTabs();
  const { gemSetup, gemPower, stacks } = activeTab;
  const [welcomeOpen, setWelcomeOpen] = useState<boolean>(() => localStorage.getItem(TUTORIAL_SEEN_KEY) !== 'true');
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [enableUpgrades, setEnableUpgrades] = useState<boolean>(() => loadState()?.enableUpgrades ?? false);
  const [convert1Star, setConvert1Star] = useState<boolean>(() => loadState()?.convert1Star ?? false);
  const [bonusMode, setBonusMode] = useState<BonusMode>(() => sanitizeBonusMode(loadState()?.bonusMode));
  const [error, setError] = useState<string | null>(null);
  const [importExportMode, setImportExportMode] = useState<'import' | 'export' | null>(null);
  const [pendingImport, setPendingImport] = useState<CodecState | null>(null);

  const exportCode = useMemo(() => {
    if (importExportMode !== 'export') return '';
    return encodeSetup({ gemSetup, gemPower, stacks });
  }, [importExportMode, gemSetup, gemPower, stacks]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enableUpgrades, convert1Star, bonusMode }));
  }, [enableUpgrades, convert1Star, bonusMode]);

  const isEmpty = Object.values(gemSetup).every((v) => !v) && stacks.length === 0 && gemPower === 0;

  function handleWelcomeClose() {
    localStorage.setItem(TUTORIAL_SEEN_KEY, 'true');
    setWelcomeOpen(false);
  }

  function handleWelcomeOpenTutorial() {
    localStorage.setItem(TUTORIAL_SEEN_KEY, 'true');
    setWelcomeOpen(false);
    setTutorialOpen(true);
  }

  function handleConfirmDelete() {
    deleteTab(activeTabId);
    setDeleteOpen(false);
  }

  function handleImport(state: CodecState) {
    setPendingImport(state);
    setImportExportMode(null);
  }

  function handleOverwriteImport() {
    if (pendingImport) replaceActiveSetup(pendingImport);
    setPendingImport(null);
  }

  function handleCreateTabFromImport() {
    if (pendingImport) addTab(pendingImport);
    setPendingImport(null);
  }

  async function handleOptimize() {
    setOptimizing(true);
    setError(null);
    setProgress(null);
    try {
      // When upgrades are enabled, dormant gems are re-activated: they enter
      // the inventory as regular copies and their stored GP is spent back into
      // the pool (subtracted).  The pool may go negative if the player's raw
      // pool is smaller than the total dormant GP — the upgrade walk handles
      // this by finding upgrades that close the resulting gap.
      const dormantGP = stacks.reduce((sum, s) => sum + dormantContribution(s), 0);
      const request: OptimizeRequest = {
        gem_power: gemPower - dormantGP,
        gem_setup: gemSetup,
        inventory: allStacksToInventoryItems(stacks),
      };
      let optimizeResponse;
      try {
        optimizeResponse = await optimizeWithProgress(request, enableUpgrades, convert1Star, bonusMode, (evt) => setProgress(evt));
      } catch {
        // Fall back to running the optimizer on the main thread if the worker fails.
        setProgress(null);
        optimizeResponse = await optimize(request, enableUpgrades, convert1Star, bonusMode);
      }
      navigate('/results', { state: { optimizeResponse } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Optimization failed.');
      setOptimizing(false);
      setProgress(null);
    }
  }

  return (
    <Box sx={{ width: PAGE_MAX_WIDTH, maxWidth: '100%', mx: 'auto' }}>
      <Box
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          bgcolor: 'background.default',
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 1,
          py: 0.5,
          mb: 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box component="img" src={LOGO_URL} sx={{ height: 66, width: 'auto' }} />
          <Typography variant="h5" sx={{ fontWeight: 'bold', lineHeight: 1 }}>
            Mac's Gem Optimizer
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <IconButton size="xxs" variant="secondary" icon="question-mark" onClick={() => setTutorialOpen(true)} />
          <SettingsPopover
            enableUpgrades={enableUpgrades}
            onEnableUpgradesChange={() => setEnableUpgrades(!enableUpgrades)}
            convert1Star={convert1Star}
            onConvert1StarChange={() => setConvert1Star(!convert1Star)}
            bonusMode={bonusMode}
            onBonusModeChange={setBonusMode}
            disabled={optimizing}
            onImportClick={() => setImportExportMode('import')}
            onExportClick={() => setImportExportMode('export')}
          />
          <TextButton size={isSmallScreen ? 's' : 'm'} disabled={isEmpty || optimizing} onClick={handleOptimize}>
            {optimizing ? 'Optimizing…' : 'Optimize'}
          </TextButton>
        </Box>
      </Box>

      <SetupTabs
        tabs={tabs}
        activeTabId={activeTabId}
        canAddTab={canAddTab}
        onSelect={selectTab}
        onAdd={() => addTab()}
        onRenameClick={() => setRenameOpen(true)}
        onDeleteClick={() => setDeleteOpen(true)}
      />

      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 3 }}>
        <GearGrid gemSetup={gemSetup} onGemSetupChange={setGemSetup} />
        <InventorySection gemPower={gemPower} onGemPowerChange={setGemPower} stacks={stacks} onStacksChange={setStacks} />
      </Box>

      <WelcomeDialog open={welcomeOpen} onOpenTutorial={handleWelcomeOpenTutorial} onClose={handleWelcomeClose} />
      <TutorialDialog open={tutorialOpen} onClose={() => setTutorialOpen(false)} />

      <RenameTabDialog
        key={renameOpen ? activeTab.id : 'closed'}
        open={renameOpen}
        currentName={activeTab.name}
        onSave={(name) => {
          renameTab(activeTabId, name);
          setRenameOpen(false);
        }}
        onClose={() => setRenameOpen(false)}
      />

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{tabs.length === 1 ? 'Clear Tab' : 'Delete Tab'}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {tabs.length === 1
              ? 'This is your only tab, so it will be cleared: all gear slots and inventory will be reset.'
              : `Delete "${activeTab.name}"? Its gear and inventory will be permanently removed.`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <TextButton size="xs" variant="secondary" onClick={() => setDeleteOpen(false)}>
            Cancel
          </TextButton>
          <TextButton size="xs" onClick={handleConfirmDelete}>
            {tabs.length === 1 ? 'Clear' : 'Delete'}
          </TextButton>
        </DialogActions>
      </Dialog>

      {optimizing && <OptimizationProgress progress={progress} />}

      <ImportTargetDialog
        open={pendingImport !== null}
        currentTabName={activeTab.name}
        canCreateTab={canAddTab}
        onOverwrite={handleOverwriteImport}
        onCreateNew={handleCreateTabFromImport}
        onClose={() => setPendingImport(null)}
      />

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
