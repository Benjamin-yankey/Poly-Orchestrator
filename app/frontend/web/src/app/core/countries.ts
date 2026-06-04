// Country reference data for the marketplace sell form.
//
// Each country drives three things in a listing:
//   • dial   — the phone prefix (e.g. +233) shown before the number field
//   • symbol/currency — the price currency (prices "follow the selected country")
//   • cities — the Location dropdown options
//
// There's no live geo API here, so this is a curated set of major cities per
// country rather than an exhaustive gazetteer. Add more entries/cities as needed.

export interface Country {
  name: string;
  iso: string; // ISO 3166-1 alpha-2
  dial: string; // international dial code, with leading +
  currency: string; // ISO 4217 code
  symbol: string; // display symbol
  cities: string[];
}

export const COUNTRIES: Country[] = [
  { name: 'Ghana', iso: 'GH', dial: '+233', currency: 'GHS', symbol: 'GH₵',
    cities: ['Accra', 'Kumasi', 'Tamale', 'Takoradi', 'Cape Coast', 'Sunyani', 'Koforidua', 'Ho', 'Wa', 'Bolgatanga', 'Tema', 'Techiman', 'Obuasi'] },
  { name: 'Nigeria', iso: 'NG', dial: '+234', currency: 'NGN', symbol: '₦',
    cities: ['Lagos', 'Abuja', 'Kano', 'Ibadan', 'Port Harcourt', 'Benin City', 'Kaduna', 'Enugu', 'Jos', 'Ilorin', 'Onitsha', 'Abeokuta'] },
  { name: 'Kenya', iso: 'KE', dial: '+254', currency: 'KES', symbol: 'KSh',
    cities: ['Nairobi', 'Mombasa', 'Kisumu', 'Nakuru', 'Eldoret', 'Thika', 'Malindi', 'Kitale', 'Garissa', 'Nyeri'] },
  { name: 'South Africa', iso: 'ZA', dial: '+27', currency: 'ZAR', symbol: 'R',
    cities: ['Johannesburg', 'Cape Town', 'Durban', 'Pretoria', 'Port Elizabeth', 'Bloemfontein', 'East London', 'Polokwane', 'Nelspruit', 'Kimberley'] },
  { name: 'Togo', iso: 'TG', dial: '+228', currency: 'XOF', symbol: 'CFA',
    cities: ['Lomé', 'Sokodé', 'Kara', 'Kpalimé', 'Atakpamé', 'Dapaong', 'Tsévié'] },
  { name: "Côte d'Ivoire", iso: 'CI', dial: '+225', currency: 'XOF', symbol: 'CFA',
    cities: ['Abidjan', 'Yamoussoukro', 'Bouaké', 'Daloa', 'Korhogo', 'San-Pédro', 'Man', 'Gagnoa'] },
  { name: 'Senegal', iso: 'SN', dial: '+221', currency: 'XOF', symbol: 'CFA',
    cities: ['Dakar', 'Touba', 'Thiès', 'Rufisque', 'Kaolack', 'Saint-Louis', 'Ziguinchor', 'Mbour'] },
  { name: 'Egypt', iso: 'EG', dial: '+20', currency: 'EGP', symbol: 'E£',
    cities: ['Cairo', 'Alexandria', 'Giza', 'Shubra El Kheima', 'Port Said', 'Suez', 'Luxor', 'Aswan', 'Mansoura'] },
  { name: 'Morocco', iso: 'MA', dial: '+212', currency: 'MAD', symbol: 'DH',
    cities: ['Casablanca', 'Rabat', 'Fez', 'Marrakech', 'Tangier', 'Agadir', 'Meknes', 'Oujda', 'Kenitra'] },
  { name: 'Ethiopia', iso: 'ET', dial: '+251', currency: 'ETB', symbol: 'Br',
    cities: ['Addis Ababa', 'Dire Dawa', 'Mekelle', 'Gondar', 'Adama', 'Hawassa', 'Bahir Dar', 'Jimma'] },
  { name: 'Tanzania', iso: 'TZ', dial: '+255', currency: 'TZS', symbol: 'TSh',
    cities: ['Dar es Salaam', 'Dodoma', 'Mwanza', 'Arusha', 'Mbeya', 'Morogoro', 'Tanga', 'Zanzibar City'] },
  { name: 'Uganda', iso: 'UG', dial: '+256', currency: 'UGX', symbol: 'USh',
    cities: ['Kampala', 'Gulu', 'Lira', 'Mbarara', 'Jinja', 'Mbale', 'Masaka', 'Entebbe'] },
  { name: 'Rwanda', iso: 'RW', dial: '+250', currency: 'RWF', symbol: 'FRw',
    cities: ['Kigali', 'Butare', 'Gitarama', 'Ruhengeri', 'Gisenyi', 'Musanze', 'Rwamagana'] },
  { name: 'United States', iso: 'US', dial: '+1', currency: 'USD', symbol: '$',
    cities: ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 'San Antonio', 'San Diego', 'Dallas', 'San Jose', 'Austin', 'Seattle', 'Boston', 'Atlanta', 'Miami'] },
  { name: 'Canada', iso: 'CA', dial: '+1', currency: 'CAD', symbol: 'C$',
    cities: ['Toronto', 'Montreal', 'Vancouver', 'Calgary', 'Edmonton', 'Ottawa', 'Winnipeg', 'Quebec City', 'Hamilton', 'Halifax'] },
  { name: 'United Kingdom', iso: 'GB', dial: '+44', currency: 'GBP', symbol: '£',
    cities: ['London', 'Manchester', 'Birmingham', 'Leeds', 'Glasgow', 'Liverpool', 'Bristol', 'Sheffield', 'Edinburgh', 'Cardiff', 'Belfast'] },
  { name: 'Ireland', iso: 'IE', dial: '+353', currency: 'EUR', symbol: '€',
    cities: ['Dublin', 'Cork', 'Limerick', 'Galway', 'Waterford', 'Drogheda', 'Dundalk'] },
  { name: 'Germany', iso: 'DE', dial: '+49', currency: 'EUR', symbol: '€',
    cities: ['Berlin', 'Hamburg', 'Munich', 'Cologne', 'Frankfurt', 'Stuttgart', 'Düsseldorf', 'Leipzig', 'Dortmund', 'Bremen'] },
  { name: 'France', iso: 'FR', dial: '+33', currency: 'EUR', symbol: '€',
    cities: ['Paris', 'Marseille', 'Lyon', 'Toulouse', 'Nice', 'Nantes', 'Strasbourg', 'Montpellier', 'Bordeaux', 'Lille'] },
  { name: 'Spain', iso: 'ES', dial: '+34', currency: 'EUR', symbol: '€',
    cities: ['Madrid', 'Barcelona', 'Valencia', 'Seville', 'Zaragoza', 'Málaga', 'Murcia', 'Palma', 'Bilbao'] },
  { name: 'Italy', iso: 'IT', dial: '+39', currency: 'EUR', symbol: '€',
    cities: ['Rome', 'Milan', 'Naples', 'Turin', 'Palermo', 'Genoa', 'Bologna', 'Florence', 'Venice', 'Verona'] },
  { name: 'Netherlands', iso: 'NL', dial: '+31', currency: 'EUR', symbol: '€',
    cities: ['Amsterdam', 'Rotterdam', 'The Hague', 'Utrecht', 'Eindhoven', 'Groningen', 'Tilburg', 'Almere'] },
  { name: 'Portugal', iso: 'PT', dial: '+351', currency: 'EUR', symbol: '€',
    cities: ['Lisbon', 'Porto', 'Amadora', 'Braga', 'Coimbra', 'Funchal', 'Faro'] },
  { name: 'United Arab Emirates', iso: 'AE', dial: '+971', currency: 'AED', symbol: 'د.إ',
    cities: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Al Ain', 'Ajman', 'Ras Al Khaimah', 'Fujairah'] },
  { name: 'Saudi Arabia', iso: 'SA', dial: '+966', currency: 'SAR', symbol: '﷼',
    cities: ['Riyadh', 'Jeddah', 'Mecca', 'Medina', 'Dammam', 'Khobar', 'Tabuk', 'Abha'] },
  { name: 'India', iso: 'IN', dial: '+91', currency: 'INR', symbol: '₹',
    cities: ['Mumbai', 'Delhi', 'Bangalore', 'Hyderabad', 'Chennai', 'Kolkata', 'Pune', 'Ahmedabad', 'Jaipur', 'Surat', 'Lucknow'] },
  { name: 'China', iso: 'CN', dial: '+86', currency: 'CNY', symbol: '¥',
    cities: ['Beijing', 'Shanghai', 'Guangzhou', 'Shenzhen', 'Chengdu', 'Wuhan', 'Hangzhou', 'Xian', 'Nanjing', 'Tianjin'] },
  { name: 'Japan', iso: 'JP', dial: '+81', currency: 'JPY', symbol: '¥',
    cities: ['Tokyo', 'Yokohama', 'Osaka', 'Nagoya', 'Sapporo', 'Fukuoka', 'Kobe', 'Kyoto', 'Kawasaki'] },
  { name: 'Australia', iso: 'AU', dial: '+61', currency: 'AUD', symbol: 'A$',
    cities: ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Gold Coast', 'Canberra', 'Newcastle', 'Hobart'] },
  { name: 'Brazil', iso: 'BR', dial: '+55', currency: 'BRL', symbol: 'R$',
    cities: ['São Paulo', 'Rio de Janeiro', 'Brasília', 'Salvador', 'Fortaleza', 'Belo Horizonte', 'Manaus', 'Curitiba', 'Recife'] },
];

const BY_NAME = new Map(COUNTRIES.map((c) => [c.name, c]));
const SYMBOL_BY_CURRENCY = new Map(COUNTRIES.map((c) => [c.currency, c.symbol]));

export function findCountry(name: string | undefined | null): Country | undefined {
  return name ? BY_NAME.get(name) : undefined;
}

// Symbol for a currency code (falls back to the code itself, e.g. "GHS ").
export function currencySymbol(code: string | undefined | null): string {
  if (!code) return '$';
  return SYMBOL_BY_CURRENCY.get(code) || code + ' ';
}

// Format a listing price with its currency symbol, e.g. "GH₵120.00".
export function formatPrice(amount: number | string, currency: string | undefined | null): string {
  const n = Number(amount) || 0;
  return `${currencySymbol(currency)}${n.toFixed(2)}`;
}
