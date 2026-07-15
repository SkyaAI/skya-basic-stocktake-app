alter table stocktake_entries
  add column if not exists location text;

alter table products
  drop column if exists location;
