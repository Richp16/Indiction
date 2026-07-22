const { companyId } = require('../config/paychexApi');
const { paychexGet } = require('./paychexHttp');
const { formatPaychexErrorForLog } = require('./paychexErrors');

let cachedComponentMap = null;

function buildComponentMap(components) {
  const map = new Map();
  for (const component of components) {
    const id =
      component.componentId ||
      component.payComponentId ||
      component.id ||
      component.paychexComponentId;
    const name =
      component.name ||
      component.componentName ||
      component.description ||
      component.payComponentName;
    if (id && name) {
      map.set(String(id), String(name));
    }
  }
  return map;
}

async function loadPayComponentMap() {
  try {
    const components = await paychexGet(`/companies/${companyId()}/paycomponents`);
    cachedComponentMap = buildComponentMap(components);
    console.log('[PaychexPayComponents] Loaded component map:', {
      count: cachedComponentMap.size,
    });
    return cachedComponentMap;
  } catch (error) {
    console.error(
      '[PaychexPayComponents] Failed to load pay components:',
      formatPaychexErrorForLog(error)
    );
    cachedComponentMap = cachedComponentMap || new Map();
    return cachedComponentMap;
  }
}

async function getPayComponentNameMap() {
  if (cachedComponentMap) {
    return cachedComponentMap;
  }
  return loadPayComponentMap();
}

function resolveComponentLabel(item, componentMap) {
  const direct =
    item.name ||
    item.description ||
    item.benefitName ||
    item.componentName ||
    item.payComponentName;
  if (direct) return String(direct).trim();

  const componentId =
    item.componentId ||
    item.payComponentId ||
    item.paychexComponentId ||
    item.id;
  if (componentId && componentMap?.has(String(componentId))) {
    return componentMap.get(String(componentId));
  }

  return 'Other';
}

async function refreshPayComponentMapIfMissing(componentId) {
  if (!componentId) return getPayComponentNameMap();
  const map = await getPayComponentNameMap();
  if (!map.has(String(componentId))) {
    return loadPayComponentMap();
  }
  return map;
}

module.exports = {
  getPayComponentNameMap,
  resolveComponentLabel,
  refreshPayComponentMapIfMissing,
  buildComponentMap,
};
