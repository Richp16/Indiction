const { formatPaychexErrorForLog } = require('./paychexErrors');
const {
  getCompanyChecksForHistory,
  indexChecksByWorker,
  parseCheckForSupplement,
} = require('./paychexCompanyChecks');
const { getWorkerChecksByPayPeriod } = require('./paychexPayPeriodApi');
const { getPayComponentNameMap } = require('./paychexPayComponents');
const { companyId } = require('../config/paychexApi');

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTaxType(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

function isInformationalComponent(item) {
  const paidBy = String(item?.paidBy || '').toUpperCase();
  if (paidBy.includes('EMPLOYER')) return true;
  const type = normalizeTaxType(item?.type || item?.componentType || item?.classificationType);
  const name = String(item?.name || item?.description || item?.taxType || '').toLowerCase();
  return (
    type.includes('INFORMATIONAL') ||
    type.includes('EMPLOYER') ||
    name.includes('employer') ||
    name.includes('unemployment') ||
    name.includes('futa') ||
    name.includes('suta') ||
    name.includes('employer match') ||
    name.includes('employer contribution')
  );
}

function isEmployeeContribution(item) {
  const type = normalizeTaxType(item?.type || item?.componentType || item?.classificationType);
  if (type.includes('EMPLOYEE')) return true;
  if (type.includes('EMPLOYER')) return false;
  return true;
}

function sumAmounts(items) {
  return (items || []).reduce(
    (total, item) => total + toNumber(item.amount ?? item.value ?? item.payAmount),
    0
  );
}

function getEarningsTotal(check) {
  if (check.grossEarnings != null) return toNumber(check.grossEarnings);
  if (check.grossPay != null) return toNumber(check.grossPay);
  const earnings = check.earnings || check.payComponents || [];
  return earnings.reduce(
    (total, item) => total + toNumber(item.amount ?? item.value ?? item.payAmount),
    0
  );
}

function classifyTax(item) {
  const taxType = normalizeTaxType(item.taxType || item.name || item.description);
  if (/UNEMPLOYMENT|FUTA|SUTA/.test(taxType) || taxType.includes('EMPLOYER')) {
    return 'employer_skip';
  }
  if (
    taxType.includes('FEDERAL_INCOME') ||
    taxType === 'FIT' ||
    taxType.includes('FED_INCOME') ||
    (taxType.includes('FEDERAL') && taxType.includes('INCOME'))
  ) {
    return 'federal';
  }
  if (taxType.includes('SOCIAL') || taxType.includes('FICA_SS') || taxType === 'SS') {
    return 'ss';
  }
  if (taxType.includes('MEDICARE') || taxType === 'MED') {
    return 'medicare';
  }
  if (taxType.includes('STATE') && !taxType.includes('UNEMPLOYMENT')) {
    return 'state';
  }
  return 'other';
}

function classifyDeduction(item) {
  const label = String(item.name || item.description || item.benefitName || 'Other Deduction').trim();
  const amount = toNumber(item.amount ?? item.value ?? item.payAmount);
  if (amount <= 0) return null;
  if (isInformationalComponent(item) || !isEmployeeContribution(item)) return null;
  return { label, amount };
}

function parseCheck(check) {
  if (!check) return null;

  const grossPay = getEarningsTotal(check);
  const checkNetPay = toNumber(check.netPay ?? check.netPayAmount ?? check.netAmount ?? 0);

  const taxes = (check.taxes || check.taxDeductions || []).filter(
    (item) => !isInformationalComponent(item) && isEmployeeContribution(item)
  );

  let federalWithholding = 0;
  let fica = 0;
  const otherDeductions = [];

  for (const tax of taxes) {
    const amount = toNumber(tax.amount ?? tax.value ?? tax.payAmount);
    if (amount <= 0) continue;
    const bucket = classifyTax(tax);
    if (bucket === 'employer_skip') continue;
    if (bucket === 'federal') federalWithholding += amount;
    else if (bucket === 'ss' || bucket === 'medicare') fica += amount;
    else if (bucket === 'state') {
      otherDeductions.push({ label: 'State Tax', amount });
    } else {
      otherDeductions.push({
        label: String(tax.name || tax.description || 'Other Tax').trim(),
        amount,
      });
    }
  }

  const deductions = check.deductions || check.benefitDeductions || check.payComponents || [];
  for (const item of deductions) {
    const type = normalizeTaxType(item.type || item.componentType || item.classificationType);
    if (type.includes('TAX')) continue;
    const parsed = classifyDeduction(item);
    if (parsed) otherDeductions.push(parsed);
  }

  const totalOther = otherDeductions.reduce((sum, item) => sum + item.amount, 0);
  const totalDeductions = federalWithholding + fica + totalOther;

  if (grossPay <= 0 && checkNetPay <= 0 && totalDeductions <= 0) {
    return null;
  }

  return {
    grossPay,
    // Prefer Paychex-reported net; only estimate when missing/zero.
    netPay: checkNetPay || grossPay - totalDeductions,
    federalWithholding,
    fica,
    otherDeductions,
    totalDeductions,
  };
}

async function fetchWorkerCheckData(paychexWorkerId, payPeriodId) {
  try {
    // Routes through paychexGet /checks path → Accept: */*, no offset/limit.
    const checks = await getWorkerChecksByPayPeriod({
      workerId: paychexWorkerId,
      payPeriodId,
      companyId: companyId() || undefined,
    });
    if (!checks.length) return null;
    return parseCheck(checks[0].raw || checks[0]);
  } catch (error) {
    console.error(
      `[paychexCheckData] Failed to fetch check for worker ${paychexWorkerId}, period ${payPeriodId}:`,
      formatPaychexErrorForLog(error)
    );
    return null;
  }
}

async function fetchChecksForWorkers({ payPeriodId, workerIds }) {
  const [checksResult, componentMap] = await Promise.all([
    getCompanyChecksForHistory({ payPeriodId }),
    getPayComponentNameMap(),
  ]);
  const allChecks = checksResult.checks || [];
  const checksByWorker = indexChecksByWorker(allChecks);

  return workerIds.map((workerId) => {
    const rawCheck = checksByWorker[String(workerId)];
    const parsed = rawCheck ? parseCheckForSupplement(rawCheck, componentMap) : null;
    return {
      workerId,
      ...(parsed || { workerId, unavailable: true }),
    };
  });
}

module.exports = {
  fetchWorkerCheckData,
  fetchChecksForWorkers,
  parseCheck,
};
