/**
 * Canonical local pay-code metadata (Non-Paychex and internal daily entry).
 * Paychex component IDs remain the storage keys on time_entries for compatibility.
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

/** @type {Record<string, {
 *   code: string,
 *   displayName: string,
 *   usesHours: boolean,
 *   usesAmount: boolean,
 *   multiplier: number,
 *   contributesToWorkedHours: boolean,
 *   contributesToGross: boolean,
 *   taxableByDefault: boolean,
 *   exportCode: string,
 * }>} */
const PAY_CODE_META = {
  REGULAR: {
    code: 'REGULAR',
    displayName: 'Regular',
    usesHours: true,
    usesAmount: false,
    multiplier: 1,
    contributesToWorkedHours: true,
    contributesToGross: true,
    taxableByDefault: true,
    exportCode: 'REGULAR',
  },
  OT: {
    code: 'OT',
    displayName: 'Overtime',
    usesHours: true,
    usesAmount: false,
    multiplier: 1.5,
    contributesToWorkedHours: true,
    contributesToGross: true,
    taxableByDefault: true,
    exportCode: 'OT',
  },
  DT: {
    code: 'DT',
    displayName: 'Double Time',
    usesHours: true,
    usesAmount: false,
    multiplier: 2,
    contributesToWorkedHours: true,
    contributesToGross: true,
    taxableByDefault: true,
    exportCode: 'DT',
  },
  PTO: {
    code: 'PTO',
    displayName: 'PTO',
    usesHours: true,
    usesAmount: false,
    multiplier: 1,
    contributesToWorkedHours: false,
    contributesToGross: true,
    taxableByDefault: true,
    exportCode: 'PTO',
  },
  REIMBURSE: {
    code: 'REIMBURSE',
    displayName: 'Reimbursement',
    usesHours: false,
    usesAmount: true,
    multiplier: 1,
    contributesToWorkedHours: false,
    contributesToGross: false,
    taxableByDefault: false,
    exportCode: 'REIMBURSE',
  },
};

function mapPayCodeToPaychexComponent(payCode) {
  return PAY_CODE_TO_PAYCHEX_COMPONENT[payCode] || payCode;
}

function mapPaychexComponentToPayCode(componentId) {
  return PAYCHEX_COMPONENT_TO_PAY_CODE[componentId] || componentId;
}

function isWagePayCode(payCode) {
  return WAGE_PAY_CODES.has(payCode);
}

function getPayCodeMeta(payCode) {
  return PAY_CODE_META[payCode] || null;
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
  PAY_CODE_META,
  mapPayCodeToPaychexComponent,
  mapPaychexComponentToPayCode,
  isWagePayCode,
  getPayCodeMeta,
  splitHoursByPayCode,
};
