// Shared helpers for building dpservice XML fragments (assignments, reports)
// from small, declarative field templates. Initially used for Email Hygiene.

export type DpsExpr =
  | { kind: 'field'; value: string }
  | { kind: 'stringLiteral'; value: string }
  | { kind: 'decimalLiteral'; value: number }
  | { kind: 'expression'; value: string }
  | { kind: 'function'; name: string; parms: DpsExpr[] };

export interface ReportTemplate {
  /** Name of the field in the <dps:report> record (e.g. EH_Action) */
  fieldName?: string;
  /** Delimiter in <dps:delim>, usually "\n" */
  delim?: string;
  /** Expression used in <dps:report_assignment> (inside <dps:function>) */
  aggregation: DpsExpr;
}

export interface FieldTemplate {
  /** Append / data_out field name (e.g. EH_EMAIL, EH_ACTION, NP_Family_Score) */
  name: string;
  type: 'string' | 'decimal';
  length?: number;
  n_symbols?: number;
  /** How to populate output.<name> */
  assignment: DpsExpr;
  /** Optional report behaviour for this field */
  report?: ReportTemplate;
}

// ---------------------------------------------------------------------------
// Documentation / readability constants (not used in rendering code)
// ---------------------------------------------------------------------------

/** Email Hygiene append/output field names, for quick reference */
export const EMAIL_HYGIENE_FIELDS_DOC = ['EH_EMAIL', 'EH_ACTION', 'EH_Code'] as const;

/** Name Parse NP_* output field names, for quick reference */
export const NAME_PARSE_FIELDS_DOC = [
  'NP_Family_Score',
  'NP_Family_Name',
  'NP_Family_Extra',
  'NP_Person1_Score',
  'NP_Person1_Edited_Name',
  'NP_Person1_Salutation',
  'NP_Person1_First_Name',
  'NP_Person1_Middle_Name',
  'NP_Person1_Nick_Name',
  'NP_Person1_Last_Name',
  'NP_Person1_Maturity_Title',
  'NP_Person1_Title',
  'NP_Person1_Gender',
  'NP_Person1_Extra',
  'NP_Person2_Score',
  'NP_Person2_Edited_Name',
  'NP_Person2_Salutation',
  'NP_Person2_First_Name',
  'NP_Person2_Middle_Name',
  'NP_Person2_Nick_Name',
  'NP_Person2_Last_Name',
  'NP_Person2_Maturity_Title',
  'NP_Person2_Title',
  'NP_Person2_Gender',
  'NP_Person2_Extra',
  'NP_Business_Score',
  'NP_Business_Name',
] as const;

// Email Hygiene: three appended fields with optional reporting on Action/Code.
export const emailHygieneFieldTemplates: FieldTemplate[] = [
  {
    name: 'EH_EMAIL',
    type: 'string',
    length: 80,
    assignment: { kind: 'field', value: 'details.eh_email' },
  },
  {
    name: 'EH_ACTION',
    type: 'string',
    length: 2,
    assignment: { kind: 'field', value: 'details.eh_action' },
    report: {
      fieldName: 'EH_Action',
      // literal "\n" so that downstream sees backslash-n, not an actual newline char
      delim: '\\n',
      aggregation: {
        kind: 'function',
        name: 'string_concat',
        parms: [
          { kind: 'stringLiteral', value: 'ALL' },
          { kind: 'stringLiteral', value: '|' },
          { kind: 'expression', value: 'details.eh_action' },
        ],
      },
    },
  },
  {
    name: 'EH_Code',
    type: 'string',
    length: 1,
    assignment: { kind: 'field', value: 'details.eh_code' },
    report: {
      fieldName: 'EH_Code',
      // literal "\n" so that downstream sees backslash-n, not an actual newline char
      delim: '\\n',
      aggregation: {
        kind: 'function',
        name: 'string_concat',
        parms: [
          { kind: 'stringLiteral', value: 'ALL' },
          { kind: 'stringLiteral', value: '|' },
          { kind: 'expression', value: 'details.eh_code' },
        ],
      },
    },
  },
];

// --- Rendering helpers ----------------------------------------------------

// Generic mappers from dpserviceTemplates.json structures → DpsExpr/FieldTemplate

function exprFromTemplateParm(p: any): DpsExpr {
  if (!p) return { kind: 'stringLiteral', value: '' };
  switch (p.kind) {
    case 'field':
      return { kind: 'field', value: p.value };
    case 'stringLiteral':
      return { kind: 'stringLiteral', value: p.value };
    case 'decimalLiteral':
      return { kind: 'decimalLiteral', value: p.value };
    case 'expression':
      return { kind: 'expression', value: p.value };
    case 'function': {
      const fn = p.function || {};
      const parms: DpsExpr[] = (fn.parms || []).map(exprFromTemplateParm);
      return { kind: 'function', name: fn.name || 'fn', parms };
    }
    default:
      return { kind: 'stringLiteral', value: '' };
  }
}

