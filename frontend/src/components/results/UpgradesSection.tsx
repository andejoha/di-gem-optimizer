import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import type { UpgradesResponse } from '../../types/api';
import { getGemImageUrl } from '../../utils/gearAssets';
import { gemPowerIcon } from '../../utils/inventoryAssets';
import { formatRank } from '../../utils/rankUtils';
import arrowBackwardIcon from '../../assets/images/buttons/arrow-backward.png';

interface Props {
  upgrades: UpgradesResponse | null | undefined;
}

export default function UpgradesSection({ upgrades }: Props) {
  if (!upgrades || upgrades.upgrades_applied.length === 0) return null;

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Recommended Upgrades
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
          <Typography variant="body2" color="text.secondary">Without upgrades:</Typography>
          <Chip
            label={upgrades.baseline_summary.status === 'feasible' ? 'Feasible' : 'Shortfall'}
            color={upgrades.baseline_summary.status === 'feasible' ? 'success' : 'error'}
            size="small"
          />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box component="img" src={gemPowerIcon} sx={{ width: 16, height: 16 }} />
            <Typography
              variant="body2"
              fontWeight={600}
              color={upgrades.baseline_summary.surplus_or_shortfall >= 0 ? 'success.main' : 'error.main'}
            >
              {upgrades.baseline_summary.surplus_or_shortfall >= 0
                ? `+${upgrades.baseline_summary.surplus_or_shortfall.toLocaleString()}`
                : upgrades.baseline_summary.surplus_or_shortfall.toLocaleString()}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 3, mb: 2, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="body1" color="text.secondary">Upgrade cost:</Typography>
            <Box component="img" src={gemPowerIcon} sx={{ width: 16, height: 16 }} />
            <Typography variant="body1" fontWeight={600}>{upgrades.total_upgrade_cost.toLocaleString()}</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="body1" color="text.secondary">Residual:</Typography>
            <Typography variant="body1" sx={{ textDecoration: 'line-through' }} color="text.disabled">
              {upgrades.baseline_residual_cost.toLocaleString()}
            </Typography>
            <Box component="img" src={arrowBackwardIcon} sx={{ width: 14, height: 14, transform: 'scaleX(-1)', mx: '4px' }} />
            <Typography variant="body1" fontWeight={600}>{upgrades.upgraded_residual_cost.toLocaleString()}</Typography>
          </Box>
        </Box>
        <Divider sx={{ mb: 2 }} />
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {upgrades.upgrades_applied.map((item, i) => (
            <Box
              key={i}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                flexWrap: 'wrap',
                p: 1,
                borderRadius: 1,
                bgcolor: 'action.hover',
              }}
            >
              {/* Source gem */}
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
                <Box component="img" src={getGemImageUrl(item.gem_id)} sx={{ width: 36, height: 36 }} />
                <Typography variant="body2" color="text.secondary">{formatRank(item.current_rank, item.star_rating)}</Typography>
              </Box>

              {/* Cost / sacrifices */}
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
                {item.copies_sacrificed > 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                    <Box component="img" src={getGemImageUrl(item.gem_id)} sx={{ width: 18, height: 18, opacity: 0.7 }} />
                    <Typography variant="body2">×{item.copies_sacrificed}</Typography>
                  </Box>
                )}
                {item.gem_power_cost > 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                    <Box component="img" src={gemPowerIcon} sx={{ width: 16, height: 16 }} />
                    <Typography variant="body2">{item.gem_power_cost.toLocaleString()}</Typography>
                  </Box>
                )}
              </Box>

              <Box component="img" src={arrowBackwardIcon} sx={{ width: 18, height: 18, transform: 'scaleX(-1)' }} />

              {/* Result gem */}
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
                <Box component="img" src={getGemImageUrl(item.gem_id)} sx={{ width: 36, height: 36 }} />
                <Typography variant="body2" color="success.main" fontWeight={600}>{formatRank(item.target_rank, item.star_rating)}</Typography>
              </Box>

              {/* Net gain */}
              <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="body2" color="text.secondary">Net gain:</Typography>
                <Box component="img" src={gemPowerIcon} sx={{ width: 16, height: 16 }} />
                <Typography variant="body1" fontWeight={600} color={item.net_gain >= 0 ? 'success.main' : 'error.main'}>
                  {item.net_gain >= 0 ? `+${item.net_gain}` : item.net_gain}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      </CardContent>
    </Card>
  );
}
