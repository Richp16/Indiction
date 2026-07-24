import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CertifiedPayrollPage from '../CertifiedPayrollPage';

const mockSites = [
  { id: 'site-1', name: 'Main Site', job_code: 'MS-01', is_active: true },
  { id: 'site-2', name: 'Second Site', job_code: 'SS-02', is_active: true },
];

const mockCompany = { companyId: '004WOHNWM70Z2EDFHRDY' };

const mockPaychexPeriods = {
  periods: [
    {
      payPeriodId: '1140037241110861',
      label: 'Jun 14 – Jun 27, 2026',
      displayLabel: 'Jun 14 – Jun 27, 2026',
      startDate: '2026-06-14',
      endDate: '2026-06-27',
      week1Start: '2026-06-14',
      week1End: '2026-06-20',
      week2Start: '2026-06-21',
      week2End: '2026-06-27',
      week1Label: 'Week 1: Jun 14 – Jun 20',
      week2Label: 'Week 2: Jun 21 – Jun 27',
      checkCount: 37,
      status: 'COMPLETED',
      description: 'Biweekly',
    },
    {
      payPeriodId: '1140037241110999',
      label: 'Jun 28 – Jul 11, 2026',
      displayLabel: 'Jun 28 – Jul 11, 2026',
      startDate: '2026-06-28',
      endDate: '2026-07-11',
      week1Start: '2026-06-28',
      week1End: '2026-07-04',
      week2Start: '2026-07-05',
      week2End: '2026-07-11',
      week1Label: 'Week 1: Jun 28 – Jul 4',
      week2Label: 'Week 2: Jul 5 – Jul 11',
      checkCount: 10,
      status: 'COMPLETED',
    },
  ],
};

const mockHours = {
  rows: [
    {
      id: 'worker-1',
      first_name: 'Jane',
      last_name: 'Doe',
      labor_classification: 'Carpenter',
      worker_type: 'J',
      pay_rate: 45,
      paychex_component_id: 'REGULAR',
      hours: 8,
    },
  ],
};

const mockSupplements = {
  rows: [
    {
      worker_id: 'worker-1',
      worker_name: 'Jane Doe',
      classification: 'Carpenter',
      wage_determination_no: 'WD-1',
      net_pay: '500.00',
      source: 'paychex',
    },
  ],
  hasEstimated: false,
  warnings: {
    workersWithHoursButNoPaychexCheck: [],
    paychexChecksWithoutCertifiedPayrollRows: [],
    workersWithMultipleChecksInSamePayPeriod: [],
  },
  debug: {
    localPayPeriodId: '1140037241110861',
    paychexPayPeriodId: '1140037241110861',
    hoursSource: 'daily_time_entries',
    moneySource: 'paychex_company_checks',
    workers: [],
  },
};

const mockChecks = {
  payPeriodId: '1140037241110861',
  count: 37,
  checks: [
    { workerId: '004WOHNWMFGQKR2RLNJS', paycheckId: 'chk-1', netPay: 800 },
  ],
};

let apiGetMock;
let apiPostMock;
let resolveTableData;

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token', user: { role: 'system_admin' } }),
}));

vi.mock('../../api/client', () => ({
  apiGet: (...args) => apiGetMock(...args),
  apiPost: (...args) => apiPostMock(...args),
  apiPatch: vi.fn(),
  apiPostDownload: vi.fn(),
}));

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function setupApiMocks({ delayTableData = false } = {}) {
  const hoursDeferred = delayTableData ? deferred() : null;
  const supplementsDeferred = delayTableData ? deferred() : null;

  apiGetMock = vi.fn(async (path) => {
    if (path === '/api/job-sites') return mockSites;
    if (path === '/api/paychex/company') return mockCompany;
    if (path.includes('/api/paychex/companies/') && path.includes('/pay-periods')) {
      return mockPaychexPeriods;
    }
    if (path.includes('/api/paychex/companies/') && path.includes('/checks')) {
      return mockChecks;
    }
    if (path.includes('/api/certified-payroll/hours')) {
      if (hoursDeferred) return hoursDeferred.promise;
      return mockHours;
    }
    if (path.includes('/api/certified-payroll/supplements')) {
      if (supplementsDeferred) return supplementsDeferred.promise;
      return mockSupplements;
    }
    throw new Error(`Unexpected apiGet path: ${path}`);
  });

  apiPostMock = vi.fn(async () => ({
    rows: [
      {
        worker_id: 'worker-1',
        worker_name: 'Jane Doe',
        classification: 'Carpenter',
        wage_determination_no: 'WD-UPDATED',
        net_pay: '520.00',
      },
    ],
    hasEstimated: false,
  }));

  resolveTableData = () => {
    hoursDeferred?.resolve(mockHours);
    supplementsDeferred?.resolve(mockSupplements);
  };

  return { hoursDeferred, supplementsDeferred };
}

