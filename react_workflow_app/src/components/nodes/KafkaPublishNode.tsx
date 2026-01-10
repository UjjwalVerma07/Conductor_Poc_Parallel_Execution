import React, { memo, useState } from 'react';
// KafkaPublishNode: shared renderer for email/phone/enrichment service nodes. Only Email node is editable.
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
  Chip,
  Tooltip,
} from '@mui/material';
import { Send, Edit, Replay } from '@mui/icons-material';

function KafkaPublishNode({ data, id }: NodeProps) {
  const [open, setOpen] = useState(false);
  const [nodeData, setNodeData] = useState(data);
  // No JSON editing in POC; only Email node allows entering inputKey.

  const retry = (data as any)?.retry as
    | { retryUrl?: string; payload?: any }
    | undefined;
  const hasRetry = !!retry?.retryUrl && !!retry?.payload;

  // Derive topic from serviceName to keep UI static for POC
  // Note: sink is NOT shown for KAFKA_PUBLISH nodes - it belongs to EVENT wait nodes only
  const serviceName: string | undefined = data?.serviceName;
  const kebab = (s: string) => s.replace(/_/g, '-');
  const derivedTopic = serviceName
    ? (serviceName === 'finalize_pipeline' ? 'pipeline-completion' : `${kebab(serviceName)}-requests`)
    : data.topic;
  // Removed derivedSink - KAFKA_PUBLISH tasks should not have sink property

  const handleSave = () => {
    const newData = { ...nodeData };
    Object.assign(data, newData);
    setNodeData(newData);
    setOpen(false);
  };

  const handleRetry = async () => {
    if (!retry?.payload) return;
    try {
      const res=await fetch("http://localhost:8000/retry-workflow", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
           rerun_url: retry.retryUrl,
            payload: retry.payload
        }),
      });
      if (!res.ok){
       throw new Error(`HTTP ${res.status}`);
      }
      const data=await res.json()
      console.log('Retry Triggered : ',data)
    } catch (err) {
      console.error('Failed to retry Email Hygiene workflow from node:', err);
    }
  };

  const status =
    ((data as any)?.status as 'idle' | 'running' | 'success' | 'failed') || 'idle';

  const borderColor =
    status === 'failed'
      ? '#d32f2f'
      : status === 'success'
      ? '#2e7d32'
      : status === 'running'
      ? '#1976d2'
      : '#1976d2';

  const statusLabel =
    status === 'failed'
      ? 'Failed (retry available)'
      : status === 'success'
      ? 'Completed'
      : status === 'running'
      ? 'Running...'
      : 'Idle';

  return (
    <>
      <Card
        sx={{
          minWidth: 200,
          borderLeft: `4px solid ${borderColor}`,
        }}
      >
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
              <Send sx={{ color: '#1976d2', fontSize: 20 }} />
              <Box>
                <Typography variant="caption" color="text.secondary">
                  KAFKA_PUBLISH
                </Typography>
                <Typography variant="subtitle2">{data.label}</Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              {hasRetry && (
                <Tooltip title="Retry workflow from this task">
                  <IconButton size="small" onClick={handleRetry}>
                    <Replay fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {data.simpleInputMode && (
                <IconButton size="small" onClick={() => setOpen(true)}>
                  <Edit fontSize="small" />
                </IconButton>
              )}
            </Box>
          </Box>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 0.5 }}
          >
            Topic: {derivedTopic}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 0.25 }}
          >
            {serviceName || 'service'} · {statusLabel}
          </Typography>
          {/* Sink is not shown for KAFKA_PUBLISH nodes - it belongs to EVENT wait nodes */}
        </CardContent>
        <Handle type="source" position={Position.Right} style={{ width: 16, height: 16 }} />
      </Card>

      {/* Edit Dialog for the Email node only (simpleInputMode) */}
      {data.simpleInputMode && (
        <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>Email Validation Input</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                fullWidth
                label="Input file (MinIO key or filename)"
                value={nodeData.inputKey || ''}
                onChange={(e) => setNodeData({ ...nodeData, inputKey: e.target.value })}
                placeholder="customer_data_sample.csv or raw-data/2024/10/file.csv"
                helperText="Enter either full object key or just filename"
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
      )}
    </>
  );
}

export default memo(KafkaPublishNode);