/** Build FieldTemplate[] from a dpserviceTemplates.json entry (assignments + report) */
export function buildFieldTemplatesFromTemplate(tmpl: any): FieldTemplate[] {
  if (!tmpl) return [];

  const fieldsByName = new Map<string, FieldTemplate>();

  // From assignments: output.<FieldName>
  (tmpl.assignments || []).forEach((a: any) => {
    const fullName: string = a.name || '';
    const fieldName = fullName.startsWith('output.')
      ? fullName.substring('output.'.length)
      : fullName;
    const from = a.from;
    if (!from) return;

    let assignment: DpsExpr;
    if (from.kind === 'field') {
      assignment = { kind: 'field', value: from.value };
    } else if (from.kind === 'function') {
      assignment = {
        kind: 'function',
        name: from.function?.name || 'fn',
        parms: (from.function?.parms || []).map(exprFromTemplateParm),
      };
    } else {
      assignment = { kind: 'stringLiteral', value: '' };
    }

    const existing = fieldsByName.get(fieldName);
    fieldsByName.set(fieldName, {
      name: fieldName,
      type: existing?.type || 'string',
      length: existing?.length,
      n_symbols: existing?.n_symbols,
      assignment,
      report: existing?.report,
    });
  });

  // From report.fields + report.assign: report.<FieldName>
  const reportFieldsByName = new Map<string, { delim?: string }>();
  (tmpl.report?.fields || []).forEach((rf: any) => {
    if (!rf?.name) return;
    reportFieldsByName.set(rf.name, { delim: rf.delim });
  });

  (tmpl.report?.assign || []).forEach((ra: any) => {
    const fullName: string = ra.name || '';
    const reportFieldName = fullName.startsWith('report.')
      ? fullName.substring('report.'.length)
      : fullName;
    const fn = ra.function;
    if (!fn) return;
    const agg: DpsExpr = {
      kind: 'function',
      name: fn.name || 'fn',
      parms: (fn.parms || []).map(exprFromTemplateParm),
    };
    const info = reportFieldsByName.get(reportFieldName) || {};

    const existing = fieldsByName.get(reportFieldName);
    if (existing) {
      existing.report = {
        fieldName: reportFieldName,
        delim: info.delim,
        aggregation: agg,
      };
      fieldsByName.set(reportFieldName, existing);
    } else {
      fieldsByName.set(reportFieldName, {
        name: reportFieldName,
        type: 'string',
        assignment: { kind: 'stringLiteral', value: '' },
        report: {
          fieldName: reportFieldName,
          delim: info.delim,
          aggregation: agg,
        },
      });
    }
  });

  return Array.from(fieldsByName.values());
}

function renderExprAsParmContent(expr: DpsExpr): string {
  switch (expr.kind) {
    case 'field':
      return `<dps:field>${expr.value}</dps:field>`;
    case 'stringLiteral':
      return `<dps:stringLiteral>${expr.value}</dps:stringLiteral>`;
    case 'decimalLiteral':
      return `<dps:decimalLiteral>${expr.value}</dps:decimalLiteral>`;
    case 'expression':
      return `<dps:expression>${expr.value}</dps:expression>`;
    case 'function': {
      const innerParms = (expr.parms || [])
        .map(
          (p) =>
            `<dps:parm>\n${renderExprAsParmContent(p)}\n</dps:parm>`
        )
        .join('\n');
      return `<dps:function dps:name="${expr.name}">\n${innerParms}\n</dps:function>`;
    }
    default:
      return '';
  }
}

/** Renders <dps:assignment> block for all fields (output.*) */
export function renderAssignmentsForFields(templates: FieldTemplate[]): string {
  const assigns = templates
    .map((tpl) => {
      const name = `output.${tpl.name}`;
      const fromExpr = tpl.assignment;

      if (!fromExpr) return '';

      // Simple field assignment
      if (fromExpr.kind !== 'function') {
        return (
          `\t\t\t<dps:assign dps:name="${name}">\n` +
          `\t\t\t\t<dps:from>\n` +
          `\t\t\t\t\t${renderExprAsParmContent(fromExpr)}\n` +
          `\t\t\t\t</dps:from>\n` +
          `\t\t\t</dps:assign>`
        );
      }

      // Function-based assignment
      const fnXml = renderExprAsParmContent(fromExpr); // returns <dps:function>...</dps:function>
      return (
        `\t\t\t<dps:assign dps:name="${name}">\n` +
        `\t\t\t\t<dps:from>\n` +
        `\t\t\t\t\t${fnXml}\n` +
        `\t\t\t\t</dps:from>\n` +
        `\t\t\t</dps:assign>`
      );
    })
    .filter(Boolean)
    .join('\n');

  return `\t\t\t<dps:assignment>\n${assigns}\n\t\t\t</dps:assignment>`;
}

/** Renders <dps:report> + <dps:report_assignment> blocks for fields that have report configs */
export function renderReportForFields(
  templates: FieldTemplate[],
  reportUri: string
): string {
  const reportable = templates.filter((t) => t.report);
  if (reportable.length === 0) return '';

  const fieldsXml = reportable
    .map((tpl) => {
      const r = tpl.report!;
      const fieldName = r.fieldName || tpl.name;
      const delim = r.delim ?? '\\n';
      return (
        `\t\t\t\t<dps:field dps:name="${fieldName}">\n` +
        `\t\t\t\t\t<dps:string>\n` +
        `\t\t\t\t\t\t<dps:char_set>ascii</dps:char_set>\n` +
        `\t\t\t\t\t\t<dps:delim>${delim}</dps:delim>\n` +
        `\t\t\t\t\t</dps:string>\n` +
        `\t\t\t\t</dps:field>`
      );
    })
    .join('\n');

  const assignXml = reportable
    .map((tpl) => {
      const r = tpl.report!;
      const reportName = r.fieldName || tpl.name;
      const agg = r.aggregation;

      const fnXml =
        agg.kind === 'function'
          ? renderExprAsParmContent(agg)
          : renderExprAsParmContent({
              kind: 'function',
              name: 'identity',
              parms: [agg],
            });

      return (
        `\t\t\t<dps:assign dps:name="report.${reportName}">\n` +
        `\t\t\t\t<dps:from>\n` +
        `\t\t\t\t\t${fnXml}\n` +
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
    `\t\t<dps:report_assignment>\n${assignXml}\n\t\t</dps:report_assignment>\n`
  );
}


