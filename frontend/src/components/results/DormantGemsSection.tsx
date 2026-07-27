import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import type { DormantGemItem } from '../../types/api';
import { useGemData } from '../../contexts/GemDataContext';
import { getGemImageUrl } from '../../utils/gearAssets';
import { gemPowerIcon } from '../../utils/inventoryAssets';
import arrowBackwardIcon from '../../assets/images/buttons/arrow-backward.png';

interface Props {
  dormantGems: DormantGemItem[];
}

export default function DormantGemsSection({ dormantGems }: Props) {
  const { gemById } = useGemData();
  // Gems already dormant on input that are still unused are no-ops for the
  // player — only show entries that represent a new recommendation.
  const newlyDormant = dormantGems.filter((item) => item.quantity > 0);
  if (newlyDormant.length === 0) return null;

  const totalGained = newlyDormant.reduce((sum, item) => sum + item.gem_power_gained, 0);

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="h6">Dormant Gems</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="body2" color="text.secondary">Total recovered:</Typography>
            <Box component="img" src={gemPowerIcon} sx={{ width: 16, height: 16 }} />
            <Typography variant="body1" fontWeight={600} color="success.main">
              +{totalGained.toLocaleString()}
            </Typography>
          </Box>
        </Box>
        <Divider sx={{ mb: 2 }} />
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {newlyDormant.map((item) => (
            <Box
              key={`${item.gem_id}|${item.rank}|${item.active_stars}`}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                p: 1,
                borderRadius: 1,
                bgcolor: 'action.hover',
              }}
            >
              <Box
                component="img"
                src={getGemImageUrl(item.gem_id)}
                sx={{ width: 32, height: 32, filter: 'grayscale(1)' }}
              />
              <Box>
                <Typography variant="body2">{gemById.get(item.gem_id)?.name ?? String(item.gem_id)}</Typography>
                <Typography variant="caption" color="text.secondary">
                  Rank {item.rank}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography variant="body2" color="text.secondary">×{item.quantity}</Typography>
                  <Box component="img" src={arrowBackwardIcon} sx={{ width: 12, height: 12, transform: 'scaleX(-1)' }} />
                  <Box component="img" src={gemPowerIcon} sx={{ width: 14, height: 14 }} />
                  <Typography variant="body2" fontWeight={600} color="success.main">
                    +{item.gem_power_gained}
                  </Typography>
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      </CardContent>
    </Card>
  );
}
