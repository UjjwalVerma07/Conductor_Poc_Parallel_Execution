import React, { memo, useState } from 'react';
// WaitForResultNode: kept as backup for hybrid workflows; simple configurable dialog.
import { Handle, Position, NodeProps } from 'reactflow';
import {
  Card,
  CardContent,
  Typography,
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Stack,
  IconButton,
} from '@mui/material';
import { HourglassEmpty, Edit } from '@mui/icons-material';

function WaitForResultNode({ data }: NodeProps) {
  const [open, setOpen] = useState(false);
  const [nodeData, setNodeData] = useState(data);

  const handleSave = () => {
    Object.assign(data, nodeData);
    setOpen(false);
  };

  return (
    <>
      <Card sx={{ minWidth: 200, borderLeft: '4px solid #dc004e' }}>
        <Handle type="target" position={Position.Left} style={{ width: 16, height: 16 }} />
        <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <HourglassEmpty sx={{ color: '#dc004e', fontSize: 20 }} />
              <Box>
                <Typography variant="caption" color="text.secondary">
                  WAIT_FOR_RESULT
                </Typography>
                <Typography variant="subtitle2">{data.label}</Typography>
              </Box>
            </Box>
            <IconButton size="small" onClick={() => setOpen(true)}>
              <Edit fontSize="small" />
            </IconButton>
          </Box>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 0.5 }}
          >
            Topic: {data.topic}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Timeout: {data.timeout}s
          </Typography>
        </CardContent>
        <Handle type="source" position={Position.Right} style={{ width: 16, height: 16 }} />
      </Card>

      {/* Edit Dialog */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Wait For Result Node</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              fullWidth
              label="Task Name"
              value={nodeData.taskName || ''}
              onChange={(e) =>
                setNodeData({ ...nodeData, taskName: e.target.value })
              }
              helperText="Reference name used in output expressions (e.g., wait_email_validation)"
            />
            <TextField
              fullWidth
              label="Label"
              value={nodeData.label}
              onChange={(e) =>
                setNodeData({ ...nodeData, label: e.target.value })
              }
            />
            <TextField
              fullWidth
              label="Topic"
              value={nodeData.topic}
              onChange={(e) =>
                setNodeData({ ...nodeData, topic: e.target.value })
              }
              helperText="Kafka topic to listen for results"
            />
            <TextField
              fullWidth
              label="Timeout (seconds)"
              type="number"
              value={nodeData.timeout}
              onChange={(e) =>
                setNodeData({ ...nodeData, timeout: parseInt(e.target.value) })
              }
              helperText="Maximum time to wait for result"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSave} variant="contained">
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export default memo(WaitForResultNode);




