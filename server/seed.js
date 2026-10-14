// Transcribed from the supplied AFTER 8 menu (PDF pages 2-4 as phone screenshots).
// Page 1 (Hot Coffee / Filter Coffee / Iced Coffee) was NOT supplied: those categories are created empty.
// p = whole EGP price as printed; p:null = illegible/ambiguous (shown to customers as "ask at the counter").
// rn = owner-facing review note. Arabic names are DRAFTS written for this build and must be reviewed.
const P1 = 'Page 1 of the 4-page menu was not supplied, so this category has no items yet. Add them here.';

export const CATEGORIES = [
  { slug: 'hot-coffee', en: 'Hot Coffee', ar: 'قهوة ساخنة', note: P1, items: [] },
  { slug: 'filter-coffee', en: 'Filter Coffee', ar: 'قهوة فلتر', note: P1, items: [] },
  { slug: 'iced-coffee', en: 'Iced Coffee', ar: 'قهوة مثلجة', note: P1, items: [] },
  { slug: 'smoothies', en: 'Smoothies', ar: 'سموذي', note: 'Printed as "SMOTHIE" on the menu; heading spelling corrected.', items: [
    { en: 'Passion Mango', ar: 'باشن مانجو', p: 140 },
    { en: 'Peach Passion', ar: 'بيتش باشن', p: 140 },
    { en: 'Berry Burst', ar: 'بيري بيرست', p: 150 },
  ]},
  { slug: 'milkshakes', en: 'Milkshakes', ar: 'ميلك شيك', note: '', items: [
    { en: 'Vanilla Milkshake', ar: 'ميلك شيك فانيليا', p: 120 },
    { en: 'Strawberry Milkshake', ar: 'ميلك شيك فراولة', p: 120 },
    { en: 'Mango Milkshake', ar: 'ميلك شيك مانجو', p: 120 },
    { en: 'Spiced Mango Milkshake', ar: 'ميلك شيك مانجو سبايسي', p: 140 },
    { en: 'Blueberry Milkshake', ar: 'ميلك شيك توت أزرق', p: 120, rn: 'Printed "BLUBERRY MILKSHAKE"; spelling corrected to Blueberry. Confirm.' },
    { en: 'Peach Milkshake', ar: 'ميلك شيك خوخ', p: 120 },
    { en: 'Passion Fruit Milkshake', ar: 'ميلك شيك باشن فروت', p: 120 },
    { en: 'Nutella Milkshake', ar: 'ميلك شيك نوتيلا', p: 140 },
    { en: 'Lotus Milkshake', ar: 'ميلك شيك لوتس', p: 140 },
    { en: 'Kinder Milkshake', ar: 'ميلك شيك كيندر', p: 140 },
    { en: 'Pistachio Milkshake', ar: 'ميلك شيك فستق', p: 160 },
    { en: 'Oreo Milkshake', ar: 'ميلك شيك أوريو', p: 140 },
  ]},
  { slug: 'coffee-frappe', en: 'Coffee Frappe', ar: 'قهوة فرابيه', note: '', items: [
    { en: 'Frappé Latte', ar: 'فرابيه لاتيه', p: 120 },
    { en: 'Frappé Spanish', ar: 'فرابيه سبانش', p: 135 },
    { en: 'Frappé Mocha', ar: 'فرابيه موكا', p: 135 },
    { en: 'Frappé White Mocha', ar: 'فرابيه وايت موكا', p: 135 },
    { en: 'Frappé Salted Caramel', ar: 'فرابيه كراميل مملح', p: 135 },
    { en: 'Frappé Caramel', ar: 'فرابيه كراميل', p: 135 },
    { en: 'Frappé Pistachio', ar: 'فرابيه فستق', p: 160 },
  ]},
  { slug: 'matcha-corner', en: 'Matcha Corner', ar: 'ركن الماتشا', note: 'Rows are tightly spaced in the screenshot; two prices overlap (see Iced Blueberry Matcha and Cloud Matcha).', items: [
    { en: 'Hot Matcha Latte', ar: 'ماتشا لاتيه ساخن', p: 130 },
    { en: 'Iced Matcha Latte', ar: 'ماتشا لاتيه مثلج', p: 135 },
    { en: 'Iced Strawberry Matcha', ar: 'ماتشا فراولة مثلج', p: 145 },
    { en: 'Iced Spicy Mango Matcha', ar: 'ماتشا مانجو سبايسي مثلج', p: 145 },
    { en: 'Iced Blueberry Matcha', ar: 'ماتشا توت أزرق مثلج', p: null, rn: 'Prices 145 and 150 overlap beside Iced Blueberry Matcha and Cloud Matcha; one belongs to each but the screenshot does not show which. Enter the correct price.' },
    { en: 'Cloud Matcha', ar: 'كلاود ماتشا', p: null, rn: 'Prices 145 and 150 overlap beside Iced Blueberry Matcha and Cloud Matcha; one belongs to each but the screenshot does not show which. Enter the correct price.' },
    { en: 'Frappé Matcha Latte', ar: 'فرابيه ماتشا لاتيه', p: 140 },
    { en: 'Frappé Strawberry Matcha', ar: 'فرابيه ماتشا فراولة', p: 150 },
    { en: 'Frappé Spiced Mango Matcha', ar: 'فرابيه ماتشا مانجو سبايسي', p: 150 },
    { en: 'Frappé Blueberry Matcha', ar: 'فرابيه ماتشا توت أزرق', p: 150 },
  ]},
  { slug: 'mojito', en: 'Mojito', ar: 'موهيتو', note: '', items: [
    { en: 'Mojito Classic', ar: 'موهيتو كلاسيك', p: 110 },
    { en: 'Mojito Peach Mojito', ar: 'موهيتو خوخ', p: 120, rn: 'Printed "MOJITO PEACH MOJITO" (word repeated). Kept as printed; confirm the intended name.' },
    { en: 'Passion Mojito', ar: 'موهيتو باشن', p: 120 },
    { en: 'Strawberry Mojito', ar: 'موهيتو فراولة', p: 120 },
    { en: 'Blueberry Mojito', ar: 'موهيتو توت أزرق', p: 120 },
    { en: 'Mojito Mango Spiced Breeze', ar: 'موهيتو مانجو سبايسي بريز', p: 130 },
    { en: 'Mojito Cocoberry', ar: 'موهيتو كوكوبيري', p: 130 },
    { en: 'Blue Coconut Mojito', ar: 'موهيتو بلو كوكونت', p: 130, nw: true },
  ]},
  { slug: 'iced-tea', en: 'Iced Tea', ar: 'شاي مثلج', note: '', items: [
    { en: 'Classic Ice Tea', ar: 'آيس تي كلاسيك', p: 90 },
    { en: 'Peach Ice Tea', ar: 'آيس تي خوخ', p: 100 },
    { en: 'Passion Ice Tea', ar: 'آيس تي باشن', p: 100 },
    { en: 'Mango Spiced Breeze Ice Tea', ar: 'آيس تي مانجو سبايسي بريز', p: 110 },
    { en: 'Blueberry Ice Tea', ar: 'آيس تي توت أزرق', p: 100 },
    { en: 'Strawberry Ice Tea', ar: 'آيس تي فراولة', p: 100 },
  ]},
  { slug: 'extras', en: 'Extras', ar: 'إضافات', note: 'The last row sits at the bottom edge of the page; confirm no further extras follow.', items: [
    { en: 'Caramel / Hazelnut / Vanilla Flavor', ar: 'نكهة كراميل / بندق / فانيليا', p: 30 },
    { en: 'Espresso Shot', ar: 'شوت إسبريسو', p: 30 },
    { en: 'Nutella / Kinder / Lotus', ar: 'نوتيلا / كيندر / لوتس', p: 40 },
    { en: 'Pistachio', ar: 'فستق', p: 45 },
    { en: 'Alpro Milk (Oat / Coconut / Almond)', ar: 'حليب ألبرو (شوفان / جوز هند / لوز)', p: 65, rn: 'Item text was partly covered by the page indicator in the screenshot; price 65 is legible. Confirm the milk options.' },
  ]},
  { slug: 'after-8-drinks', en: 'After 8 Drinks', ar: 'مشروبات أفتر 8', note: '', items: [
    { en: 'Palm Peach', ar: 'بالم بيتش', p: 130 },
    { en: 'Hibiscus', ar: 'كركديه', p: 110 },
    { en: 'Berry Burst', ar: 'بيري بيرست', p: 150, rn: 'Same name and price as the Smoothies item. Confirm it is meant to appear under After 8 Drinks too.' },
    { en: 'Mojito Blue Coconut', ar: 'موهيتو بلو كوكونت', p: 130, nw: true, rn: 'Same drink as "Blue Coconut Mojito" in Mojito (printed in a different word order). Confirm it is meant to appear twice.' },
  ]},
  { slug: 'food', en: 'Food', ar: 'الطعام', note: '', items: [
    { en: 'Smoked Turkey Sandwich (Ciabatta)', ar: 'ساندويتش تركي مدخن (سيباتا)', p: 180 },
    { en: 'Chicken Pesto Sandwich (Ciabatta)', ar: 'ساندويتش دجاج بيستو (سيباتا)', p: 200 },
    { en: 'Halloumi Sandwich (Ciabatta)', ar: 'ساندويتش حلومي (سيباتا)', p: 200 },
    { en: 'Tuna Sandwich (Baguette)', ar: 'ساندويتش تونة (باجيت)', p: 200 },
    { en: 'Smoked Beef Sandwich (Ciabatta)', ar: 'ساندويتش لحم مدخن (سيباتا)', p: 180 },
    { en: 'Salmon Sandwich (Bagel)', ar: 'ساندويتش سلمون (بيجل)', p: 265 },
    { en: 'Turkey Croissant', ar: 'كرواسون تركي', p: null, rn: 'The price column prints "17", then "0", then "120" for these two croissants (looks like 170 broken across two lines, plus 120). Not guessed. Enter the correct prices.' },
    { en: 'Mix Cheese Croissant', ar: 'كرواسون ميكس تشيز', p: null, rn: 'The price column prints "17", then "0", then "120" for these two croissants (looks like 170 broken across two lines, plus 120). Not guessed. Enter the correct prices.' },
  ]},
  { slug: 'bakery', en: 'Bakery', ar: 'المخبوزات', note: '', items: [
    { en: 'Plain Croissant', ar: 'كرواسون سادة', p: 100 },
    { en: 'Berry Danish Pastry', ar: 'بيري دانش', p: 165 },
    { en: 'Nutella Croissant', ar: 'كرواسون نوتيلا', p: 175 },
    { en: 'Pistachio Croissant', ar: 'كرواسون فستق', p: 190, rn: 'Printed "PISTACHIO CRIOSSANT"; spelling corrected. Confirm.' },
  ]},
  { slug: 'dessert', en: 'Dessert', ar: 'الحلويات', note: '', items: [
    { en: 'Berry Cheese Cake Jar', ar: 'بيري تشيز كيك جار', p: 165 },
    { en: 'Tiramisu', ar: 'تيراميسو', p: 150 },
    { en: 'Red Velvet Cake', ar: 'ريد فيلفت كيك', p: 140 },
    { en: 'London Cake', ar: 'لندن كيك', p: 165 },
    { en: 'Cookies', ar: 'كوكيز', p: 85 },
    { en: 'Brownies Cup', ar: 'براونيز كوب', p: 130 },
  ]},
];

