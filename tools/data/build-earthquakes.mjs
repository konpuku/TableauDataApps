// vega-datasets の earthquakes.json(USGS "All Earthquakes, Past Week" の 2018-02 時点スナップショット)
// を、Globe Explorer に同梱する CSV に変換する。
//   npm i vega-datasets && node tools/data/build-earthquakes.mjs <vega-datasets/data/earthquakes.json> <out.csv>
import { readFileSync, writeFileSync } from 'node:fs';

const [src, out] = process.argv.slice(2);
const AREA_FIX = { CA: 'California', MX: 'Mexico', NV: 'Nevada' };
const pad = (n) => String(n).padStart(2, '0');
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;

const rows = [['Event ID', 'Time', 'Place', 'Area', 'Magnitude', 'Depth Km', 'Latitude', 'Longitude',
  'Mag Type', 'Event Type', 'Significance', 'Tsunami'].join(',')];
for (const f of JSON.parse(readFileSync(src, 'utf8')).features) {
  const p = f.properties;
  const [lon, lat, depth] = f.geometry.coordinates;
  if (p.mag == null || lat == null || lon == null) continue;
  const d = new Date(p.time);
  const time = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  const place = p.place || '';
  let area = place.includes(', ') ? place.split(', ').pop() : place;
  area = AREA_FIX[area] || area || 'Unknown';
  rows.push([f.id, time, q(place), q(area), p.mag, depth ?? '', lat, lon,
    p.magType || '', p.type || '', p.sig ?? '', p.tsunami ? 'Yes' : 'No'].join(','));
}
writeFileSync(out, rows.join('\n') + '\n');
console.log(`${rows.length - 1} rows -> ${out}`);
