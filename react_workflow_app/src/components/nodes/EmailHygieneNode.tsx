import React, { memo, useEffect, useMemo, useState } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow';
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
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Tabs,
  Tab,
  Checkbox,
  FormControlLabel,
  Divider,
  Paper,
  Tooltip,
} from '@mui/material';
import { Send, Edit, Download, Replay } from '@mui/icons-material';
import layoutsJson from '../../data/layouts.json';
import dpTemplates from '../../data/dpserviceTemplates.json';
import nlsDefaults from '../../data/dpservice_nls.json';
import {
  emailHygieneFieldTemplates,
  renderAssignmentsForFields,
  renderReportForFields,
} from '../../utils/dpserviceXmlHelpers';

function EmailHygieneNode({ id, data }: NodeProps) {
  const { setNodes } = useReactFlow();
  const [open, setOpen] = useState(false);
  const [nodeData, setNodeData] = useState({
    ...data,
  });
  const stats = (data as any)?.stats as
    | { taskId?: string; workflowId?: string; content?: string }
    | undefined;
  const hasStats = !!stats?.content;
  const retry = (data as any)?.retry as
    | { retryUrl?: string; payload?: any }
    | undefined;
  const hasRetry = !!retry?.retryUrl && !!retry?.payload;

  const status =
    ((data as any)?.status as 'idle' | 'running' | 'success' | 'failed') || 'idle';

  const borderColor =
    status === 'running'
      ? '#1976d2'
      : status === 'success'
      ? '#2e7d32'
      : status === 'failed'
      ? '#d32f2f'
      : '#bdbdbd';

  const statusLabel =
    status === 'running'
      ? 'Running...'
      : status === 'success'
      ? 'Completed'
      : status === 'failed'
      ? 'Failed (retry available)'
      : 'Idle';

  const handleDownloadStats = () => {
    if (!stats?.content) return;
    const fileName = `${stats.taskId || 'dp_email_hygiene_task'}_${
      stats.workflowId || 'workflow'
    }_stats.json`;
    try {
      const blob = new Blob([stats.content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      console.log(`💾 Downloaded Email Hygiene stats file: ${fileName}`);
    } catch (err) {
      console.error('Failed to download Email Hygiene stats file:', err);
    }
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

  // Layout selections and mapping state
  const layoutIds = useMemo(() => Object.keys(layoutsJson || {}), []);
  const [selectedLayoutId, setSelectedLayoutId] = useState<string>(data?.selectedLayoutId || '');
  const [activeTab, setActiveTab] = useState(0);
  const [generateReport, setGenerateReport] = useState<boolean>(!!data?.generateReport);
  // Map static "email" → selected input field name
  const [emailSourceField, setEmailSourceField] = useState<string>(data?.emailSourceField || 'EE_Email_Addr80');

  // Compute typedefs and fields from selected layout
  const typedefs = useMemo(() => {
    if (!selectedLayoutId) return [] as Array<any>;
    const layout = (layoutsJson as any)?.[selectedLayoutId];
    return (layout?.typedef || []) as Array<any>;
  }, [selectedLayoutId]);

  const dataIn = useMemo(() => typedefs.find(t => t.name === 'data_in'), [typedefs]);
  // Build append_out as: data_in fields + EH_* append fields from metadata template (minimal hard-coding)
  const appendOut = useMemo(() => {
    const baseAppend = typedefs.find((t) => t.name === 'append_out');
    if (!dataIn) return baseAppend;

    const tmpl = (dpTemplates as any)?.emailHygiene?.layoutToTemplate?.[selectedLayoutId];
    if (!tmpl) return baseAppend;

    const dataInRec = (dataIn.record || []) as Array<any>;
    const nonLfDataFields = dataInRec.filter((f: any) => f.name !== 'LF');
    const lfField =
      dataInRec.find((f: any) => f.name === 'LF') ||
      (baseAppend?.record || []).find((f: any) => f.name === 'LF');

    const appendAttrs = (tmpl.typedefFieldAttributes?.append_out || {}) as Record<string, any>;
    const dataNames = new Set(nonLfDataFields.map((f: any) => f.name));

    const appendedFields = Object.entries(appendAttrs)
      .filter(([name]) => !dataNames.has(name) && name !== 'LF')
      .map(([name, attrs]) => ({
        name,
        char_set: (attrs as any).char_set || 'ascii',
        fixed_length:
          (attrs as any).fixed_length ??
          (name === 'EH_EMAIL' ? 80 : name === 'EH_ACTION' ? 2 : name === 'EH_Code' ? 1 : 0),
      }));

    const record: any[] = [...nonLfDataFields, ...appendedFields];
    if (lfField) record.push(lfField);

    const totalLen = record.reduce((sum, f: any) => sum + (f.fixed_length || 0), 0);

    return {
      name: 'append_out',
      LRECL: baseAppend?.LRECL ?? totalLen,
      default_char_set: baseAppend?.default_char_set ?? 'ascii',
      record,
    };
  }, [typedefs, dataIn, selectedLayoutId]);

  // Compute start positions for record fields (1-based)
  const computeWithStarts = (rec: Array<any>) => {
    let start = 1;
    return rec.map((f) => {
      const out = { ...f, start };
      start += (f.fixed_length || 0);
      return out;
    });
  };
  const dataInFields = useMemo(() => {
    const fields = dataIn?.record ? computeWithStarts(dataIn.record) : [];
    // Only show fields without a default attribute
    return fields.filter((f: any) => typeof f.default === 'undefined');
  }, [dataIn]);
  const appendOutFields = useMemo(() => (appendOut?.record ? computeWithStarts(appendOut.record) : []), [appendOut]);

  useEffect(() => {
    // When layout changes, ensure emailSourceField is valid
    if (dataInFields.length > 0) {
      const exists = dataInFields.some((f: any) => f.name === emailSourceField);
      if (!exists) setEmailSourceField(dataInFields[0].name);
    }
    // Sync default LRECLs if not set
    setNodeData((nd: any) => ({
      ...nd,
      inputLRECL: nd.inputLRECL ?? dataIn?.LRECL ?? 406,
      outputLRECL: nd.outputLRECL ?? appendOut?.LRECL ?? 489,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayoutId, dataInFields.length]);

  const createTypedefXml = (typedef: any) => {
    if (!typedef) return '';
    const fields = computeWithStarts(typedef.record || []);
    const recordXml = fields.map((f: any) => {
      if (f.name === 'LF') {
        return (
          `\t\t\t\t<dps:field dps:name="LF">\n` +
          `\t\t\t\t\t<dps:string>\n` +
          `\t\t\t\t\t\t<dps:fixed_length>${f.fixed_length}</dps:fixed_length>\n` +
          `\t\t\t\t\t</dps:string>\n` +
          `\t\t\t\t\t<dps:default>\n` +
          `\t\t\t\t\t\t<dps:stringLiteral>\\n</dps:stringLiteral>\n` +
          `\t\t\t\t\t</dps:default>\n` +
          `\t\t\t\t</dps:field>`
        );
      }
      const tmplFieldAttrs = ((dpTemplates as any)?.emailHygiene?.layoutToTemplate?.[selectedLayoutId]?.typedefFieldAttributes?.[typedef.name] || {})[f.name] || {};
      const displayname = tmplFieldAttrs.displayname || f.name;
      const description = typeof tmplFieldAttrs.description === 'string' ? tmplFieldAttrs.description : f.name;
      const category_name = tmplFieldAttrs.category_name;
      const category_displayname = tmplFieldAttrs.category_displayname;
      const categoryAttrs = category_name && category_displayname
        ? ` dps:category_name="${category_name}" dps:category_displayname="${category_displayname}"`
        : '';
      return (
        `\t\t\t\t<dps:field dps:name="${f.name}" dps:displayname="${displayname}" dps:description="${description}"${categoryAttrs}>\n` +
        `\t\t\t\t\t<dps:string>\n` +
        (f.char_set ? `\t\t\t\t\t\t<dps:char_set>${f.char_set}</dps:char_set>\n` : '') +
        `\t\t\t\t\t\t<dps:fixed_length>${f.fixed_length}</dps:fixed_length>\n` +
        `\t\t\t\t\t</dps:string>\n` +
        `\t\t\t\t</dps:field>`
      );
    }).join('\n');
    return (
      `\t\t<dps:typedef dps:name="${typedef.name}">\n` +
      `\t\t\t<dps:record>\n${recordXml}\n\t\t\t</dps:record>\n` +
      `\t\t</dps:typedef>`
    );
  };

  const generateDpServicesXml = (): string => {
    const nls = (nlsDefaults as any)?.emailHygiene?.defaults || {};
    const serviceId = nls.serviceId || 'WBEmailHygiene';
    const inputUri = nodeData.inputUri || '/intstripe/abinitio/temp/1000876411.in';
    const outputUri = nodeData.outputUri || '/intstripe/abinitio/temp/1000876411.out';
    const reportUri = nodeData.outputUri ? nodeData.outputUri.replace(/\.out$/i, '.report.eh') : '/intstripe/abinitio/temp/1000876411.report.eh';
    const workflowName = nls.workflowName || 'EMailHygieneWorkflow';
    const workflowId = nls.workflowId || '699';
    const tmpl = (dpTemplates as any)?.emailHygiene?.layoutToTemplate?.[selectedLayoutId];
    const inTypedefXml = createTypedefXml(dataIn);
    const outTypedefXml = createTypedefXml(appendOut);
    const emailField = emailSourceField || 'EE_Email_Addr80';
    const reportXml = generateReport
      ? renderReportForFields(emailHygieneFieldTemplates, reportUri)
      : '';

    // Build <dps:metadata> from NLS defaults (values) + template metadata (structure like include / namespace)
    const metadataEnvs = [
      { name: 'AB_EBCDIC_PAGE', value: nls.abEBCDICPage },
      { name: 'ACTIVE_CONFIGURATION', value: nls.activeConfiguration },
      { name: 'WORKFLOW_NAME', value: nls.workflowName },
      { name: 'WORKFLOW_ID', value: nls.workflowId },
    ].filter((e) => e.value);

    const includeUri = nls.includeUri || tmpl?.metadata?.includeUri;

    const metadataXml =
      `\t<dps:metadata>\n` +
      metadataEnvs
        .map(
          (env) =>
            `\t\t<dps:environment dps:name="${env.name}">${env.value}</dps:environment>`
        )
        .join('\n') +
      (includeUri ? `\n\t\t<dps:include dps:uri="${includeUri}"/>\n` : '\n') +
      `${inTypedefXml}\n${outTypedefXml}\n` +
      `\t</dps:metadata>`;

    const emailFromFn = tmpl?.emailFromFunction;
    const emailFromXml =
      `\t\t<dps:email>\n` +
      `\t\t\t<dps:from>\n` +
      `\t\t\t\t<dps:function dps:name="${emailFromFn?.name || 're_replace'}">\n` +
      (emailFromFn?.parms || []).map((p: any) => {
        if (p.kind === 'field') {
          return `\t\t\t\t\t<dps:parm dps:name="${p.name}">\n\t\t\t\t\t\t<dps:field>input.${emailField}</dps:field>\n\t\t\t\t\t</dps:parm>`;
        }
        if (p.kind === 'stringLiteral') {
          return `\t\t\t\t\t<dps:parm dps:name="${p.name}">\n\t\t\t\t\t\t<dps:stringLiteral>${p.value}</dps:stringLiteral>\n\t\t\t\t\t</dps:parm>`;
        }
        return '';
      }).join('\n') +
      `\n\t\t\t\t</dps:function>\n` +
      `\t\t\t</dps:from>\n` +
      `\t\t</dps:email>`;

    const assignmentXml = renderAssignmentsForFields(emailHygieneFieldTemplates);

    const xml =
`<?xml version="1.0" encoding="utf-8" ?>
<dps:dpservices xmlns:dps="${tmpl?.metadata?.namespace || 'http://dpsapps.intra.infousa.com/dpservices'}">
${metadataXml}
\t<dps:emailHygiene dps:id="${serviceId}">
\t\t<dps:input>
\t\t\t<dps:uri>${inputUri}</dps:uri>
\t\t\t<dps:user_type>data_in</dps:user_type>
\t\t</dps:input>
${emailFromXml}
\t\t<dps:output>
\t\t\t<dps:uri>${outputUri}</dps:uri>
\t\t\t<dps:user_type>append_out</dps:user_type>
${assignmentXml}
\t\t</dps:output>
${reportXml}\t</dps:emailHygiene>
</dps:dpservices>`;

    // Compact formatting newlines/indentation between tags but preserve meaningful spaces.
    // Only collapse whitespace sequences that include a newline to avoid removing literal spaces.
    const compactXml = xml.replace(/>\s*\n\s*</g, '><').trim();
    return compactXml;
  };

  const handleSave = () => {
    const xml = generateDpServicesXml();
    const updatedData = {
      ...nodeData,
      dpserviceXml: xml,
      emailSourceField,
      selectedLayoutId,
      generateReport,
    };

    // Persist configuration + dp_config XML into ReactFlow node state
    setNodes((nodes) =>
      nodes.map((n) =>
        n.id === id
          ? {
              ...n,
              data: {
                ...n.data,
                ...updatedData,
              },
            }
          : n
      )
    );

    setOpen(false);
  };

  return (
    <>
      <Card
        sx={{
          minWidth: 240,
          borderLeft: `4px solid ${borderColor}`,
          position: 'relative',
          transition: 'box-shadow 0.2s, transform 0.2s',
          '&:hover': {
            boxShadow: 6,
            transform: 'translateY(-2px)',
          },
          '&:hover .dp-node-actions': {
            opacity: 1,
          },
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
              <Send sx={{ color: '#2e7d32', fontSize: 20 }} />
              <Box>
                <Typography variant="caption" color="text.secondary">
                  KAFKA_PUBLISH
                </Typography>
                <Typography variant="subtitle2">{data.label || 'DP Email Hygiene'}</Typography>
              </Box>
            </Box>
            <Box
              className="dp-node-actions"
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                opacity: 0,
                transition: 'opacity 0.2s',
              }}
            >
              {hasStats && (
                <Tooltip title="Download stats JSON">
                  <IconButton size="small" onClick={handleDownloadStats}>
                    <Download fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {hasRetry && (
                <Tooltip title="Retry workflow from this task">
                  <IconButton size="small" onClick={handleRetry}>
                    <Replay fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              <IconButton size="small" onClick={() => setOpen(true)}>
                <Edit fontSize="small" />
              </IconButton>
            </Box>
          </Box>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 0.5 }}
          >
            Topic: dpservices-requests
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 0.25 }}
          >
            dp_email_hygiene · {statusLabel}
          </Typography>
        </CardContent>
        <Handle type="source" position={Position.Right} style={{ width: 16, height: 16 }} />
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>DP Email Hygiene Configuration</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Stack direction="row" spacing={2}>
              <TextField
                fullWidth
                label="Input URI"
                value={nodeData.inputUri || ''}
                onChange={(e) => setNodeData({ ...nodeData, inputUri: e.target.value })}
                placeholder="s3://bucket/path/file.in"
                helperText="data_in source file"
              />
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField
                fullWidth
                label="Output URI"
                value={nodeData.outputUri || ''}
                onChange={(e) => setNodeData({ ...nodeData, outputUri: e.target.value })}
                placeholder="s3://bucket/path/file.out"
                helperText="append_out target file"
              />
            </Stack>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Checkbox
                checked={generateReport}
                onChange={(e) => setGenerateReport(e.target.checked)}
              />
              <Typography variant="body2">Generate report</Typography>
            </Box>

            <Divider sx={{ my: 1 }} />

            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Stack spacing={2}>
                  <FormControl fullWidth>
                    <InputLabel id="layout-id-label">Layout ID</InputLabel>
                    <Select
                      labelId="layout-id-label"
                      value={selectedLayoutId}
                      label="Layout ID"
                      onChange={(e) => setSelectedLayoutId(e.target.value as string)}
                    >
                      {layoutIds.map((id) => (
                        <MenuItem key={id} value={id}>
                          {id}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <Paper variant="outlined" sx={{ p: 1, maxHeight: 260, overflow: 'auto' }}>
                    <Typography variant="subtitle2" gutterBottom>
                      data_in fields
                    </Typography>
                    <Stack spacing={0.5}>
                      {dataInFields.map((f: any) => (
                        <Box
                          key={f.name}
                          sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, cursor: 'grab' }}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', f.name);
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                        >
                          <Box sx={{ minWidth: 120 }}>{f.name}</Box>
                          <Box sx={{ color: 'text.secondary' }}>
                            type: string, len: {f.fixed_length}, start: {f.start}
                          </Box>
                        </Box>
                      ))}
                    </Stack>
                  </Paper>
                </Stack>
              </Grid>

              <Grid item xs={12} md={6}>
                <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ mb: 1 }}>
                  <Tab label="Match key" />
                  <Tab label="Stats" />
                </Tabs>
                {activeTab === 0 && (
                  <Stack spacing={2}>
                    <Typography variant="body2">
                      Drag a field from the left and drop it onto <strong>email</strong> target.
                    </Typography>
                    <Box
                      sx={{
                        border: '2px dashed',
                        borderColor: 'divider',
                        borderRadius: 1,
                        p: 2,
                        textAlign: 'center',
                        bgcolor: 'background.default',
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const field = e.dataTransfer.getData('text/plain');
                        if (field) setEmailSourceField(field);
                      }}
                    >
                      <Typography variant="subtitle2">email</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {emailSourceField ? `mapped to: ${emailSourceField}` : 'drop a field here'}
                      </Typography>
                    </Box>
                  </Stack>
                )}
                {activeTab === 1 && (
                  <Stack spacing={2}>
                    <Typography variant="body2">
                      Latest stats received for this node (from MinIO via backend).
                    </Typography>
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 1,
                        maxHeight: 220,
                        overflow: 'auto',
                        bgcolor: 'grey.900',
                        color: 'grey.100',
                        fontFamily: 'monospace',
                        fontSize: 12,
                      }}
                    >
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                        {stats?.content || 'No stats received yet for this node.'}
                      </pre>
                    </Paper>
                    {hasStats && (
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<Download fontSize="small" />}
                        onClick={handleDownloadStats}
                        sx={{ alignSelf: 'flex-start' }}
                      >
                        Download stats JSON
                      </Button>
                    )}
                  </Stack>
                )}
              </Grid>
            </Grid>

            <Divider sx={{ my: 1 }} />

            <Typography variant="caption" color="text.secondary">
              XML will be generated and attached to dp_config on Save.
            </Typography>
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

export default memo(EmailHygieneNode);


