const PAY_CODE_DEFINITIONS = {
  REGULAR: {
    type: 'HOURS',
    label: 'Regular Hours',
    envKey: 'PAYCHEX_REGULAR_COMPONENT_ID',
  },
  OT: {
    type: 'HOURS',
    label: 'Overtime',
    envKey: 'PAYCHEX_OT_COMPONENT_ID',
  },
  PTO: {
    type: 'HOURS',
    label: 'Paid Time Off',
    envKey: 'PAYCHEX_PTO_COMPONENT_ID',
  },
  REIMBURSE: {
    type: 'REIMBURSEMENT',
    label: 'Reimbursement',
    envKey: 'PAYCHEX_REIMBURSE_COMPONENT_ID',
  },
};

function getConfiguredComponentId(envKey) {
  const value = process.env[envKey];
  return value && value.trim() ? value.trim() : null;
}

function getPayCodeDefinition(payCode) {
  if (!payCode) return null;
  return PAY_CODE_DEFINITIONS[payCode] || null;
}

/**
 * resolveHoursComponentId is for export-time mapping only. Daily entry
 * creation should NOT depend on configured component IDs.
 */
function resolveHoursComponentId(payCode) {
  const definition = getPayCodeDefinition(payCode);
  if (!definition || definition.type !== 'HOURS') return null;
  return getConfiguredComponentId(definition.envKey);
}

function isHoursPayCode(payCode) {
  const definition = getPayCodeDefinition(payCode);
  return definition?.type === 'HOURS';
}

function isReimbursementPayCode(payCode) {
  if (payCode === 'REIMBURSE') return true;
  return !isHoursPayCode(payCode) && Boolean(payCode);
}

function isReimbursementComponentName(name) {
  const lower = (name || '').toLowerCase();
  return (
    lower.includes('reimburse') ||
    lower.includes('mileage') ||
    lower.includes('allowance') ||
    lower.includes('truck') ||
    lower.includes('per diem')
  );
}

function isWageComponentName(name) {
  const lower = (name || '').toLowerCase();
  return (
    lower.includes('regular') ||
    lower.includes('overtime') ||
    /\bot\b/.test(lower) ||
    lower.includes('pto') ||
    lower.includes('paid time off') ||
    lower.includes('hourly')
  );
}

function shouldSyncPayComponent(component) {
  const name = component.name || '';
  // Keep wage AND reimbursement components; they are useful metadata.
  return isWageComponentName(name) || isReimbursementComponentName(name);
}

module.exports = {
  PAY_CODE_DEFINITIONS,
  getPayCodeDefinition,
  resolveHoursComponentId,
  isHoursPayCode,
  isReimbursementPayCode,
  isReimbursementComponentName,
  isWageComponentName,
  shouldSyncPayComponent,
  getConfiguredComponentId,
};
