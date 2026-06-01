import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { SocketResponse } from '../../types/api';
import { useGemData } from '../../contexts/GemDataContext';
import { getGemImageUrl, starFilled } from '../../utils/gearAssets';
import { formatRank } from '../../utils/rankUtils';
import checkCircleIcon from '../../assets/images/buttons/check-circle.png';
import closeCircleIcon from '../../assets/images/buttons/close-circle.png';
import lockedIcon from '../../assets/images/buttons/icons/locked.png';
import { gemPowerIcon } from '../../utils/inventoryAssets';
import resonanceIcon from '../../assets/images/resonance.png';

interface Props {
  socket: SocketResponse;
}

const ICON_SIZE = 28;

export default function SocketDetail({ socket }: Props) {
  const { gemById } = useGemData();
  const isLocked = socket.status === 'locked';
  const isEmpty = socket.status === 'empty';
  const assignedGemName = socket.assigned_gem_id != null ? (gemById.get(socket.assigned_gem_id)?.name ?? String(socket.assigned_gem_id)) : undefined;
  const bonusGemName = socket.bonus_gem_required_id != null ? (gemById.get(socket.bonus_gem_required_id)?.name ?? String(socket.bonus_gem_required_id)) : undefined;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        py: 0.75,
        px: 1,
        borderRadius: 1,
        bgcolor: isLocked ? 'action.disabledBackground' : 'action.hover',
        opacity: isLocked ? 0.5 : 1,
      }}
    >
      {/* Left column: socket label + stars (row 1), stats (row 2) */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, flexShrink: 0, minWidth: 150 }}>
        {/* Row 1: Socket label + star type */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
            Socket {socket.socket_index}
          </Typography>
          <Box sx={{ display: 'flex' }}>
            {Array.from({ length: socket.socket_star_type }).map((_, i) => (
              <Box key={i} component="img" src={starFilled} sx={{ width: 12, height: 12 }} />
            ))}
          </Box>
        </Box>

        {/* Row 2: Stats (assigned only) */}
        {socket.status === 'assigned' && socket.assigned_gem_id != null && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {/* Contribution */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
              <Box component="img" src={gemPowerIcon} sx={{ width: 16, height: 16 }} />
              <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', minWidth: '4ch' }}>{socket.contribution ?? 0}</Typography>
            </Box>

            {/* Socket resonance */}
            {socket.socket_resonance != null && socket.socket_resonance > 0 && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                <Box component="img" src={resonanceIcon} sx={{ width: 16, height: 16 }} />
                <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', minWidth: '3ch' }}>{socket.socket_resonance}</Typography>
              </Box>
            )}

            {/* Bonus indicator */}
            {socket.bonus_gem_required_id != null ? (
              <Tooltip title={`Bonus: ${bonusGemName}`}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Box
                    component="img"
                    src={socket.bonus_activated ? checkCircleIcon : closeCircleIcon}
                    sx={{ width: 18, height: 18 }}
                  />
                  <Box
                    component="img"
                    src={getGemImageUrl(socket.bonus_gem_required_id)}
                    sx={{ width: 20, height: 20 }}
                  />
                </Box>
              </Tooltip>
            ) : null}
          </Box>
        )}

        {/* Row 2: Bonus indicator for empty sockets */}
        {isEmpty && socket.bonus_gem_required_id != null && (
          <Tooltip title={`Bonus: ${bonusGemName}`}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box component="img" src={closeCircleIcon} sx={{ width: 18, height: 18 }} />
              <Box
                component="img"
                src={getGemImageUrl(socket.bonus_gem_required_id)}
                sx={{ width: 20, height: 20 }}
              />
            </Box>
          </Tooltip>
        )}
      </Box>

      {/* Right column: gem icon + name/rank (vertically centered) */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 0 }}>
        {/* Icon */}
        {isLocked && (
          <Box sx={{ width: ICON_SIZE, height: ICON_SIZE, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Box component="img" src={lockedIcon} sx={{ width: 24, height: 24 }} />
          </Box>
        )}
        {isEmpty && (
          <Box sx={{ width: ICON_SIZE, height: ICON_SIZE, flexShrink: 0, opacity: 0.3 }} />
        )}
        {socket.status === 'assigned' && socket.assigned_gem_id != null && (
          <Box component="img" src={getGemImageUrl(socket.assigned_gem_id)} sx={{ width: ICON_SIZE, height: ICON_SIZE, flexShrink: 0 }} />
        )}

        {/* Text */}
        {isLocked && (
          <Typography variant="body2" color="text.disabled">Locked</Typography>
        )}
        {isEmpty && (
          <Typography variant="body2" color="text.disabled">Empty</Typography>
        )}
        {socket.status === 'assigned' && socket.assigned_gem_id != null && (
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2">{assignedGemName}</Typography>
            {socket.assigned_gem_rank && socket.assigned_gem_star_rating != null && (
              <Typography variant="body2" color="text.secondary">
                {formatRank(socket.assigned_gem_rank, socket.assigned_gem_star_rating)}
              </Typography>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}
