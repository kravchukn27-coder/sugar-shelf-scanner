import fs from 'node:fs/promises';

const selections = [
  'Coca-Cola Classic 12 fl oz', 'Coca-Cola Zero Sugar 12 fl oz', 'Diet Coke 12 fl oz', 'Sprite Lemon Lime 12 fl oz', 'Fanta Orange 12 fl oz',
  'Pepsi Cola 12 fl oz', 'Pepsi Zero Sugar 12 fl oz', 'Mountain Dew 12 fl oz', 'Dr Pepper 12 fl oz', 'Canada Dry Ginger Ale 12 fl oz',
  'Gatorade Cool Blue 20 fl oz', 'Powerade Mountain Berry Blast 20 fl oz', 'Red Bull Energy Drink 8.4 fl oz', 'Monster Energy 16 fl oz', 'LaCroix Lime 12 fl oz',
  'Chobani Zero Sugar Strawberry 5.3 oz', 'Chobani Greek Yogurt Strawberry 5.3 oz', 'Yoplait Original Strawberry 6 oz', 'Oikos Triple Zero Vanilla 5.3 oz', 'Dannon Light and Fit Strawberry 5.3 oz',
  'Cheerios Original 8.9 oz', 'Honey Nut Cheerios 10.8 oz', 'Frosted Flakes 13.5 oz', 'Lucky Charms 10.5 oz', 'Cinnamon Toast Crunch 12 oz',
  'Nature Valley Crunchy Oats Honey 1.49 oz', 'KIND Dark Chocolate Nuts Sea Salt 1.4 oz', 'CLIF Bar Chocolate Chip 2.4 oz', 'Quaker Chewy Chocolate Chip 1.23 oz', 'Pop-Tarts Frosted Strawberry 3.67 oz',
  'Lay\'s Classic Potato Chips 1.5 oz', 'Doritos Nacho Cheese 1.75 oz', 'Cheetos Crunchy 1.5 oz', 'Pringles Original 2.36 oz', 'Ritz Original Crackers 13.7 oz',
  'Oreo Original Cookies 14.3 oz', 'Chips Ahoy Original 13 oz', 'Hershey Milk Chocolate Bar 1.55 oz', 'Reese\'s Peanut Butter Cups 1.5 oz', 'M&M\'s Milk Chocolate 1.69 oz',
  'Campbell\'s Chicken Noodle Soup 10.75 oz', 'Progresso Chicken Noodle Soup 19 oz', 'Kraft Macaroni Cheese 7.25 oz', 'Annie\'s Shells White Cheddar 6 oz', 'StarKist Chunk Light Tuna 2.6 oz',
  'Jif Creamy Peanut Butter 16 oz', 'Skippy Creamy Peanut Butter 16.3 oz', 'Nutella Hazelnut Spread 13 oz', 'Heinz Tomato Ketchup 20 oz', 'Kraft Original Macaroni Cheese 7.25 oz'
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (v) => typeof v === 'string' ? v.trim() : '';
const get = async (url) => {
  const r = await fetch(url, { headers: { 'User-Agent': 'SugarCameraFood benchmark/1.0 contact: review@example.com' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};
async function off(q) {
  const p = new URLSearchParams({ search_terms: q, search_simple: '1', action: 'process', json: '1', page_size: '1', fields: 'code,product_name,product_name_en,brands,quantity,nutriments' });
  const j = await get(`https://world.openfoodfacts.org/cgi/search.pl?${p}`);
  const x = j.products?.[0];
  if (!x?.code) return { availability: 'Not found', url: `https://world.openfoodfacts.org/cgi/search.pl?${p}`, raw: null };
  const n = x.nutriments || {};
  return { availability: 'Found', gtin: norm(x.code), brand: norm(x.brands), visible: norm(x.product_name_en || x.product_name), pack: norm(x.quantity), kcal100: n['energy-kcal_100g'] ?? null, sugar100: n.sugars_100g ?? null, protein100: n.proteins_100g ?? null, url: `https://world.openfoodfacts.org/product/${x.code}`, raw: x };
}
async function usda(q) {
  const p = new URLSearchParams({ api_key: 'DEMO_KEY', query: q, pageSize: '1', dataType: 'Branded' });
  const j = await get(`https://api.nal.usda.gov/fdc/v1/foods/search?${p}`);
  const x = j.foods?.[0];
  if (!x?.fdcId) return { availability: 'Not found', url: `https://fdc.nal.usda.gov/fdc-app.html#/food-search?query=${encodeURIComponent(q)}` };
  const nutrients = Object.fromEntries((x.foodNutrients || []).map((n) => [n.nutrientName, n.value]));
  return { availability: 'Found', fdcId: x.fdcId, title: norm(x.description), gtin: norm(x.gtinUpc), pack: norm(x.packageWeight), kcal100: nutrients['Energy'] ?? null, sugar100: nutrients['Sugars, total including NLEA'] ?? null, protein100: nutrients['Protein'] ?? null, url: `https://fdc.nal.usda.gov/fdc-app.html#/food-details/${x.fdcId}/nutrients` };
}
const results=[];
for (let i=0;i<selections.length;i++) {
  const q=selections[i];
  let a, b;
  try { a=await off(q); } catch(e) { a={availability:'Lookup error', error:String(e)}; }
  await sleep(650);
  try { b=await usda(q); } catch(e) { b={availability:'Lookup error', error:String(e)}; }
  results.push({index:i+1, query:q, off:a, usda:b});
  console.log(`${i+1}/50 ${q}: OFF ${a.availability}; USDA ${b.availability}`);
  await sleep(650);
}
await fs.mkdir('outputs/benchmark-us-2026-08-25', {recursive:true});
await fs.writeFile('outputs/benchmark-us-2026-08-25/raw-source-results.json', JSON.stringify(results,null,2));
