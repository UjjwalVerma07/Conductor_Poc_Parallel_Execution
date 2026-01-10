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
  RadioGroup,
  Radio,
  Tooltip,
} from '@mui/material';
import { Send, Edit, Download, Replay } from '@mui/icons-material';
import layoutsJson from '../../data/layouts.json';
import dpTemplates from '../../data/dpserviceTemplates.json';
import nlsDefaults from '../../data/dpservice_nls.json';

function NameParseNode({ id, data }: NodeProps) {
  const { setNodes } = useReactFlow();
  const [open, setOpen] = useState(false);
  const [nodeData, setNodeData] = useState({
    ...data,
  });
  const stats = (data as any)?.stats as
    | { taskId?: string; workflowId?: string; content?: string }
    | undefined;
  const hasStats = !!stats?.content;

  const handleDownloadStats = () => {
    if (!stats?.content) return;
    const fileName = `${stats.taskId || 'dp_name_parse_task'}_${
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
      console.log(`💾 Download Name Parse stats file: ${fileName}`);
    } catch (err) {
      console.error('Failed to download Name Parse stats file:', err);
    }
  };
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

  const handleRetry = async () => {
    if (!retry?.retryUrl || !retry?.payload) return;
    try {
      await fetch(retry.retryUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(retry.payload),
      });
      console.log(
        `🔁 Retry triggered for ${retry.payload?.reRunFromTaskRefName || 'dp_name_parse'}`
      );
    } catch (err) {
      console.error('Failed to retry Name Parse workflow from node:', err);
    }
  };

  // Layout selections and mapping state
  const layoutIds = useMemo(() => Object.keys(layoutsJson || {}), []);
  // No default layout; user must choose explicitly
  const [selectedLayoutId, setSelectedLayoutId] = useState<string>(data?.selectedLayoutId || '');
  const [activeTab, setActiveTab] = useState(0);
  const [generateReport, setGenerateReport] = useState<boolean>(!!data?.generateReport);

  // Name mapping from layout → static "name" field
  const [nameSourceField, setNameSourceField] = useState<string>(data?.nameSourceField || 'name');

  // Name orientation and name type (single-choice)
  const [nameOrientation, setNameOrientation] = useState<'FNF' | 'LNF'>(data?.nameOrientation || 'FNF');
  const [nameType, setNameType] = useState<'B' | 'I' | 'M'>(data?.nameType || 'M');

  // Compute typedefs and fields from selected layout
  const typedefs = useMemo(() => {
    if (!selectedLayoutId) return [] as Array<any>;
    const layout = (layoutsJson as any)?.[selectedLayoutId];
    return (layout?.typedef || []) as Array<any>;
  }, [selectedLayoutId]);

  const dataIn = useMemo(() => typedefs.find((t) => t.name === 'data_in'), [typedefs]);

  // Build data_out as: data_in fields + NP_* fields from template metadata
  const dataOut = useMemo(() => {
    const baseOut = typedefs.find((t) => t.name === 'data_out');
    if (!dataIn) return baseOut;

    const tmpl = (dpTemplates as any)?.nameParse?.layoutToTemplate?.[selectedLayoutId];
    if (!tmpl) return baseOut;

    const baseRec = ((baseOut?.record || []) as Array<any>).length
      ? (baseOut!.record as Array<any>)
      : ((dataIn.record || []) as Array<any>);

    const nonLfBase = baseRec.filter((f: any) => f.name !== 'LF');
    const lfField = baseRec.find((f: any) => f.name === 'LF');

    const attrs = (tmpl.typedefFieldAttributes?.data_out || {}) as Record<string, any>;
    const baseNames = new Set(nonLfBase.map((f: any) => f.name));

    const appended = Object.entries(attrs)
      .filter(([name]) => !baseNames.has(name) && name !== 'LF')
      .map(([name, meta]) => ({
        name,
        char_set: (meta as any).char_set || 'ascii',
        fixed_length: (meta as any).fixed_length ?? 0,
        type: (meta as any).type || 'string',
        n_symbols: (meta as any).n_symbols,
      }));

    const record: any[] = [...nonLfBase, ...appended];
    if (lfField) record.push(lfField);

    return {
      name: 'data_out',
      LRECL: baseOut?.LRECL,
      default_char_set: baseOut?.default_char_set ?? 'ascii',
      record,
    };
  }, [typedefs, dataIn, selectedLayoutId]);

  // Compute start positions for record fields (1-based)
  const computeWithStarts = (rec: Array<any>) => {
    let start = 1;
    return rec.map((f) => {
      const out = { ...f, start };
      start += f.fixed_length || 0;
      return out;
    });
  };

  const dataInFields = useMemo(() => {
    const fields = dataIn?.record ? computeWithStarts(dataIn.record) : [];
    return fields.filter((f: any) => typeof f.default === 'undefined');
  }, [dataIn]);

  useEffect(() => {
    // When layout changes, ensure nameSourceField is valid
    if (dataInFields.length > 0) {
      const exists = dataInFields.some((f: any) => f.name === nameSourceField);
      if (!exists) setNameSourceField(dataInFields[0].name);
    }
    // Sync default LRECLs if not set
    setNodeData((nd: any) => ({
      ...nd,
      inputLRECL: nd.inputLRECL ?? dataIn?.LRECL,
      outputLRECL: nd.outputLRECL ?? dataOut?.LRECL,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayoutId, dataInFields.length]);

  const createTypedefXml = (typedef: any, typeName: 'data_in' | 'data_out') => {
    if (!typedef) return '';
    const tmplAttrsRoot =
      ((dpTemplates as any)?.nameParse?.layoutToTemplate?.[selectedLayoutId]?.typedefFieldAttributes?.[typeName] ||
        {}) as Record<string, any>;

    const fields = computeWithStarts(typedef.record || []);
    const recordXml = fields
      .map((f: any) => {
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
        const tmplFieldAttrs = tmplAttrsRoot[f.name] || {};
        const displayname = tmplFieldAttrs.displayname || f.name;
        const description =
          typeof tmplFieldAttrs.description === 'string' ? tmplFieldAttrs.description : f.name;
        const category_name = tmplFieldAttrs.category_name;
        const category_displayname = tmplFieldAttrs.category_displayname;
        const categoryAttrs =
          category_name && category_displayname
            ? ` dps:category_name="${category_name}" dps:category_displayname="${category_displayname}"`
            : '';

        const fieldType = tmplFieldAttrs.type || (typeof f.n_symbols === 'number' ? 'decimal' : 'string');
        const charSet = tmplFieldAttrs.char_set || f.char_set || 'ascii';

        if (fieldType === 'decimal') {
          const nSymbols = tmplFieldAttrs.n_symbols ?? f.n_symbols ?? 3;
          return (
            `\t\t\t\t<dps:field dps:name="${f.name}" dps:displayname="${displayname}" dps:description="${description}"${categoryAttrs}>\n` +
            `\t\t\t\t\t<dps:decimal>\n` +
            `\t\t\t\t\t\t<dps:char_set>${charSet}</dps:char_set>\n` +
            `\t\t\t\t\t\t<dps:n_symbols>${nSymbols}</dps:n_symbols>\n` +
            `\t\t\t\t\t</dps:decimal>\n` +
            `\t\t\t\t</dps:field>`
          );
        }

        const fixedLen = tmplFieldAttrs.fixed_length ?? f.fixed_length;
        return (
          `\t\t\t\t<dps:field dps:name="${f.name}" dps:displayname="${displayname}" dps:description="${description}"${categoryAttrs}>\n` +
          `\t\t\t\t\t<dps:string>\n` +
          `\t\t\t\t\t\t<dps:char_set>${charSet}</dps:char_set>\n` +
          `\t\t\t\t\t\t<dps:fixed_length>${fixedLen}</dps:fixed_length>\n` +
          `\t\t\t\t\t</dps:string>\n` +
          `\t\t\t\t</dps:field>`
        );
      })
      .join('\n');

    return (
      `\t\t<dps:typedef dps:name="${typedef.name}">\n` +
      `\t\t\t<dps:record>\n${recordXml}\n\t\t\t</dps:record>\n` +
      `\t\t</dps:typedef>`
    );
  };

  const generateDpServicesXml = (): string => {
    const nls = (nlsDefaults as any)?.nameParse?.defaults || {};
    const serviceId = nls.serviceId || 'WBNameParse';
    const inputUri = nodeData.inputUri || '/intstripe/abinitio/temp/1001302146.in';
    const outputUri = nodeData.outputUri || '/intstripe/abinitio/temp/1001302146.name.out';
    const reportUri =
      nodeData.reportUri || '/MAS02/eReports/counts/1001302146.counts.txt';

    const tmpl = (dpTemplates as any)?.nameParse?.layoutToTemplate?.[selectedLayoutId];

    const inTypedefXml = createTypedefXml(dataIn, 'data_in');
    const outTypedefXml = createTypedefXml(dataOut, 'data_out');

    const metadataEnvs = [
      { name: 'AB_EBCDIC_PAGE', value: nls.abEBCDICPage },
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

    // <dps:name> from template + selected nameSourceField
    const nameFn = tmpl?.nameFunction;
    const nameXml =
      `\t\t<dps:name>\n` +
      `\t\t\t<dps:from>\n` +
      `\t\t\t\t<dps:function dps:name="${nameFn?.name || 're_replace'}">\n` +
      (nameFn?.parms || []).map((p: any) => {
        if (p.kind === 'field') {
          return (
            `\t\t\t\t\t<dps:parm dps:name="${p.name}">\n` +
            `\t\t\t\t\t\t<dps:field>input.${nameSourceField}</dps:field>\n` +
            `\t\t\t\t\t</dps:parm>`
          );
        }
        if (p.kind === 'stringLiteral') {
          return (
            `\t\t\t\t\t<dps:parm dps:name="${p.name}">\n` +
            `\t\t\t\t\t\t<dps:stringLiteral>${p.value}</dps:stringLiteral>\n` +
            `\t\t\t\t\t</dps:parm>`
          );
        }
        return '';
      }).join('\n') +
      `\n\t\t\t\t</dps:function>\n` +
      `\t\t\t</dps:from>\n` +
      `\t\t</dps:name>`;

    // Assignments from template (preserve order and nested functions exactly as defined)
    const assignments = tmpl?.assignments || [];
    const assignmentDefault = tmpl?.assignmentDefault;

    const assignmentXml =
      `\t\t<dps:assignment>\n` +
      assignments
        .map((a: any) => {
          const from = a.from;
          if (!from) return '';

          if (from.kind === 'field') {
            return (
              `\t\t\t<dps:assign dps:name="${a.name}">\n` +
              `\t\t\t\t<dps:from>\n` +
              `\t\t\t\t\t<dps:field>${from.value}</dps:field>\n` +
              `\t\t\t\t</dps:from>\n` +
              `\t\t\t</dps:assign>`
            );
          }

          if (from.kind === 'function') {
            const fn = from.function;
            const parmsXml = (fn.parms || [])
              .map((p: any) => {
                if (p.kind === 'field') {
                  return (
                    `\t\t\t\t\t\t<dps:parm>\n` +
                    `\t\t\t\t\t\t\t<dps:field>${p.value}</dps:field>\n` +
                    `\t\t\t\t\t\t</dps:parm>`
                  );
                }
                if (p.kind === 'decimalLiteral') {
                  return (
                    `\t\t\t\t\t\t<dps:parm>\n` +
                    `\t\t\t\t\t\t\t<dps:decimalLiteral>${p.value}</dps:decimalLiteral>\n` +
                    `\t\t\t\t\t\t</dps:parm>`
                  );
                }
                if (p.kind === 'stringLiteral') {
                  return (
                    `\t\t\t\t\t\t<dps:parm>\n` +
                    `\t\t\t\t\t\t\t<dps:stringLiteral>${p.value}</dps:stringLiteral>\n` +
                    `\t\t\t\t\t\t</dps:parm>`
                  );
                }
                return '';
              })
              .join('\n');

            return (
              `\t\t\t<dps:assign dps:name="${a.name}">\n` +
              `\t\t\t\t<dps:from>\n` +
              `\t\t\t\t\t<dps:function dps:name="${fn.name}">\n` +
              `${parmsXml}\n` +
              `\t\t\t\t\t</dps:function>\n` +
              `\t\t\t\t</dps:from>\n` +
              `\t\t\t</dps:assign>`
            );
          }

          return '';
        })
        .join('\n') +
      (assignmentDefault
        ? `\n\t\t\t<dps:default>${assignmentDefault}</dps:default>\n`
        : '\n') +
      `\t\t</dps:assignment>`;

    // Report + report_assignment (preserve exact sequence and nested append_exists)
    const report = tmpl?.report;
    const reportXml =
      generateReport && report
        ? (() => {
            const fieldsXml = (report.fields || [])
              .map(
                (rf: any) =>
                  `\t\t\t<dps:field dps:name="${rf.name}">\n` +
                  `\t\t\t\t<dps:string>\n` +
                  (rf.char_set
                    ? `\t\t\t\t\t<dps:char_set>${rf.char_set}</dps:char_set>\n`
                    : '') +
                  (rf.delim ? `\t\t\t\t\t<dps:delim>${rf.delim}</dps:delim>\n` : '') +
                  `\t\t\t\t</dps:string>\n` +
                  `\t\t\t</dps:field>`
              )
              .join('\n');

            const reportAssignXml = (report.assign || [])
              .map((ra: any) => {
                const fn = ra.function;
                const parmsXml = (fn.parms || [])
                  .map((p: any) => {
                    if (p.kind === 'stringLiteral') {
                      return (
                        `\t\t\t\t\t<dps:parm>\n` +
                        `\t\t\t\t\t\t<dps:stringLiteral>${p.value}</dps:stringLiteral>\n` +
                        `\t\t\t\t\t</dps:parm>`
                      );
                    }
                    if (p.kind === 'field') {
                      return (
                        `\t\t\t\t\t<dps:parm>\n` +
                        `\t\t\t\t\t\t<dps:field>${p.value}</dps:field>\n` +
                        `\t\t\t\t\t</dps:parm>`
                      );
                    }
                    if (p.kind === 'function') {
                      const innerFn = p.function;
                      const innerParms = (innerFn.parms || [])
                        .map(
                          (ip: any) =>
                            `\t\t\t\t\t\t\t<dps:parm>\n` +
                            `\t\t\t\t\t\t\t\t<dps:field>${ip.value}</dps:field>\n` +
                            `\t\t\t\t\t\t\t</dps:parm>`
                        )
                        .join('\n');
                      return (
                        `\t\t\t\t\t<dps:parm>\n` +
                        `\t\t\t\t\t\t<dps:function dps:name="${innerFn.name}">\n` +
                        `${innerParms}\n` +
                        `\t\t\t\t\t\t</dps:function>\n` +
                        `\t\t\t\t\t</dps:parm>`
                      );
                    }
                    return '';
                  })
                  .join('\n');

                return (
                  `\t\t\t<dps:assign dps:name="${ra.name}">\n` +
                  `\t\t\t\t<dps:from>\n` +
                  `\t\t\t\t\t<dps:function dps:name="${fn.name}">\n` +
                  `${parmsXml}\n` +
                  `\t\t\t\t\t</dps:function>\n` +
                  `\t\t\t\t</dps:from>\n` +
                  `\t\t\t</dps:assign>`
                );
              })
              .join('\n');

            return (
              `\t\t<dps:report>\n` +
              `\t\t\t<dps:uri>${reportUri}</dps:uri>\n` +
              `\t\t\t<dps:record>\n${fieldsXml}\n\t\t\t</dps:record>\n` +
              `\t\t</dps:report>\n` +
              `\t\t<dps:report_assignment>\n${reportAssignXml}\n\t\t</dps:report_assignment>\n`
            );
          })()
        : '';

    const xml =
`<?xml version="1.0" encoding="utf-8"?>
<dps:dpservices xmlns:dps="${tmpl?.metadata?.namespace || 'http://dpsapps.intra.infousa.com/dpservices'}">
${metadataXml}
\t<dps:nameParse dps:id="${serviceId}">
\t\t<dps:input>
\t\t\t<dps:uri>${inputUri}</dps:uri>
\t\t\t<dps:user_type>data_in</dps:user_type>
\t\t</dps:input>
${nameXml}
\t\t<dps:nameOrder>${nameOrientation}</dps:nameOrder>
\t\t<dps:nameType>${nameType}</dps:nameType>
\t\t<dps:output>
\t\t\t<dps:uri>${outputUri}</dps:uri>
\t\t\t<dps:user_type>data_out</dps:user_type>
\t\t</dps:output>
${assignmentXml}
${reportXml}\t</dps:nameParse>
</dps:dpservices>`;

    // Compact formatting newlines/indentation between tags but preserve meaningful spaces inside text nodes.
    // Only collapse sequences that contain a newline to avoid stripping literal spaces like " " in stringLiteral.
    const compactXml = xml.replace(/>\s*\n\s*</g, '><').trim();
    return compactXml;
  };

  const handleSave = () => {
    const xml = generateDpServicesXml();
    const updatedData = {
      ...nodeData,
      dpserviceXml: xml,
      selectedLayoutId,
      generateReport,
      nameSourceField,
      nameOrientation,
      nameType,
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
              <Send sx={{ color: '#1976d2', fontSize: 20 }} />
              <Box>
                <Typography variant="caption" color="text.secondary">
                  DP NAME PARSE
                </Typography>
                <Typography variant="subtitle2">{data.label || 'DP Name Parse'}</Typography>
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
            dp_name_parse · {statusLabel}
          </Typography>
        </CardContent>
        <Handle type="source" position={Position.Right} style={{ width: 16, height: 16 }} />
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>DP Name Parse Configuration</DialogTitle>
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
                helperText="data_out target file"
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
                          sx={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: 12,
                            cursor: 'grab',
                          }}
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
                  <Tab label="Name mapping" />
                  <Tab label="Stats" />
                </Tabs>
                {activeTab === 0 && (
                  <Stack spacing={2}>
                    <Typography variant="body2">
                      Drag a field from the left and drop it onto <strong>name</strong> target.
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
                        if (field) setNameSourceField(field);
                      }}
                    >
                      <Typography variant="subtitle2">name</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {nameSourceField ? `mapped to: ${nameSourceField}` : 'drop a field here'}
                      </Typography>
                    </Box>

                    <Divider sx={{ my: 1 }} />

                    <Typography variant="subtitle2">Name Orientation</Typography>
                    <RadioGroup
                      row
                      value={nameOrientation}
                      onChange={(e) => setNameOrientation(e.target.value as 'FNF' | 'LNF')}
                    >
                      <FormControlLabel
                        value="FNF"
                        control={<Radio />}
                        label="First Name First"
                      />
                      <FormControlLabel
                        value="LNF"
                        control={<Radio />}
                        label="Last Name First"
                      />
                    </RadioGroup>

                    <Typography variant="subtitle2">Name Type</Typography>
                    <RadioGroup
                      row
                      value={nameType}
                      onChange={(e) => setNameType(e.target.value as 'B' | 'I' | 'M')}
                    >
                      <FormControlLabel value="B" control={<Radio />} label="Business" />
                      <FormControlLabel value="I" control={<Radio />} label="Individual" />
                      <FormControlLabel value="M" control={<Radio />} label="Mixed" />
                    </RadioGroup>
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

export default memo(NameParseNode);


