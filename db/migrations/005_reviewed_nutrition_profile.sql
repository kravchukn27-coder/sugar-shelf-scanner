-- Extends the reviewed nutrition contract with the remaining per-100g facts:
-- energy (kcal), fat and carbohydrates, alongside the existing sugar and
-- protein columns. Additive only; 003/004 already established this pattern
-- for catalog_proposals. All three are nullable because most currently
-- approved products have not yet had these values curator-verified against
-- the package — a null must render as "Not confirmed", never as zero.
ALTER TABLE nutrition_facts
  ADD COLUMN IF NOT EXISTS energy_kcal_per_100g numeric CHECK (energy_kcal_per_100g >= 0 AND energy_kcal_per_100g <= 2000),
  ADD COLUMN IF NOT EXISTS fat_per_100g numeric CHECK (fat_per_100g >= 0 AND fat_per_100g <= 100),
  ADD COLUMN IF NOT EXISTS carbohydrates_per_100g numeric CHECK (carbohydrates_per_100g >= 0 AND carbohydrates_per_100g <= 100);
