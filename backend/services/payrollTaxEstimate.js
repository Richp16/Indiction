const FICA_EMPLOYEE_RATE = 0.0765;

/**
 * IRS Pub 15-T (2025) Percentage Method — biweekly payroll, single filer.
 * Standard W-4, no additional withholding adjustments.
 */
function estimateFederalWithholding(grossPay, payFrequency = 'BIWEEKLY') {
  const gross = Number(grossPay) || 0;
  if (gross <= 0) return 0;

  let wages = gross;
  if (payFrequency === 'WEEKLY') wages = gross * 2;
  if (payFrequency === 'MONTHLY') wages = (gross * 12) / 26;
  if (payFrequency === 'SEMI_MONTHLY') wages = (gross * 24) / 26;

  let tax;
  if (wages <= 471) tax = 0;
  else if (wages <= 1446) tax = (wages - 471) * 0.1;
  else if (wages <= 4627) tax = 97.5 + (wages - 1446) * 0.12;
  else if (wages <= 8835) tax = 479.34 + (wages - 4627) * 0.22;
  else if (wages <= 15679) tax = 1405.18 + (wages - 8835) * 0.24;
  else if (wages <= 19560) tax = 2966.74 + (wages - 15679) * 0.32;
  else if (wages <= 48065) tax = 4208.98 + (wages - 19560) * 0.35;
  else tax = 14185.73 + (wages - 48065) * 0.37;

  if (payFrequency === 'WEEKLY') return roundMoney(tax / 2);
  if (payFrequency === 'MONTHLY') return roundMoney((tax * 26) / 12);
  if (payFrequency === 'SEMI_MONTHLY') return roundMoney((tax * 26) / 24);
  return roundMoney(tax);
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function estimateDeductions(grossAllWork) {
  const gross = roundMoney(grossAllWork);
  const fica = roundMoney(gross * FICA_EMPLOYEE_RATE);
  const federalWithholding = estimateFederalWithholding(gross, 'BIWEEKLY');
  const otherDeductions = [];
  const totalOther = 0;
  const netPay = roundMoney(gross - federalWithholding - fica - totalOther);

  return {
    grossPay: gross,
    netPay,
    federalWithholding,
    fica,
    otherDeductions,
    totalDeductions: roundMoney(federalWithholding + fica + totalOther),
  };
}

module.exports = {
  FICA_EMPLOYEE_RATE,
  estimateFederalWithholding,
  estimateDeductions,
  roundMoney,
};
