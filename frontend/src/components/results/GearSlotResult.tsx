import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { SlotName, SlotResponse } from '../../types/api';
import { useGemData } from '../../contexts/GemDataContext';
import { getGearImageUrl, getGemImageUrl, SLOT_META, starFilled, starEmpty } from '../../utils/gearAssets';
import { gemPowerIcon } from '../../utils/inventoryAssets';
import resonanceIcon from '../../assets/images/resonance.png';
import SocketDetail from './SocketDetail';

interface Props {
  slotName: SlotName;
  slotResult: SlotResponse;
}

export default function GearSlotResult({ slotName, slotResult }: Props) {
  const { gemById } = useGemData();
  const meta = SLOT_META[slotName];
  const totalStars = slotResult.star_rating;
  const gemName = gemById.get(slotResult.gem_id)?.name ?? String(slotResult.gem_id);
  const activeStars = slotResult.active_stars;

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2 }}>
          {/* ── Left: slot info ── */}
          <Box sx={{ minWidth: 240, flexShrink: 0 }}>
            {/* Gear slot header */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
              <Box sx={{ position: 'relative', width: 48, flexShrink: 0 }}>
                <Box
                  component="img"
                  src={getGearImageUrl('gear-background.png')}
                  sx={{ display: 'block', width: '100%', height: 'auto' }}
                />
                <Box
                  component="img"
                  src={getGearImageUrl(meta.iconFile)}
                  sx={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: '75%',
                    height: '75%',
                    objectFit: 'contain',
                    opacity: 0.7,
                  }}
                />
              </Box>
              <Typography variant="subtitle1" color="text.secondary">
                {meta.label}
              </Typography>
            </Box>

            {/* Primary gem */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
              <Box component="img" src={getGemImageUrl(slotResult.gem_id)} sx={{ width: 40, height: 40 }} />
              <Box>
                <Typography variant="body1" fontWeight={600}>{gemName}</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                  {Array.from({ length: totalStars }).map((_, i) => (
                    <Box
                      key={i}
                      component="img"
                      src={i < activeStars ? starFilled : starEmpty}
                      sx={{ width: 14, height: 14 }}
                    />
                  ))}
                  <Typography variant="body2" color="text.secondary" sx={{ ml: 0.5 }}>
                    Rank {slotResult.target_rank}
                  </Typography>
                </Box>
              </Box>
            </Box>

            <Divider sx={{ mb: 1.5 }} />

            {/* Gem power math: required - socketed = residual */}
            <Box sx={{ mb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                <Box component="img" src={gemPowerIcon} sx={{ width: 18, height: 18 }} />
                <Typography variant="body1" fontWeight={600}>{slotResult.required_power.toLocaleString()}</Typography>
                <Typography variant="body1" color="text.secondary">−</Typography>
                <Typography variant="body1" color="text.secondary">{slotResult.total_socketed_power.toLocaleString()}</Typography>
                <Typography variant="body1" color="text.secondary">=</Typography>
                <Tooltip title="Residual: the gem power drawn from your pool after socketed gems offset the awakening cost">
                  <Typography
                    variant="body1"
                    fontWeight={600}
                    color={slotResult.residual_cost === 0 ? 'success.main' : 'warning.main'}
                    sx={{ cursor: 'help', textDecorationStyle: 'dotted', textDecorationLine: 'underline' }}
                  >
                    {slotResult.residual_cost.toLocaleString()}
                  </Typography>
                </Tooltip>
              </Box>
            </Box>

            {/* Resonance */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
              <Box component="img" src={resonanceIcon} sx={{ width: 18, height: 18 }} />
              <Typography variant="body1" fontWeight={600}>{slotResult.total_resonance}</Typography>
              <Typography variant="body2" color="text.secondary">
                ({slotResult.base_resonance} + {slotResult.socket_resonance_bonus})
              </Typography>
            </Box>

            {/* Bonuses */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Chip
                label={`${slotResult.bonuses_activated}/${slotResult.bonuses_possible} bonuses`}
                size="small"
                color={slotResult.bonuses_activated === slotResult.bonuses_possible ? 'success' : 'default'}
              />
            </Box>
          </Box>

          {/* ── Right: socket list ── */}
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              Socketed Gems ({slotResult.sockets_unlocked} sockets)
            </Typography>
            {slotResult.sockets.map((socket) => (
              <SocketDetail key={socket.socket_index} socket={socket} />
            ))}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
