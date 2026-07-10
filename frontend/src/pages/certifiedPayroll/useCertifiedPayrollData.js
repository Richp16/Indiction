import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet } from '../../api/client';

function getWeekEndingDate(period, selectedWeek) {
  if (!period) return '';
  return selectedWeek === 'week1' ? period.week1End : period.week2End;
}

const emptyQuery = { isLoading: false, error: null };

export function useCertifiedPayrollData(token) {
  const [sites, setSites] = useState([]);
  const [payPeriods, setPayPeriods] = useState([]);
  const [selectedSite, setSelectedSite] = useState('');
  const [selectedPayPeriodId, setSelectedPayPeriodId] = useState('');
  const [selectedWeek, setSelectedWeek] = useState('week2');
  const [hoursRows, setHoursRows] = useState([]);
  const [suppRows, setSuppRows] = useState([]);
  const [hasEstimated, setHasEstimated] = useState(false);

  const [jobSitesQuery, setJobSitesQuery] = useState({ ...emptyQuery, isLoading: true });
  const [payPeriodsQuery, setPayPeriodsQuery] = useState({ ...emptyQuery, isLoading: true });
  const [dailyHourLogQuery, setDailyHourLogQuery] = useState({ ...emptyQuery, isLoading: false });
  const [wh347SupplementQuery, setWh347SupplementQuery] = useState({
    ...emptyQuery,
    isLoading: false,
  });

  const defaultsAppliedRef = useRef(false);

  const selectedPeriod = useMemo(
    () => payPeriods.find((period) => period.payPeriodId === selectedPayPeriodId) || null,
    [payPeriods, selectedPayPeriodId]
  );

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
        const [sitesData, periodsData] = await Promise.all([
          apiGet('/api/job-sites', token),
          apiGet('/api/certified-payroll/pay-periods', token),
        ]);

        if (cancelled) return;

        const active = (sitesData || []).filter((site) => site.is_active !== false);
        const periods = periodsData.periods || [];

        setSites(active);
        setPayPeriods(periods);
        setJobSitesQuery({ isLoading: false, error: null });
        setPayPeriodsQuery({ isLoading: false, error: null });

        if (!defaultsAppliedRef.current) {
          defaultsAppliedRef.current = true;
          if (active[0]) setSelectedSite((current) => current || active[0].id);
          if (periods[0]) {
            setSelectedPayPeriodId((current) => current || periods[0].payPeriodId);
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
  }, [token]);

  useEffect(() => {
    if (!token || !selectedSite || !weekEndingDate || !selectedPayPeriodId) {
      return undefined;
    }

    let cancelled = false;

    async function loadTableData() {
      setDailyHourLogQuery({ isLoading: true, error: null });
      setWh347SupplementQuery({ isLoading: true, error: null });

      try {
        const [hours, supplements] = await Promise.all([
          apiGet(
            `/api/certified-payroll/hours?jobSiteId=${selectedSite}&weekEndingDate=${weekEndingDate}`,
            token
          ),
          apiGet(
            `/api/certified-payroll/supplements?jobSiteId=${selectedSite}` +
              `&weekEndingDate=${weekEndingDate}&payPeriodId=${encodeURIComponent(selectedPayPeriodId)}`,
            token
          ),
        ]);

        if (cancelled) return;

        setHoursRows(hours.rows || []);
        setSuppRows(supplements.rows || []);
        setHasEstimated(Boolean(supplements.hasEstimated));
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
      }
    }

    loadTableData();
    return () => {
      cancelled = true;
    };
  }, [token, selectedSite, weekEndingDate, selectedPayPeriodId]);

  return {
    sites,
    payPeriods,
    selectedSite,
    setSelectedSite,
    selectedPayPeriodId,
    setSelectedPayPeriodId,
    selectedWeek,
    setSelectedWeek,
    selectedPeriod,
    weekEndingDate,
    hoursRows,
    setHoursRows,
    suppRows,
    setSuppRows,
    hasEstimated,
    setHasEstimated,
    jobSitesQuery,
    payPeriodsQuery,
    dailyHourLogQuery,
    wh347SupplementQuery,
    isLoadingPageData,
    loadError,
  };
}
