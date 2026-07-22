/**
 * Standalone visual check for WH-347 named-field filling + shrink-to-fit.
 * Writes output/wh347-test-output-v2.pdf (unflattened).
 *
 * Usage: node scripts/testWh347Fill.js
 */

const fs = require('fs');
const path = require('path');
const { fillWh347Form } = require('../services/wh347FormFill');
const { wh347FieldMap } = require('../config/wh347FieldMap');

const OUT_PATH = path.join(__dirname, '..', 'output', 'wh347-test-output-v2.pdf');
const FIELDS_JSON = path.join(__dirname, '..', 'templates', 'wh347-fields.json');

function collectMappedNames(map = wh347FieldMap) {
  const names = [];
  function walk(value) {
    if (typeof value === 'string') names.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  }
  walk(map);
  return names;
}

function assertMapMatchesJson() {
  const catalog = new Set(
    JSON.parse(fs.readFileSync(FIELDS_JSON, 'utf8')).map((f) => f.name)
  );
  const missing = collectMappedNames().filter((name) => !catalog.has(name));
  if (missing.length) {
    throw new Error(
      `wh347FieldMap has names not in wh347-fields.json:\n${missing.join('\n')}`
    );
  }
  console.log(`Field map OK: ${collectMappedNames().length} names match wh347-fields.json`);
}

async function main() {
  assertMapMatchesJson();

  const project = {
    name: 'Main Street Bridge Rehab — Phase II Expansion Corridor',
    contract_number: 'DOT-2026-0142-LONG',
    address: '100 Main St Suite 400, Springfield, IL 62701',
    wage_determination_no: 'IL20260001MOD8',
  };

  const company = {
    company_name: 'FieldPay Construction LLC d/b/a Midwest Heavy Civil Partners',
    company_address: '500 Industrial Pkwy Building C, Springfield, IL 62703',
    certifying_official_name: 'Jordan Alexander Lee-Montgomery',
    certifying_official_title: 'Senior Certified Payroll Administrator',
    phone: '(217) 555-0199',
    email: 'jordan.lee-montgomery@fieldpay.example',
    additional_remarks:
      'Stress-test fill for shrink-to-fit: long names, classifications, and decimal deductions.',
  };

  const workers = [
    {
      id: 'worker-1',
      // Long last/first names to force shrink in name columns.
      first_name: 'Christopherjonathan',
      last_name: 'Vanderbilt-Rodriguez',
      middle_initial: 'A',
      worker_type: 'J',
      identifying_number: 'W-1001',
      // Extremely long classification — may hit truncation safety net.
      labor_classification:
        'Journeyworker Carpenter / Form Setter / Concrete Finisher (Heavy Highway)',
      pay_rate: 45.75,
      days: {
        // 3-digit hour stress for narrow day columns.
        mon: { st: 10.5, ot: 2.25 },
        tue: { st: 12, ot: 3.5 },
        wed: { st: 11.75, ot: 4 },
        thu: { st: 10, ot: 2 },
        fri: { st: 9.5, ot: 1.5 },
        sat: { st: 8, ot: 0 },
        sun: { st: 0, ot: 0 },
      },
    },
  ];

  const supplementsByWorker = {
    'worker-1': {
      paychex_worker_number: 'W-1001',
      fringe_benefit_credit: '12.50',
      fringe_paid_in_lieu: '3.25',
      gross_earned_all_work: '4123.56',
      // Decimal deductions that must still fit in narrow columns.
      deduction_withholding: '987.65',
      deduction_fica: '315.45',
      deduction_other: '1234.56',
      deduction_other_label: '401k+Health+UnionDues',
      net_pay: '1585.90',
    },
  };

  console.log('Filling WH-347 stress-test sample (unflattened)…');
  const pdf = await fillWh347Form({
    project,
    company,
    weekEndingDate: '2026-07-11',
    payrollNumber: 7,
    workers,
    supplementsByWorker,
    flatten: false,
    isPrime: true,
    isFinal: false,
    statementCheckBoxes: [1],
  });

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, pdf);

  console.log(`Wrote ${pdf.length} bytes → ${OUT_PATH}`);
  if (pdf.slice(0, 4).toString() !== '%PDF') {
    throw new Error('Output does not start with %PDF');
  }
  console.log('PDF header OK (%PDF)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
