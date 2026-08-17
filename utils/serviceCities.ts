import { Op, Sequelize } from 'sequelize';

/**
 * Rajasthan service cities — keep in sync with FE `lib/service-cities.ts`.
 */
export const SERVICE_CITIES = [
  'Ajmer',
  'Alwar',
  'Banswara',
  'Baran',
  'Barmer',
  'Beawar',
  'Bharatpur',
  'Bhilwara',
  'Bikaner',
  'Bundi',
  'Chittorgarh',
  'Chomu',
  'Churu',
  'Dausa',
  'Dholpur',
  'Dungarpur',
  'Hanumangarh',
  'Jaipur',
  'Jaisalmer',
  'Jalore',
  'Jhalawar',
  'Jhunjhunu',
  'Jodhpur',
  'Karauli',
  'Kota',
  'Nagaur',
  'Pali',
  'Pratapgarh',
  'Rajsamand',
  'Sawai Madhopur',
  'Sikar',
  'Sirohi',
  'Sri Ganganagar',
  'Tonk',
  'Udaipur'
] as const;

export type ServiceCity = (typeof SERVICE_CITIES)[number];

export const normalizeCityName = (value: unknown): string =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ');

/** Parse `cities=Jaipur,Jodhpur` and/or repeated `city=`. */
export const parseCityFilter = (query: Record<string, unknown> | undefined): string[] => {
  if (!query) return [];
  const raw: unknown[] = [];
  const cities = query.cities ?? query.city;
  if (Array.isArray(cities)) raw.push(...cities);
  else if (cities !== undefined && cities !== null && cities !== '') raw.push(cities);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    for (const part of String(item).split(',')) {
      const city = normalizeCityName(part);
      if (!city) continue;
      const key = city.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(city);
    }
  }
  return out;
};

export const cityInFilterWhere = (cities: string[], column = 'city') => {
  const lowered = cities.map((c) => c.toLowerCase());
  return Sequelize.where(Sequelize.fn('LOWER', Sequelize.col(column)), { [Op.in]: lowered });
};
