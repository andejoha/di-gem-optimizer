import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import type { ShopResponse } from '../../types/api';
import { getGemImageUrl } from '../../utils/gearAssets';
import { gemPowerIcon } from '../../utils/inventoryAssets';
import arrowBackwardIcon from '../../assets/images/buttons/arrow-backward.png';
import telluricFragmentsIcon from '../../assets/images/telluric-fragments.png';

interface Props {
  shop: ShopResponse | null | undefined;
}

function TfValue({ value }: { value: number }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Box component="img" src={telluricFragmentsIcon} sx={{ width: 16, height: 16 }} />
      <Typography variant="body2" fontWeight={600}>{value.toLocaleString()}</Typography>
    </Box>
  );
}

export default function ShopSection({ shop }: Props) {
  if (!shop || shop.purchases.length === 0) return null;

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Telluric Fragments Exchange
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
          <Typography variant="body2" color="text.secondary">Without purchases:</Typography>
          <Chip
            label={shop.baseline_summary.status === 'feasible' ? 'Feasible' : 'Shortfall'}
            color={shop.baseline_summary.status === 'feasible' ? 'success' : 'error'}
            size="small"
          />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box component="img" src={gemPowerIcon} sx={{ width: 16, height: 16 }} />
            <Typography
              variant="body2"
              fontWeight={600}
              color={shop.baseline_summary.surplus_or_shortfall >= 0 ? 'success.main' : 'error.main'}
            >
              {shop.baseline_summary.surplus_or_shortfall >= 0
                ? `+${shop.baseline_summary.surplus_or_shortfall.toLocaleString()}`
                : shop.baseline_summary.surplus_or_shortfall.toLocaleString()}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 3, mb: 2, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="body1" color="text.secondary">Total spent:</Typography>
            <TfValue value={shop.total_tf_spent} />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="body1" color="text.secondary">Remaining:</Typography>
            <TfValue value={shop.remaining_tf} />
          </Box>
        </Box>
        <Divider sx={{ mb: 2 }} />
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {shop.purchases.map((item, i) => (
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
              {/* TF cost */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <TfValue value={item.tf_cost} />
              </Box>

              <Box component="img" src={arrowBackwardIcon} sx={{ width: 18, height: 18, transform: 'scaleX(-1)' }} />

              {/* Purchased gem */}
              <Box component="img" src={getGemImageUrl(item.gem_id)} sx={{ width: 36, height: 36 }} />

              {/* Net surplus gain */}
              <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="body2" color="text.secondary">Surplus gain:</Typography>
                <Box component="img" src={gemPowerIcon} sx={{ width: 16, height: 16 }} />
                <Typography variant="body1" fontWeight={600} color="success.main">
                  +{item.surplus_improvement}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      </CardContent>
    </Card>
  );
}
