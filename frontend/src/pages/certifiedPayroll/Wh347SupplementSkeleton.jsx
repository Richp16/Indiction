import SkeletonCell from './SkeletonCell';
import {
  sectionStyle,
  sectionTitleStyle,
  tableWrapStyle,
  tableStyle,
  thStyle,
  tdStyle,
} from './certifiedPayrollTableStyles';

const COLUMNS = [
  { key: 'workerName', width: '75%' },
  { key: 'classification', width: '55%' },
  { key: 'wageDet', width: '50%' },
  { key: 'fringeCredit', width: '55%' },
  { key: 'fringeLieu', width: '55%' },
  { key: 'grossAll', width: '60%' },
  { key: 'withholding', width: '50%' },
  { key: 'fica', width: '45%' },
  { key: 'other', width: '40%' },
  { key: 'otherLabel', width: '65%' },
  { key: 'netPay', width: '50%' },
];

const ROW_COUNT = 8;

export default function Wh347SupplementSkeleton() {
  return (
    <section style={sectionStyle}>
      <h2 style={sectionTitleStyle}>WH-347 Supplement</h2>
      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={{ ...thStyle, minWidth: 160 }}>Worker Name</th>
              <th style={thStyle}>Classification</th>
              <th style={thStyle}>Wage Det. No.</th>
              <th style={thStyle}>Fringe Credit</th>
              <th style={thStyle}>Fringe in Lieu</th>
              <th style={thStyle}>Gross All Work</th>
              <th style={thStyle}>Withholding</th>
              <th style={thStyle}>FICA</th>
              <th style={thStyle}>Other</th>
              <th style={thStyle}>Other Label</th>
              <th style={thStyle}>Net Pay</th>
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
