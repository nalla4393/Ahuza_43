import { Country, State } from 'country-state-city';

export const countries = Country.getAllCountries().sort((a, b) => a.name.localeCompare(b.name));

export function regionsForCountry(country: string) {
  const match = countries.find((entry) => entry.name === country);
  return match ? State.getStatesOfCountry(match.isoCode).sort((a, b) => a.name.localeCompare(b.name)) : [];
}

export function isValidCountryRegion(country: string, region: string): boolean {
  if (!countries.some((entry) => entry.name === country)) return false;
  const regions = regionsForCountry(country);
  return regions.length ? regions.some((entry) => entry.name === region) : region === '';
}
