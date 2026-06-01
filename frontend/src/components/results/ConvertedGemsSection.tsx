import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import type { ConvertedGemItem } from '../../types/api';
import { useGemData } from '../../contexts/GemDataContext';
import { getGemImageUrl } from '../../utils/gearAssets';
import { gemPowerIcon } from '../../utils/inventoryAssets';
import arrowBackwardIcon from '../../assets/images/buttons/arrow-backward.png';
import starFilledIcon from '../../assets/images/buttons/star-filled.png';

interface Props {
  convertedGems: ConvertedGemItem[];
}

export default function ConvertedGemsSection({ convertedGems }: Props) {
  const { gemById } = useGemData();
  if (convertedGems.length === 0) return null;

  const totalGained = convertedGems.reduce((sum, item) => sum + item.gem_power_gained, 0);

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="h6">Converted R1</Typography>
            <Box component="img" src={starFilledIcon} sx={{ width: 18, height: 18 }} />
            <Typography variant="h6">Gems</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="body2" color="text.secondary">Total gained:</Typography>
            <Box component="img" src={gemPowerIcon} sx={{ width: 16, height: 16 }} />
            <Typography variant="body1" fontWeight={600} color="success.main">
              +{totalGained.toLocaleString()}
            </Typography>
          </Box>
        </Box>
        <Divider sx={{ mb: 2 }} />
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {convertedGems.map((item) => (
            <Box
              key={item.gem_id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                p: 1,
                borderRadius: 1,
                bgcolor: 'action.hover',
              }}
            >
              <Box component="img" src={getGemImageUrl(item.gem_id)} sx={{ width: 32, height: 32 }} />
              <Box>
                <Typography variant="body2">{gemById.get(item.gem_id)?.name ?? String(item.gem_id)}</Typography>
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
