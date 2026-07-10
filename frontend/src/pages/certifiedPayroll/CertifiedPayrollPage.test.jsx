import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CertifiedPayrollPage from '../CertifiedPayrollPage';

const mockSites = [
  { id: 'site-1', name: 'Main Site', job_code: 'MS-01', is_active: true },
  { id: 'site-2', name: 'Second Site', job_code: 'SS-02', is_active: true },
];

const mockPeriods = {
  periods: [
    {
      payPeriodId: 'pp-1',
      label: 'Jan 1 – Jan 14, 2026',
      week1Label: 'Week 1: Jan 1 – Jan 7',
      week2Label: 'Week 2: Jan 8 – Jan 14',
      week1End: '2026-01-07',
      week2End: '2026-01-14',
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
    },
  ],
  hasEstimated: false,
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
    if (path === '/api/certified-payroll/pay-periods') return mockPeriods;
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

  it('shows skeletons again when filters change', async () => {
    const user = userEvent.setup();
    const { hoursDeferred, supplementsDeferred } = setupApiMocks();
    render(<CertifiedPayrollPage />);

    await waitFor(() => {
      expect(screen.getByText('Doe, Jane')).toBeInTheDocument();
    });

    const delayedHours = deferred();
    const delayedSupplements = deferred();
    apiGetMock.mockImplementation(async (path) => {
      if (path === '/api/job-sites') return mockSites;
      if (path === '/api/certified-payroll/pay-periods') return mockPeriods;
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

  it('shows empty state only after data has loaded', async () => {
    apiGetMock = vi.fn(async (path) => {
      if (path === '/api/job-sites') return mockSites;
      if (path === '/api/certified-payroll/pay-periods') return mockPeriods;
      if (path.includes('/api/certified-payroll/hours')) return { rows: [] };
      if (path.includes('/api/certified-payroll/supplements')) return { rows: [], hasEstimated: false };
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
