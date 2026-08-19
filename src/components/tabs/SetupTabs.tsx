import { useState } from 'react';
import Box from '@mui/material/Box';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import type { SetupTab } from '../../utils/setupTabs';
import IconButton from '../buttons/IconButton';

interface Props {
  tabs: SetupTab[];
  activeTabId: string;
  canAddTab: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRenameClick: () => void;
  onDeleteClick: () => void;
}

export default function SetupTabs({ tabs, activeTabId, canAddTab, onSelect, onAdd, onRenameClick, onDeleteClick }: Props) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  function handleCaretClick(e: React.MouseEvent<HTMLElement>) {
    e.stopPropagation();
    setMenuAnchor(e.currentTarget);
  }

  function handleMenuClose() {
    setMenuAnchor(null);
  }

  function handleRename() {
    handleMenuClose();
    onRenameClick();
  }

  function handleDelete() {
    handleMenuClose();
    onDeleteClick();
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 1, mb: 1.5 }}>
      <Tabs
        value={activeTabId}
        onChange={(_, id: string) => onSelect(id)}
        sx={{
          minHeight: 36,
          '& .MuiTabs-flexContainer': { alignItems: 'stretch' },
          '& .MuiTabs-indicator': { height: 2, backgroundColor: 'rgb(250, 159, 131)' },
          '& .MuiTab-root': { color: 'rgba(255,255,255,0.75)' },
          '& .MuiTab-root.Mui-selected': { color: 'rgb(250, 159, 131)' },
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <Tab
              key={tab.id}
              value={tab.id}
              sx={{
                width: { xs: 61, sm: 135 },
                maxWidth: 'none',
                minHeight: 36,
                textTransform: 'none',
                px: 0.5,
                fontSize: '1rem',
              }}
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, maxWidth: '100%', minWidth: 0 }}>
                  <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                    {tab.name}
                  </Box>
                  {isActive && (
                    <Box
                      component="span"
                      onClick={handleCaretClick}
                      sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, cursor: 'pointer' }}
                    >
                      <KeyboardArrowDownIcon fontSize="small" />
                    </Box>
                  )}
                </Box>
              }
            />
          );
        })}
      </Tabs>
      <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        <IconButton size="xxs" variant="secondary" icon="plus" scale={0.6} disabled={!canAddTab} onClick={onAdd} />
      </Box>
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={handleMenuClose}>
        <MenuItem onClick={handleRename}>Rename</MenuItem>
        <MenuItem onClick={handleDelete}>{tabs.length === 1 ? 'Clear' : 'Delete'}</MenuItem>
      </Menu>
    </Box>
  );
}
