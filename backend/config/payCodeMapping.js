/**
 * Maps internal daily-entry pay codes to Paychex pay component IDs
 * stored on aggregated time_entries rows.
 */
const PAY_CODE_TO_PAYCHEX_COMPONENT = {
  REGULAR: 'HOURLY',
  OT: 'OVERTIME',
  DT: 'DOUBLETIME',
  PTO: 'PTO',
  REIMBURSE: 'REIMBURSE',
};

const PAYCHEX_COMPONENT_TO_PAY_CODE = {
  HOURLY: 'REGULAR',
  OVERTIME: 'OT',
  DOUBLETIME: 'DT',
  REGULAR: 'REGULAR',
  OT: 'OT',
  PTO: 'PTO',
  REIMBURSE: 'REIMBURSE',
};

const WAGE_PAY_CODES = new Set(['REGULAR', 'OT', 'DT']);

const STANDARD_DAILY_PAY_CODES = ['REGULAR', 'OT', 'DT', 'PTO', 'REIMBURSE'];

function mapPayCodeToPaychexComponent(payCode) {
  return PAY_CODE_TO_PAYCHEX_COMPONENT[payCode] || payCode;
}

function mapPaychexComponentToPayCode(componentId) {
  return PAYCHEX_COMPONENT_TO_PAY_CODE[componentId] || componentId;
}

function isWagePayCode(payCode) {
  return WAGE_PAY_CODES.has(payCode);
}

function splitHoursByPayCode(payCode, hours) {
  const value = Number(hours) || 0;
  return {
    regular_hours: payCode === 'REGULAR' ? value : 0,
    overtime_hours: payCode === 'OT' ? value : 0,
    doubletime_hours: payCode === 'DT' ? value : 0,
  };
}

module.exports = {
  PAY_CODE_TO_PAYCHEX_COMPONENT,
  PAYCHEX_COMPONENT_TO_PAY_CODE,
  STANDARD_DAILY_PAY_CODES,
  mapPayCodeToPaychexComponent,
  mapPaychexComponentToPayCode,
  isWagePayCode,
  splitHoursByPayCode,
};