export const DEFAULT_SETTINGS = {
  min_spend_egp: '0',               // owner sets the minimum bill that qualifies for a stamp
  cooldown_minutes: '240',          // blocks a second stamp for the same customer within this window
  redeem_requires_new_day: '1',     // reward is redeemable on a LATER day than the one it was earned
  tagline: 'The place where you feels like home', // as printed on the menu; see review notes
  reward_text_en: 'One free item from the reward list',
  reward_text_ar: 'منتج مجاني واحد من قائمة المكافآت',
};

export function seedIfEmpty(db) {
  const has = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
  if (!has) {
    const now = Date.now();
    const insCat = db.prepare('INSERT INTO categories (slug,name_en,name_ar,note,ar_reviewed,visible,sort) VALUES (?,?,?,?,0,1,?)');
    const insItem = db.prepare(`INSERT INTO items
      (category_id,name_en,name_ar,price,price_status,review_note,ar_reviewed,available,reward_eligible,is_new,sort,updated_at)
      VALUES (?,?,?,?,?,?,0,1,0,?,?,?)`);
    db.exec('BEGIN');
    CATEGORIES.forEach((c, ci) => {
      const id = insCat.run(c.slug, c.en, c.ar, c.note || '', ci).lastInsertRowid;
      c.items.forEach((it, ii) =>
        insItem.run(id, it.en, it.ar, it.p, it.p == null ? 'verify' : 'confirmed', it.rn || '', it.nw ? 1 : 0, ii, now));
    });
    db.exec('COMMIT');
  }
  const insSet = db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSet.run(k, v);
}
