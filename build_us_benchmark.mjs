import fs from 'node:fs/promises';

const categories = ['sodas', 'energy-drinks', 'yogurts', 'breakfast-cereals', 'snack-foods'];
const outDir = 'outputs/benchmark-us-2026-08-25';
const stamp = '2026-08-25';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
const compact = (v) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
async function fetchJson(url, timeout = 12000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), timeout);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': 'SugarCameraFood/1.0 (benchmark review; contact: review@example.com)' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
async function offCategory(category, page = 1) {
  const p = new URLSearchParams({ countries_tags_en: 'united-states', categories_tags_en: category, page: String(page), page_size: '10', sort_by: 'unique_scans_n', fields: 'code,product_name,product_name_en,brands,quantity,nutriments' });
  let j;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { j = await fetchJson(`https://world.openfoodfacts.org/api/v2/search?${p}`); break; }
    catch (e) { if (attempt === 3) throw e; await sleep(2200 * attempt); }
  }
  return (j.products || []).map((x) => ({
    category, gtin: compact(x.code), brand: compact(x.brands), visible: compact(x.product_name_en || x.product_name), pack: compact(x.quantity),
    kcal100: x.nutriments?.['energy-kcal_100g'] ?? '', sugar100: x.nutriments?.sugars_100g ?? '', protein100: x.nutriments?.proteins_100g ?? '',
    offUrl: x.code ? `https://world.openfoodfacts.org/product/${x.code}` : '',
  })).filter((x) => x.gtin && x.visible);
}
async function usdaByGtin(gtin) {
  const p = new URLSearchParams({ api_key: 'DEMO_KEY', query: gtin, pageSize: '1', dataType: 'Branded' });
  try {
    const j = await fetchJson(`https://api.nal.usda.gov/fdc/v1/foods/search?${p}`, 9000);
    const x = j.foods?.[0];
    if (!x) return { status: 'Not found', title: '', fdc: '', gtin: '', pack: '', kcal: '', sugar: '', protein: '', url: `https://fdc.nal.usda.gov/fdc-app.html#/food-search?query=${encodeURIComponent(gtin)}` };
    const n = Object.fromEntries((x.foodNutrients || []).map((i) => [i.nutrientName, i.value]));
    return { status: 'Found', title: compact(x.description), fdc: String(x.fdcId), gtin: compact(x.gtinUpc), pack: compact(x.packageWeight), kcal: n['Energy'] ?? '', sugar: n['Sugars, total including NLEA'] ?? '', protein: n['Protein'] ?? '', url: `https://fdc.nal.usda.gov/fdc-app.html#/food-details/${x.fdcId}/nutrients` };
  } catch (e) { return { status: 'Lookup error — retry', title: '', fdc: '', gtin: '', pack: '', kcal: '', sugar: '', protein: '', url: `https://fdc.nal.usda.gov/fdc-app.html#/food-search?query=${encodeURIComponent(gtin)}`, error: String(e.message || e) }; }
}
function aliasFor(row) {
  const aliases = new Set([row.visible, `${row.brand} ${row.visible}`].filter(Boolean));
  if (row.visible.toLowerCase().includes('coca-cola')) aliases.add(row.visible.replace(/coca-cola/ig, 'Coke'));
  if (row.visible.toLowerCase().includes('coke')) aliases.add(row.visible.replace(/coke/ig, 'Coca-Cola'));
  return [...aliases].join(' | ');
}
function flag(row) {
  const flags=[];
  if (!row.pack) flags.push('OFF pack size missing');
  if (!row.usda.fdc) flags.push(row.usda.status === 'Found' ? 'USDA record lacks FDC id' : 'USDA exact-GTIN lookup unresolved');
  if (row.usda.gtin && row.usda.gtin.replace(/^0+/, '') !== row.gtin.replace(/^0+/, '')) flags.push('USDA returned different GTIN');
  if (row.usda.pack && row.pack && row.usda.pack.toLowerCase() !== row.pack.toLowerCase()) flags.push('Pack-size mismatch');
  if (!row.sugar100 || !row.protein100) flags.push('OFF nutrition incomplete');
  return flags.join('; ') || 'No automatic conflict detected';
}

await fs.mkdir(outDir, { recursive: true });
const raw=[];
for (const category of categories) {
  for (const page of [1, 2, 3, 4]) {
    if (raw.length >= 55) break;
    try { raw.push(...await offCategory(category, page)); } catch (e) { console.error(`OFF ${category} page ${page}: ${e.message}`); }
    await sleep(1300);
  }
  if (raw.length >= 55) break;
}
const seen = new Set();
const rows = raw.filter((x) => !seen.has(x.gtin) && seen.add(x.gtin)).slice(0, 50);
for (let start=0; start<rows.length; start += 5) {
  await Promise.all(rows.slice(start, start + 5).map(async (row, offset) => {
    row.usda = await usdaByGtin(row.gtin);
    console.log(`USDA ${start + offset + 1}/${rows.length}: ${row.gtin} — ${row.usda.status}`);
  }));
  await fs.writeFile(`${outDir}/raw-source-results.json`, JSON.stringify(rows, null, 2));
  await sleep(1200);
}
const headers = ['#','US category (OFF)','Canonical name — proposed','Visible front-of-pack name (OFF)','Brand (OFF)','Flavour / variant — review','Pack size (OFF)','GTIN (OFF)','OFF availability','OFF nutrition: kcal/100g','OFF nutrition: sugars g/100g','OFF nutrition: protein g/100g','OFF source URL','USDA availability','USDA FDC ID','USDA returned title','USDA GTIN','USDA pack size','USDA nutrition: energy','USDA nutrition: sugars','USDA nutrition: protein','USDA source URL','Review status / ambiguity'];
const csv = [headers, ...rows.map((r, i) => [i+1,r.category,r.visible,r.visible,r.brand,'Needs human normalization',r.pack,r.gtin,'Found',r.kcal100,r.sugar100,r.protein100,r.offUrl,r.usda.status,r.usda.fdc,r.usda.title,r.usda.gtin,r.usda.pack,r.usda.kcal,r.usda.sugar,r.usda.protein,r.usda.url,flag(r)])].map((line) => line.map(esc).join(',')).join('\n');
await fs.writeFile(`${outDir}/us_sku_benchmark_review.csv`, csv);
const aliases = [['GTIN','Canonical name — proposed','Visible name','Aliases / variants detected','Reason for manual review','Source'], ...rows.map((r) => [r.gtin,r.visible,r.visible,aliasFor(r),flag(r),r.offUrl])].map((line) => line.map(esc).join(',')).join('\n');
await fs.writeFile(`${outDir}/us_sku_aliases_and_ambiguities.csv`, aliases);
await fs.writeFile(`${outDir}/README.md`, `# US SKU benchmark — review only\n\nGenerated ${stamp}. Scope: 50 high-scan US Open Food Facts candidates across soda, energy drinks, yogurt, breakfast cereal and snack foods. Selection uses OFF's \`unique_scans_n\` ordering as a popularity proxy, not retail sales.\n\n- Nothing in this folder was imported into production.\n- \`us_sku_benchmark_review.csv\` is the primary review table.\n- OFF nutrition values are reported per 100 g when supplied. USDA FoodData Central search values are reported as returned by the Branded Foods search response; do not assume a shared basis without a row-level label review.\n- A USDA \`Lookup error — retry\` is deliberately not treated as absence.\n- Flavour is intentionally marked \`Needs human normalization\`; wording on the pack remains the source of truth.\n`);
console.log(`Wrote ${rows.length} review rows to ${outDir}`);
