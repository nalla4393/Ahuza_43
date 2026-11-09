import { Country } from 'country-state-city';
import statesUrl from 'country-state-city/lib/assets/state.json?url';

export type AddressRegion = { name: string; isoCode: string; countryCode: string };

export const countries = Country.getAllCountries().sort((a, b) => a.name.localeCompare(b.name));

let statesRequest: Promise<AddressRegion[]> | undefined;

function isAddressRegion(value: unknown): value is AddressRegion {
  return Boolean(value && typeof value === 'object'
    && 'name' in value && typeof value.name === 'string'
    && 'isoCode' in value && typeof value.isoCode === 'string'
    && 'countryCode' in value && typeof value.countryCode === 'string');
}

async function getStates(): Promise<AddressRegion[]> {
  statesRequest ??= fetch(statesUrl).then(async (response) => {
    if (!response.ok) throw new Error(`Could not load address regions (${response.status})`);
    const data: unknown = await response.json();
    if (!Array.isArray(data) || !data.every(isAddressRegion)) throw new Error('Address region data is invalid');
    return data;
  });
  return statesRequest;
}

export async function regionsForCountry(country: string): Promise<AddressRegion[]> {
  const selectedCountry = countries.find((entry) => entry.name === country);
  if (!selectedCountry) return [];
  return (await getStates())
    .filter((region) => region.countryCode === selectedCountry.isoCode)
    .sort((a, b) => a.name.localeCompare(b.name));
}
