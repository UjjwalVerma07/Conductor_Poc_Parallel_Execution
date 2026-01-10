import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Card, CardContent, Typography, Box } from '@mui/material';
import { HourglassEmpty } from '@mui/icons-material';

// EventWaitNode: simple display-only node representing an EVENT wait.
// The converter derives sink/name from upstream service automatically.
function EventWaitNode({ data }: NodeProps) {
  return (
    <Card sx={{ minWidth: 200, borderLeft: '4px solid #8e24aa' }}>
      <Handle type="target" position={Position.Left} style={{ width: 16, height: 16 }} />
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <HourglassEmpty sx={{ color: '#8e24aa', fontSize: 20 }} />
          <Box>
            <Typography variant="caption" color="text.secondary">
              EVENT (async)
            </Typography>
            <Typography variant="subtitle2">{data.label || 'Wait Event'}</Typography>
          </Box>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          Sink auto-derived from upstream service
        </Typography>
      </CardContent>
      <Handle type="source" position={Position.Right} style={{ width: 16, height: 16 }} />
    </Card>
  );
}

export default memo(EventWaitNode);


