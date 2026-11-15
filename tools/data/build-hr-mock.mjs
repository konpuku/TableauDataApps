// HR Dashboard のローカルプレビュー用に、Employee Master と同じ列名の「架空の」社員データを作る。
// 実データは一切含まない。乱数は固定シードなので何度作っても同じ結果になる。
//   node tools/data/build-hr-mock.mjs "apps/HR Dashboard/mock/employee-master.csv"
import { writeFileSync } from 'node:fs';

let seed = 20261115;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = (items, weights) => {
  let r = rnd() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) if ((r -= weights[i]) < 0) return items[i];
  return items[items.length - 1];
};
const pad = (n) => String(n).padStart(2, '0');
const date = (y) => `${y}-${pad(1 + Math.floor(rnd() * 12))}-${pad(1 + Math.floor(rnd() * 28))}`;

const DEPTS = ['Engineering', 'Sales', 'Operations', 'Marketing', 'Finance', 'HR'];
const GRADES = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6'];
const BASE = { G1: 3.6e6, G2: 4.6e6, G3: 5.9e6, G4: 7.6e6, G5: 9.8e6, G6: 13e6 };
const rows = [['employee_id', 'full_name', 'department', 'job_title', 'grade', 'office', 'manager_id',
  'hire_date', 'termination_date', 'employment_status', 'annual_salary_jpy', 'performance_rating',
  'employment_type'].join(',')];

for (let i = 1; i <= 420; i++) {
  const dept = pick(DEPTS, [34, 24, 16, 10, 8, 8]);
  const grade = pick(GRADES, [14, 24, 26, 18, 12, 6]);
  const hireYear = 2015 + Math.floor(Math.pow(rnd(), 0.7) * 12);
  const churn = dept === 'Sales' ? 0.24 : dept === 'Operations' ? 0.18 : 0.11;
  const terminated = rnd() < churn && hireYear < 2026;
  const status = terminated ? 'Terminated' : pick(['Active', 'On Leave'], [95, 5]);
  const termYear = terminated ? Math.min(2026, hireYear + 1 + Math.floor(rnd() * 6)) : null;
  rows.push([
    `E${String(i).padStart(4, '0')}`, `Employee ${i}`, dept, `${dept} ${grade}`, grade,
    pick(['Tokyo', 'Osaka', 'Nagoya', 'Fukuoka', 'Sapporo'], [50, 20, 12, 10, 8]),
    `E${String(1 + Math.floor(rnd() * 40)).padStart(4, '0')}`,
    date(hireYear), terminated ? date(termYear) : '', status,
    Math.round(BASE[grade] * (0.85 + rnd() * 0.3) / 1e4) * 1e4,
    pick([1, 2, 3, 4, 5], [4, 14, 44, 28, 10]),
    pick(['Full-time', 'Contract', 'Part-time'], [80, 13, 7]),
  ].join(','));
}
writeFileSync(process.argv[2], rows.join('\n') + '\n');
console.log(`${rows.length - 1} rows`);
