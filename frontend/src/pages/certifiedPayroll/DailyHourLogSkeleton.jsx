import SkeletonCell from './SkeletonCell';
import {
  sectionStyle,
  sectionTitleStyle,
  tableWrapStyle,
  tableStyle,
  thStyle,
  thRightStyle,
  tdStyle,
} from './certifiedPayrollTableStyles';

const COLUMNS = [
  { key: 'workerName', width: '75%' },
  { key: 'classification', width: '55%' },
  { key: 'workerType', width: '35%' },
  { key: 'totalSt', width: '45%' },
  { key: 'totalOt', width: '45%' },
  { key: 'rate', width: '50%' },
  { key: 'gross', width: '55%' },
];

const ROW_COUNT = 8;

export default function DailyHourLogSkeleton() {
  return (
    <section style={sectionStyle}>
      <h2 style={sectionTitleStyle}>Daily Hour Log</h2>
      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Worker Name</th>
              <th style={thStyle}>Classification</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>J/RA</th>
              <th style={thRightStyle}>Total ST</th>
              <th style={thRightStyle}>Total OT</th>
              <th style={thRightStyle}>Rate</th>
              <th style={thRightStyle}>Gross This Job</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: ROW_COUNT }).map((_, rowIndex) => (
              <tr key={rowIndex} className="skeleton-row">
                {COLUMNS.map((col) => (
                  <td key={col.key} style={tdStyle}>
                    <SkeletonCell width={col.width} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