describe('CertifiedPayrollPage loading states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupApiMocks();
  });

  it('shows header, filters, and skeleton tables while data is loading', async () => {
    setupApiMocks({ delayTableData: true });

    render(<CertifiedPayrollPage />);

    expect(screen.getByRole('heading', { name: 'Certified Payroll' })).toBeInTheDocument();
    expect(screen.getByLabelText('Job site')).toBeInTheDocument();
    expect(screen.getByLabelText('Pay period')).toBeInTheDocument();

    expect(screen.getAllByText('Daily Hour Log').length).toBeGreaterThan(0);
    expect(screen.getAllByText('WH-347 Supplement').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('table')).toHaveLength(2);
    expect(screen.queryByText('No hour entries for this week and job site.')).not.toBeInTheDocument();

    resolveTableData();

    await waitFor(() => {
      expect(screen.getByText('Doe, Jane')).toBeInTheDocument();
    });

    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.queryByText('No hour entries for this week and job site.')).not.toBeInTheDocument();
  });

  it('loads all Paychex pay periods into the dropdown', async () => {
    render(<CertifiedPayrollPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Pay period')).toBeInTheDocument();
    });

    const periodSelect = screen.getByLabelText('Pay period');
    expect(within(periodSelect).getAllByRole('option').length).toBe(2);
    expect(periodSelect).toHaveValue('1140037241110861');
  });

  it('shows skeletons again when filters change', async () => {
    const user = userEvent.setup();
    setupApiMocks();
    render(<CertifiedPayrollPage />);

    await waitFor(() => {
      expect(screen.getByText('Doe, Jane')).toBeInTheDocument();
    });

    const delayedHours = deferred();
    const delayedSupplements = deferred();
    apiGetMock.mockImplementation(async (path) => {
      if (path === '/api/job-sites') return mockSites;
      if (path === '/api/paychex/company') return mockCompany;
      if (path.includes('/pay-periods')) return mockPaychexPeriods;
      if (path.includes('/checks')) return mockChecks;
      if (path.includes('/api/certified-payroll/hours')) return delayedHours.promise;
      if (path.includes('/api/certified-payroll/supplements')) return delayedSupplements.promise;
      throw new Error(`Unexpected apiGet path: ${path}`);
    });

    await user.selectOptions(screen.getByLabelText('Job site'), 'site-2');

    await waitFor(() => {
      expect(screen.getByLabelText('Certified payroll data loading')).toBeInTheDocument();
    });

    expect(screen.queryByText('Doe, Jane')).not.toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(2);

    delayedHours.resolve(mockHours);
    delayedSupplements.resolve(mockSupplements);

    await waitFor(() => {
      expect(screen.getByText('Doe, Jane')).toBeInTheDocument();
    });
  });

  it('handles re-sync from Paychex with inline status and keeps table data visible', async () => {
    const user = userEvent.setup();
    render(<CertifiedPayrollPage />);

    await waitFor(() => {
      expect(screen.getByText('Doe, Jane')).toBeInTheDocument();
    });

    let resolveResync;
    const resyncDeferred = new Promise((resolve) => {
      resolveResync = resolve;
    });
    apiPostMock.mockReturnValueOnce(resyncDeferred);

    const resyncButton = screen.getByRole('button', { name: /Re-sync from Paychex/i });
    await user.click(resyncButton);

    expect(resyncButton).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Syncing from Paychex… This may take a moment.');
    expect(screen.getByText('Doe, Jane')).toBeInTheDocument();

    resolveResync({
      rows: [
        {
          worker_id: 'worker-1',
          worker_name: 'Jane Doe',
          classification: 'Carpenter',
          wage_determination_no: 'WD-UPDATED',
          net_pay: '520.00',
        },
      ],
      hasEstimated: false,
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Re-sync from Paychex/i })).not.toBeDisabled();
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('WD-UPDATED')).toBeInTheDocument();
  });

  it('announces loading and loaded states for screen readers', async () => {
    setupApiMocks({ delayTableData: true });
    render(<CertifiedPayrollPage />);

    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).toHaveTextContent('Loading certified payroll data…');

    resolveTableData();

    await waitFor(() => {
      expect(liveRegion).toHaveTextContent('Certified payroll data loaded.');
    });
  });

  it('shows selected Paychex pay period ID', async () => {
    render(<CertifiedPayrollPage />);

    await waitFor(() => {
      expect(screen.getByTestId('paychex-period-link')).toBeInTheDocument();
    });

    expect(screen.getByTestId('paychex-period-link')).toHaveTextContent(
      'Selected Paychex pay period ID: 1140037241110861'
    );
  });

  it('passes paychexPayPeriodId on supplements request', async () => {
    render(<CertifiedPayrollPage />);

    await waitFor(() => {
      expect(apiGetMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      const supplementCall = apiGetMock.mock.calls.find(([path]) =>
        String(path).includes('/api/certified-payroll/supplements')
      );
      expect(supplementCall).toBeTruthy();
      expect(supplementCall[0]).toContain('paychexPayPeriodId=1140037241110861');
      expect(supplementCall[0]).toContain('payPeriodId=1140037241110861');
    });
  });

  it('does not show the raw company-checks debug list on success', async () => {
    render(<CertifiedPayrollPage />);

    await waitFor(() => {
      expect(screen.getByText('Daily Hour Log')).toBeInTheDocument();
    });

    expect(screen.queryByText(/company check\(s\) loaded/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('checks-preview')).not.toBeInTheDocument();
  });

  it('keeps hour log visible when company checks return a Paychex server error', async () => {
    apiGetMock = vi.fn(async (path) => {
      if (path === '/api/job-sites') return mockSites;
      if (path === '/api/paychex/company') return mockCompany;
      if (path.includes('/pay-periods')) return mockPaychexPeriods;
      if (path.includes('/checks')) {
        const err = new Error(
          'Paychex returned a server error for this pay period. Try again later or contact Paychex API Developer Center Support.'
        );
        err.status = 500;
        err.code = 'API-1';
        err.debug = {
          companyId: mockCompany.companyId,
          payPeriodId: '1140037241110861',
          status: 500,
          errorCode: 'API-1',
        };
        throw err;
      }
      if (path.includes('/api/certified-payroll/hours')) return mockHours;
      if (path.includes('/api/certified-payroll/supplements')) return mockSupplements;
      throw new Error(`Unexpected apiGet path: ${path}`);
    });

    render(<CertifiedPayrollPage />);

    await waitFor(() => {
      expect(screen.getByTestId('checks-preview')).toHaveTextContent(
        'Paychex returned a server error for this pay period'
      );
    });

    expect(screen.getByText('Daily Hour Log', { selector: 'h2' })).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('shows empty state only after data has loaded', async () => {
    apiGetMock = vi.fn(async (path) => {
      if (path === '/api/job-sites') return mockSites;
      if (path === '/api/paychex/company') return mockCompany;
      if (path.includes('/pay-periods')) return mockPaychexPeriods;
      if (path.includes('/checks')) return mockChecks;
      if (path.includes('/api/certified-payroll/hours')) return { rows: [] };
      if (path.includes('/api/certified-payroll/supplements')) {
        return { rows: [], hasEstimated: false };
      }
      throw new Error(`Unexpected apiGet path: ${path}`);
    });

    render(<CertifiedPayrollPage />);

    await waitFor(() => {
      expect(screen.getByText('No hour entries for this week and job site.')).toBeInTheDocument();
    });

    const supplementSection = screen.getByText('WH-347 Supplement', { selector: 'h2' }).closest('section');
    expect(
      within(supplementSection).getByText('No supplement rows for this week and job site.')
    ).toBeInTheDocument();
  });
});
