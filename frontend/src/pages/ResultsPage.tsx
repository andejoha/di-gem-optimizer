import { useState, useMemo } from 'react';
import { PAGE_MAX_WIDTH } from '../theme';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import IconButton from '../components/buttons/IconButton';
import TextButton from '../components/buttons/TextButton';
import ImportExportDialog from '../components/toolbar/ImportExportDialog';
import type { GemSetup, OptimizeResponse } from '../types/api';
import { inventoryStackKey, remainingItemsToStacks } from '../types/inventory';
import type { InventoryGemStack } from '../types/inventory';
import { useGemData } from '../contexts/GemDataContext';
import type { CodecState } from '../utils/setupCodec';
import { encodeSetup } from '../utils/setupCodec';
import { SLOT_ORDER } from '../utils/gearAssets';
import SummaryCard from '../components/results/SummaryCard';
import UpgradesSection from '../components/results/UpgradesSection';
import GearSlotResult from '../components/results/GearSlotResult';
import RemainingInventory from '../components/results/RemainingInventory';
import ConvertedGemsSection from '../components/results/ConvertedGemsSection';
import DormantGemsSection from '../components/results/DormantGemsSection';

interface LocationState {
  optimizeResponse: OptimizeResponse;
}

function isValidState(state: unknown): state is LocationState {
  return (
    state !== null &&
    typeof state === 'object' &&
    'optimizeResponse' in (state as object)
  );
}

function buildResultCodecState(response: OptimizeResponse): CodecState {
  const { summary, gem_results, remaining_inventory, dormant_gems } = response;

  // Build gem setup from results
  const gemSetup: GemSetup = {};
  for (const slot of SLOT_ORDER) {
    const result = gem_results[slot];
    if (!result) continue;
    gemSetup[slot] = {
      gem_id: result.gem_id,
      target_rank: result.target_rank,
      active_stars: result.active_stars,
    };
  }

  // Build a set of dormant keys so we can mark remaining stacks as dormant.
  // Key: "gem_id|rank|active_stars" (without dormant flag) — matches the
  // identity used by DormantGemItem.
  const dormantKeySet = new Set(
    (dormant_gems ?? []).map((d) => `${d.gem_id}|${d.rank}|${d.active_stars}`)
  );

  // Merge remaining inventory and socketed gems into stacks.
  // Dormant gems are marked so the codec round-trips their GP contribution.
  const stackMap = new Map<string, InventoryGemStack>();
  for (const stack of remainingItemsToStacks(remaining_inventory)) {
    const isDormant = dormantKeySet.has(`${stack.gem_id}|${stack.rank}|${stack.active_stars}`);
    const dormantStack = isDormant ? { ...stack, dormant: true } : stack;
    stackMap.set(inventoryStackKey(dormantStack), dormantStack);
  }
  for (const slot of SLOT_ORDER) {
    const result = gem_results[slot];
    if (!result) continue;
    for (const socket of result.sockets) {
      if (
        socket.status !== 'assigned' ||
        socket.assigned_gem_id == null ||
        socket.assigned_gem_star_rating == null ||
        socket.assigned_gem_rank == null
      ) continue;

      const activeStars = socket.assigned_gem_active_stars ?? socket.assigned_gem_star_rating;
      const key = inventoryStackKey({
        gem_id: socket.assigned_gem_id,
        rank: socket.assigned_gem_rank,
        active_stars: activeStars,
      });
      const existing = stackMap.get(key);
      if (existing) {
        existing.quantity += 1;
      } else {
        stackMap.set(key, {
          id: key,
          gem_id: socket.assigned_gem_id,
          star_rating: socket.assigned_gem_star_rating as 1 | 2 | 5,
          rank: socket.assigned_gem_rank,
          active_stars: activeStars,
          quantity: 1,
        });
      }
    }
  }

  const upgradeCost = response.upgrades?.total_upgrade_cost ?? 0;
  // Dormant GP is already folded into summary.surplus_or_shortfall; add it back
  // to available_power so the exported pool matches what the input side expects
  // (dormant stacks are excluded from the optimize request but their GP is part
  // of the gem power input field).
  const gemPower = Math.max(0, summary.available_power - upgradeCost + (summary.dormant_gem_power ?? 0));

  return { gemSetup, gemPower, stacks: Array.from(stackMap.values()) };
}

export default function ResultsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { gemById } = useGemData();
  const [exportOpen, setExportOpen] = useState(false);

  if (!isValidState(location.state)) {
    return <Navigate to="/" replace />;
  }

  const { summary, gem_results, upgrades, remaining_inventory, converted_gems, dormant_gems } = location.state.optimizeResponse;

  const exportCode = useMemo(
    () => exportOpen ? encodeSetup(buildResultCodecState(location.state.optimizeResponse)) : '',
    [exportOpen, location.state.optimizeResponse],
  );

  return (
    <Box sx={{ width: PAGE_MAX_WIDTH, maxWidth: '100%', mx: 'auto' }}>
      {/* Mobile header */}
      <Box sx={{ display: { xs: 'flex', md: 'none' }, flexDirection: 'column', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box component="img" src="/logo.png" onClick={() => navigate('/')} sx={{ height: 66, width: 'auto', cursor: 'pointer' }} />
          <Typography variant="h5" sx={{ fontWeight: 'bold', lineHeight: 1 }}>Optimization Results</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <IconButton size="xxs" variant="secondary" icon="return" onClick={() => navigate('/')} />
          <TextButton size="s" variant="secondary" scale={0.7} onClick={() => setExportOpen(true)}>Export</TextButton>
        </Box>
      </Box>

      {/* Desktop header */}
      <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', justifyContent: 'space-between', gap: 1.5, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <IconButton size="xxs" variant="secondary" icon="return" onClick={() => navigate('/')} />
          <Typography variant="h5" sx={{ fontWeight: 'bold', lineHeight: 1 }}>Optimization Results</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <TextButton size="s" variant="secondary" scale={0.7} onClick={() => setExportOpen(true)}>Export</TextButton>
          <Box component="img" src="/logo.png" onClick={() => navigate('/')} sx={{ height: 66, width: 'auto', cursor: 'pointer' }} />
        </Box>
      </Box>
      <Stack spacing={3}>
        <SummaryCard summary={summary} />

        {converted_gems && converted_gems.length > 0 && (
          <ConvertedGemsSection convertedGems={converted_gems} />
        )}

        {dormant_gems && dormant_gems.some((d) => d.quantity > 0) && (
          <DormantGemsSection dormantGems={dormant_gems} />
        )}

        {upgrades && upgrades.upgrades_applied.length > 0 && (
          <UpgradesSection upgrades={upgrades} />
        )}

        <Box>
          <Typography variant="h6" gutterBottom>
            Gear Slots
          </Typography>
          <Stack spacing={2}>
            {SLOT_ORDER.map((slot) => {
              const result = gem_results[slot];
              if (!result) return null;
              return <GearSlotResult key={slot} slotName={slot} slotResult={result} />;
            })}
          </Stack>
        </Box>

        <RemainingInventory items={remaining_inventory} dormantGems={dormant_gems ?? []} />
      </Stack>

      <ImportExportDialog
        open={exportOpen}
        mode="export"
        exportCode={exportCode}
        gemById={gemById}
        onImport={() => {}}
        onClose={() => setExportOpen(false)}
      />
    </Box>
  );
}
