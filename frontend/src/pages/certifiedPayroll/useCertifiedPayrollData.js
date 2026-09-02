import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet } from '../../api/client';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {string | null | undefined} value
 * @returns {Date | null}
 */
export function safeParseDate(value) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (!raw || /^invalid/i.test(raw)) return null;

  const dayOnly = raw.split('T')[0];
  if (ISO_DATE_RE.test(dayOnly)) {
    const utc = new Date(`${dayOnly}T00:00:00.000Z`);
    return Number.isNaN(utc.getTime()) ? null : utc;
  }

  const parsed = new Date(raw);
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function formatUtcMonthDay(date) {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function isNonPayrollDescription(description) {
  const text = String(description || '')
    .trim()
    .toLowerCase();
  if (!text) return false;
  return (
    text === 'void' ||
    text.includes('void') ||
    text === 'manual adjustment' ||
    text.includes('manual adjustment')
  );
}

function checkCountSuffix(checkCount) {
  if (checkCount == null || !Number.isFinite(Number(checkCount))) return '';
  return ` (${Number(checkCount)} checks)`;
}

/**
 * Build a human-readable dropdown label. Never throws on bad dates.
 */
export function buildPaychexPeriodLabel({
  startDate,
  endDate,
  description,
  checkCount,
  payPeriodId,
  existingLabel,
}) {
  // Prefer a backend label only when it does not look broken.
  if (
    existingLabel &&
    !/invalid date/i.test(String(existingLabel)) &&
    !/\bNaN\b/.test(String(existingLabel))
  ) {
    return String(existingLabel);
  }

  const desc = description && String(description).trim() ? String(description).trim() : '';
  const start = safeParseDate(startDate);
  const end = safeParseDate(endDate);

  if (!isNonPayrollDescription(desc) && start && end) {
    return `${formatUtcMonthDay(start)} – ${formatUtcMonthDay(end)}, ${end.getUTCFullYear()}`;
  }

  if (desc) {
    return `${desc}${checkCountSuffix(checkCount)}`;
  }

  if (checkCount != null && Number.isFinite(Number(checkCount))) {
    return `Pay period (${Number(checkCount)} checks)`;
  }

  return payPeriodId ? `Pay period ${payPeriodId}` : 'Pay period';
}

function isIsoDate(value) {
  if (!value) return false;
  const day = String(value).split('T')[0];
  if (!ISO_DATE_RE.test(day)) return false;
  return Boolean(safeParseDate(day));
}

function getWeekEndingDate(period, selectedWeek) {
  if (!period) return '';
  const candidate = selectedWeek === 'week1' ? period.week1End : period.week2End;
  return isIsoDate(candidate) ? String(candidate).split('T')[0] : '';
}

/**
 * Normalize paychex_pay_periods API rows into Certified Payroll dropdown options.
 * Field names match the API: startDate, endDate, description, checkCount, payPeriodId.
 */
export function normalizePaychexPeriodOption(period) {
  const payPeriodId = period.payPeriodId || period.pay_period_id;
  const startDate = period.startDate || period.start_date || null;
  const endDate = period.endDate || period.end_date || null;
  const description = period.description || null;
  const checkCount = period.checkCount ?? period.check_count ?? null;

  const start = safeParseDate(startDate);
  const end = safeParseDate(endDate);
  const hasValidDates = Boolean(start && end) && !isNonPayrollDescription(description);

  const week1Start = hasValidDates
    ? period.week1Start || (start ? start.toISOString().slice(0, 10) : null)
    : period.week1Start || null;
  const week1End = isIsoDate(period.week1End) ? period.week1End : null;
  const week2Start = isIsoDate(period.week2Start) ? period.week2Start : null;
  const week2End = isIsoDate(period.week2End || endDate)
    ? period.week2End || String(endDate).split('T')[0]
    : null;

  const label = buildPaychexPeriodLabel({
    startDate,
    endDate,
    description,
    checkCount,
    payPeriodId,
    existingLabel: period.label || period.displayLabel,
  });

  return {
    ...period,
    id: payPeriodId,
    payPeriodId,
    paychexPayPeriodId: payPeriodId,
    startDate: start ? start.toISOString().slice(0, 10) : null,
    endDate: end ? end.toISOString().slice(0, 10) : null,
    week1Start,
    week1End,
    week2Start,
    week2End,
    week1Label: period.week1Label,
    week2Label: period.week2Label,
    label,
    displayLabel: label,
    checkCount,
    status: period.status || null,
    description,
    hasValidDates,
  };
}

const emptyQuery = { isLoading: false, error: null };

export function useCertifiedPayrollData(token, refreshNonce = 0) {
  const [sites, setSites] = useState([]);
  const [companyId, setCompanyId] = useState('');
  const [paychexPayPeriods, setPaychexPayPeriods] = useState([]);
  const [selectedSite, setSelectedSite] = useState('');
  const [selectedPaychexPayPeriodId, setSelectedPaychexPayPeriodId] = useState('');
  const [selectedWeek, setSelectedWeek] = useState('week2');
  const [hoursRows, setHoursRows] = useState([]);
  const [suppRows, setSuppRows] = useState([]);
  const [hasEstimated, setHasEstimated] = useState(false);
  const [needsManualWithholding, setNeedsManualWithholding] = useState(false);
  const [reconciliationWarnings, setReconciliationWarnings] = useState(null);
  const [payrollDebug, setPayrollDebug] = useState(null);
  const [checksPreview, setChecksPreview] = useState(null);
  const [checksError, setChecksError] = useState('');
  const [checksErrorDebug, setChecksErrorDebug] = useState(null);

  const [jobSitesQuery, setJobSitesQuery] = useState({ ...emptyQuery, isLoading: true });
  const [payPeriodsQuery, setPayPeriodsQuery] = useState({ ...emptyQuery, isLoading: true });
  const [dailyHourLogQuery, setDailyHourLogQuery] = useState({ ...emptyQuery, isLoading: false });
  const [wh347SupplementQuery, setWh347SupplementQuery] = useState({
    ...emptyQuery,
    isLoading: false,
  });

  const defaultsAppliedRef = useRef(false);

  // Alias for existing page code that still says payPeriods / selectedPayPeriodId.
  const payPeriods = paychexPayPeriods;
  const selectedPayPeriodId = selectedPaychexPayPeriodId;
  const setSelectedPayPeriodId = setSelectedPaychexPayPeriodId;

  const selectedPeriod = useMemo(
    () =>
      paychexPayPeriods.find((period) => period.payPeriodId === selectedPaychexPayPeriodId) ||
      null,
    [paychexPayPeriods, selectedPaychexPayPeriodId]
  );

  const selectedPeriodPaychexId = selectedPaychexPayPeriodId || null;

  const weekEndingDate = useMemo(
    () => getWeekEndingDate(selectedPeriod, selectedWeek),
    [selectedPeriod, selectedWeek]
  );

  const isLoadingPageData =
    jobSitesQuery.isLoading ||
    payPeriodsQuery.isLoading ||
    dailyHourLogQuery.isLoading ||
    wh347SupplementQuery.isLoading;

  const loadError =
    jobSitesQuery.error ||
    payPeriodsQuery.error ||
    dailyHourLogQuery.error ||
    wh347SupplementQuery.error;

  useEffect(() => {
    if (!token) return undefined;

    let cancelled = false;
    defaultsAppliedRef.current = false;

    async function loadBase() {
      setJobSitesQuery({ isLoading: true, error: null });
      setPayPeriodsQuery({ isLoading: true, error: null });

      try {
        const [sitesData, appConfig] = await Promise.all([
          apiGet('/api/job-sites', token),
          apiGet('/api/app-config', token),
        ]);
        if (cancelled) return;

        const active = (sitesData || []).filter((site) => site.is_active !== false);
        let periods = [];

        if (appConfig.paychexEnabled !== false) {
          const company = await apiGet('/api/paychex/company', token);
          const cid = company.companyId;
          const periodsData = await apiGet(
            `/api/paychex/companies/${cid}/pay-periods?hasHours=true`,
            token
          );
          periods = (periodsData.periods || []).map(normalizePaychexPeriodOption);
          setCompanyId(cid);
        } else {
          const periodsData = await apiGet('/api/pay-periods', token);
          periods = (periodsData || []).map((period) => ({
            payPeriodId: period.id,
            displayLabel: period.label,
            label: period.label,
            week1Label: period.week1Label,
            week2Label: period.week2Label,
            startDate: period.startDate,
            endDate: period.endDate,
            week1End: period.week1End,
            week2End: period.week2End,
          }));
          setCompanyId('');
        }

        if (cancelled) return;

        setSites(active);
        setPaychexPayPeriods(periods);
        setJobSitesQuery({ isLoading: false, error: null });
        setPayPeriodsQuery({ isLoading: false, error: null });

        if (!defaultsAppliedRef.current) {
          defaultsAppliedRef.current = true;
          if (active[0]) setSelectedSite((current) => current || active[0].id);
          if (periods[0]) {
            setSelectedPaychexPayPeriodId((current) => current || periods[0].payPeriodId);
            setSelectedWeek('week2');
          }
        }
      } catch (err) {
        if (cancelled) return;
        const message = err.message || 'Failed to load page data';
        setJobSitesQuery({ isLoading: false, error: message });
        setPayPeriodsQuery({ isLoading: false, error: message });
      }
    }

    loadBase();
    return () => {
      cancelled = true;
    };
  }, [token, refreshNonce]);

  // Hours + supplements for selected Paychex period / week.
  useEffect(() => {
    if (!token || !selectedSite || !weekEndingDate || !selectedPaychexPayPeriodId) {
      setDailyHourLogQuery({ isLoading: false, error: null });
      setWh347SupplementQuery({ isLoading: false, error: null });
      setHoursRows([]);
      setSuppRows([]);
      setHasEstimated(false);
      setNeedsManualWithholding(false);
      setReconciliationWarnings(null);
      setPayrollDebug(null);
      return undefined;
    }

    let cancelled = false;

    async function loadTableData() {
      setDailyHourLogQuery({ isLoading: true, error: null });
      setWh347SupplementQuery({ isLoading: true, error: null });

      try {
        const paychexQuery = `&paychexPayPeriodId=${encodeURIComponent(selectedPaychexPayPeriodId)}`;
        const weekQuery = selectedWeek
          ? `&selectedWeek=${encodeURIComponent(selectedWeek)}`
          : '';

        const [hours, supplements] = await Promise.all([
          apiGet(
            `/api/certified-payroll/hours?jobSiteId=${selectedSite}&weekEndingDate=${weekEndingDate}`,
            token
          ),
          apiGet(
            `/api/certified-payroll/supplements?jobSiteId=${selectedSite}` +
              `&weekEndingDate=${weekEndingDate}` +
              `&payPeriodId=${encodeURIComponent(selectedPaychexPayPeriodId)}` +
              paychexQuery +
              weekQuery,
            token
          ),
        ]);

        if (cancelled) return;

        setHoursRows(hours.rows || []);
        setSuppRows(supplements.rows || []);
        setHasEstimated(Boolean(supplements.hasEstimated));
        setNeedsManualWithholding(Boolean(supplements.needsManualWithholding));
        setReconciliationWarnings(supplements.warnings || null);
        setPayrollDebug(supplements.debug || null);
        setDailyHourLogQuery({ isLoading: false, error: null });
        setWh347SupplementQuery({ isLoading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        const message = err.message || 'Failed to load certified payroll data';
        setDailyHourLogQuery({ isLoading: false, error: message });
        setWh347SupplementQuery({ isLoading: false, error: message });
        setHoursRows([]);
        setSuppRows([]);
        setHasEstimated(false);
        setNeedsManualWithholding(false);
        setReconciliationWarnings(null);
        setPayrollDebug(null);
      }
    }

    loadTableData();
    return () => {
      cancelled = true;
    };
  }, [token, selectedSite, weekEndingDate, selectedPaychexPayPeriodId, selectedWeek]);

  // Test fetch: company checks for the selected Paychex period.
  // Failures must not block Daily Hour Log / supplements (handled in a separate effect).
  useEffect(() => {
    if (!token || !companyId || !selectedPaychexPayPeriodId) {
      setChecksPreview(null);
      setChecksError('');
      setChecksErrorDebug(null);
      return undefined;
    }

    let cancelled = false;

    async function loadChecksPreview() {
      setChecksError('');
      setChecksErrorDebug(null);
      try {
        const data = await apiGet(
          `/api/paychex/companies/${companyId}/checks?payPeriodId=${encodeURIComponent(selectedPaychexPayPeriodId)}`,
          token
        );
        if (cancelled) return;
        setChecksPreview({
          payPeriodId: data.payPeriodId,
          count: data.count,
          workers: (data.checks || []).slice(0, 12).map((check) => ({
            workerId: check.workerId,
            paycheckId: check.paycheckId,
            netPay: check.netPay,
            checkDate: check.checkDate,
          })),
        });
        console.log('[CertifiedPayroll] Company checks loaded', {
          payPeriodId: data.payPeriodId,
          count: data.count,
        });
      } catch (err) {
        if (cancelled) return;
        setChecksPreview(null);
        setChecksError(
          err.message ||
            'Paychex returned a server error for this pay period. Try again later or contact Paychex API Developer Center Support.'
        );
        setChecksErrorDebug(
          err.debug || {
            companyId,
            payPeriodId: selectedPaychexPayPeriodId,
            status: err.status || null,
            errorCode: err.code || null,
          }
        );
        console.warn('[CertifiedPayroll] Company checks failed', err.message, err.debug);
      }
    }

    loadChecksPreview();
    return () => {
      cancelled = true;
    };
  }, [token, companyId, selectedPaychexPayPeriodId]);

  return {
    sites,
    companyId,
    payPeriods,
    paychexPayPeriods,
    selectedSite,
    setSelectedSite,
    selectedPayPeriodId,
    setSelectedPayPeriodId,
    selectedPaychexPayPeriodId,
    setSelectedPaychexPayPeriodId,
    selectedWeek,
    setSelectedWeek,
    selectedPeriod,
    selectedPeriodPaychexId,
    weekEndingDate,
    hoursRows,
    setHoursRows,
    suppRows,
    setSuppRows,
    hasEstimated,
    setHasEstimated,
    needsManualWithholding,
    setNeedsManualWithholding,
    reconciliationWarnings,
    setReconciliationWarnings,
    payrollDebug,
    setPayrollDebug,
    checksPreview,
    checksError,
    checksErrorDebug,
    jobSitesQuery,
    payPeriodsQuery,
    dailyHourLogQuery,
    wh347SupplementQuery,
    isLoadingPageData,
    loadError,
  };
}
