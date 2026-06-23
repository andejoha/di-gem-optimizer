import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import type { SummaryResponse } from '../../types/api';
import { gemPowerIcon } from '../../utils/inventoryAssets';
import resonanceIcon from '../../assets/images/resonance.png';

interface Props {
  summary: SummaryResponse;
}

function IconValue({ icon, value, color }: { icon: string; value: number; color?: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Box component="img" src={icon} sx={{ width: 18, height: 18 }} />
      <Typography variant="body1" color={color ?? 'text.primary'} fontWeight={600}>
        {value.toLocaleString()}
      </Typography>
    </Box>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.5 }}>
      <Typography variant="body1" color="text.secondary" sx={{ mr: 2 }}>
        {label}
      </Typography>
      {children}
    </Box>
  );
}

export default function SummaryCard({ summary }: Props) {
  const surplus = summary.surplus_or_shortfall;

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Summary
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 0.5, columnGap: 2 }}>
          <Row label="Status">
            <Chip
              label={summary.status === 'feasible' ? 'Feasible' : 'Shortfall'}
              color={summary.status === 'feasible' ? 'success' : 'error'}
              size="small"
            />
          </Row>
          <Row label="Total Resonance">
            <IconValue icon={resonanceIcon} value={summary.total_resonance} />
          </Row>
          <Row label="Available Gem Power">
            <IconValue icon={gemPowerIcon} value={summary.available_power} />
          </Row>
          <Row label="Total Required Power">
            <IconValue icon={gemPowerIcon} value={summary.total_required_power} />
          </Row>
          <Row label="Total Socketed Power">
            <IconValue icon={gemPowerIcon} value={summary.total_socketed_power} />
          </Row>
          <Row label="Residual Cost">
            <IconValue icon={gemPowerIcon} value={summary.total_residual_cost} />
          </Row>
          {summary.dormant_gem_power > 0 && (
            <Row label="Dormant GP Recovered">
              <IconValue icon={gemPowerIcon} value={summary.dormant_gem_power} color="success.main" />
            </Row>
          )}
          <Row label={surplus >= 0 ? 'Surplus' : 'Shortfall'}>
            <IconValue
              icon={gemPowerIcon}
              value={Math.abs(surplus)}
              color={surplus >= 0 ? 'success.main' : 'error.main'}
            />
          </Row>
          <Row label="Skipped Slots">
            <Typography variant="body1">
              {summary.skipped_slots.length > 0 ? summary.skipped_slots.join(', ') : 'None'}
            </Typography>
          </Row>
        </Box>
      </CardContent>
    </Card>
  );
}
