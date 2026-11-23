-- The lettering of a business's name and its menu's section titles, from four
-- chosen faces: classic (Playfair Display), roman (Cinzel), elegant
-- (Cormorant Garamond), modern (Jost).
alter table business_settings
  add column title_font text not null default 'classic' check (title_font in ('classic', 'roman', 'elegant', 'modern'));
