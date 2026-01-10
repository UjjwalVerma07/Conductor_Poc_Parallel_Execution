import React from 'react';
import { Box, Card, CardContent, Typography, Stack } from '@mui/material';
import { Send, HourglassEmpty } from '@mui/icons-material';
// NodePalette: drag these service nodes onto the canvas.
// Add new services by appending to nodeDefinitions.

const nodeDefinitions = [
  {
    type: 'airflowTrigger',
    label: 'Airflow Trigger',
    icon: <Send />,
    description: 'Trigger an Airflow DAG',
    color: '#1976d2',
  },
  {
    type: 'emailValidation',
    label: 'Email Validation',
    icon: <Send />,
    description: 'Start pipeline: publish email validation request',
    color: '#1976d2',
  },
  {
    type: 'phoneValidation',
    label: 'Phone Validation',
    icon: <Send />,
    description: 'Publish phone validation request',
    color: '#1976d2',
  },
  {
    type: 'enrichment',
    label: 'Enrichment',
    icon: <Send />,
    description: 'Publish enrichment request',
    color: '#1976d2',
  },
  {
    type: 'dpEmailHygiene',
    label: 'DP Email Hygiene',
    icon: <Send />,
    description: 'Configure DP Services Email Hygiene',
    color: '#2e7d32',
  },
  {
    type: 'nameParse',
    label: 'DP Name Parse',
    icon: <Send />,
    description: 'Configure DP Services Name Parse',
    color: '#1976d2',
  },
  {
    type: 'finalizePipeline',
    label: 'Finalize Pipeline',
    icon: <Send />,
    description: 'Publish pipeline completion event',
    color: '#1976d2',
  },
  {
    type: 'waitForResult',
    label: 'Wait for Result (Backup)',
    icon: <HourglassEmpty />,
    description: 'Use for hybrid workflows to wait on a topic',
    color: '#dc004e',
  },
];

function NodePalette() {
  // Put the node type into the drag data so the canvas knows what to create
  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <Stack spacing={1}>
      {nodeDefinitions.map((node) => (
        <Card
          key={node.type}
          draggable
          onDragStart={(e) => onDragStart(e, node.type)}
          sx={{
            cursor: 'grab',
            '&:hover': {
              boxShadow: 6,
              transform: 'translateY(-2px)',
            },
            transition: 'all 0.2s',
            borderLeft: `4px solid ${node.color}`,
          }}
        >
          <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ color: node.color }}>{node.icon}</Box>
              <Box>
                <Typography variant="subtitle2">{node.label}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {node.description}
                </Typography>
              </Box>
            </Box>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}

export default NodePalette;




