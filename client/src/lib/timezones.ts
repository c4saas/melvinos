/**
 * Comprehensive list of IANA timezones for dropdowns.
 * Grouped by region for readability.
 */
export interface TimezoneOption {
  value: string;
  label: string;
}

export const TIMEZONES: TimezoneOption[] = [
  // US & Canada
  { value: 'America/New_York', label: 'Eastern Time (ET) — New York, Miami, Atlanta' },
  { value: 'America/Chicago', label: 'Central Time (CT) — Chicago, Dallas, Houston' },
  { value: 'America/Denver', label: 'Mountain Time (MT) — Denver, Phoenix, Salt Lake City' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT) — Los Angeles, Seattle, San Francisco' },
  { value: 'America/Anchorage', label: 'Alaska Time — Anchorage' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HT) — Honolulu' },
  { value: 'America/Toronto', label: 'Eastern Time — Toronto' },
  { value: 'America/Vancouver', label: 'Pacific Time — Vancouver' },
  { value: 'America/Winnipeg', label: 'Central Time — Winnipeg' },
  { value: 'America/Edmonton', label: 'Mountain Time — Edmonton' },
  { value: 'America/Halifax', label: 'Atlantic Time — Halifax' },
  { value: 'America/St_Johns', label: 'Newfoundland Time — St. John\'s' },
  // Mexico & Central America
  { value: 'America/Mexico_City', label: 'Mexico City' },
  { value: 'America/Monterrey', label: 'Monterrey, Mexico' },
  { value: 'America/Cancun', label: 'Cancun, Mexico' },
  { value: 'America/Guatemala', label: 'Guatemala City' },
  { value: 'America/Costa_Rica', label: 'San Jose, Costa Rica' },
  // South America
  { value: 'America/Bogota', label: 'Bogota, Colombia' },
  { value: 'America/Lima', label: 'Lima, Peru' },
  { value: 'America/Santiago', label: 'Santiago, Chile' },
  { value: 'America/Sao_Paulo', label: 'São Paulo, Brazil' },
  { value: 'America/Buenos_Aires', label: 'Buenos Aires, Argentina' },
  { value: 'America/Caracas', label: 'Caracas, Venezuela' },
  // Europe
  { value: 'Europe/London', label: 'London, UK (GMT/BST)' },
  { value: 'Europe/Dublin', label: 'Dublin, Ireland' },
  { value: 'Europe/Lisbon', label: 'Lisbon, Portugal' },
  { value: 'Europe/Paris', label: 'Paris, France (CET)' },
  { value: 'Europe/Berlin', label: 'Berlin, Germany' },
  { value: 'Europe/Amsterdam', label: 'Amsterdam, Netherlands' },
  { value: 'Europe/Brussels', label: 'Brussels, Belgium' },
  { value: 'Europe/Madrid', label: 'Madrid, Spain' },
  { value: 'Europe/Rome', label: 'Rome, Italy' },
  { value: 'Europe/Zurich', label: 'Zurich, Switzerland' },
  { value: 'Europe/Vienna', label: 'Vienna, Austria' },
  { value: 'Europe/Warsaw', label: 'Warsaw, Poland' },
  { value: 'Europe/Prague', label: 'Prague, Czech Republic' },
  { value: 'Europe/Budapest', label: 'Budapest, Hungary' },
  { value: 'Europe/Bucharest', label: 'Bucharest, Romania' },
  { value: 'Europe/Helsinki', label: 'Helsinki, Finland' },
  { value: 'Europe/Stockholm', label: 'Stockholm, Sweden' },
  { value: 'Europe/Oslo', label: 'Oslo, Norway' },
  { value: 'Europe/Copenhagen', label: 'Copenhagen, Denmark' },
  { value: 'Europe/Athens', label: 'Athens, Greece' },
  { value: 'Europe/Istanbul', label: 'Istanbul, Turkey' },
  { value: 'Europe/Kiev', label: 'Kyiv, Ukraine' },
  { value: 'Europe/Moscow', label: 'Moscow, Russia' },
  // Middle East & Africa
  { value: 'Asia/Dubai', label: 'Dubai, UAE' },
  { value: 'Asia/Riyadh', label: 'Riyadh, Saudi Arabia' },
  { value: 'Asia/Kuwait', label: 'Kuwait City' },
  { value: 'Asia/Beirut', label: 'Beirut, Lebanon' },
  { value: 'Asia/Jerusalem', label: 'Jerusalem, Israel' },
  { value: 'Africa/Cairo', label: 'Cairo, Egypt' },
  { value: 'Africa/Lagos', label: 'Lagos, Nigeria' },
  { value: 'Africa/Nairobi', label: 'Nairobi, Kenya' },
  { value: 'Africa/Johannesburg', label: 'Johannesburg, South Africa' },
  // Asia
  { value: 'Asia/Karachi', label: 'Karachi, Pakistan' },
  { value: 'Asia/Kolkata', label: 'Mumbai / Delhi, India (IST)' },
  { value: 'Asia/Dhaka', label: 'Dhaka, Bangladesh' },
  { value: 'Asia/Colombo', label: 'Colombo, Sri Lanka' },
  { value: 'Asia/Kathmandu', label: 'Kathmandu, Nepal' },
  { value: 'Asia/Almaty', label: 'Almaty, Kazakhstan' },
  { value: 'Asia/Tashkent', label: 'Tashkent, Uzbekistan' },
  { value: 'Asia/Bangkok', label: 'Bangkok, Thailand' },
  { value: 'Asia/Ho_Chi_Minh', label: 'Ho Chi Minh City, Vietnam' },
  { value: 'Asia/Jakarta', label: 'Jakarta, Indonesia' },
  { value: 'Asia/Kuala_Lumpur', label: 'Kuala Lumpur, Malaysia' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Asia/Manila', label: 'Manila, Philippines' },
  { value: 'Asia/Shanghai', label: 'Beijing / Shanghai, China (CST)' },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong' },
  { value: 'Asia/Taipei', label: 'Taipei, Taiwan' },
  { value: 'Asia/Seoul', label: 'Seoul, South Korea' },
  { value: 'Asia/Tokyo', label: 'Tokyo, Japan' },
  // Oceania
  { value: 'Australia/Perth', label: 'Perth, Australia (AWST)' },
  { value: 'Australia/Adelaide', label: 'Adelaide, Australia (ACST)' },
  { value: 'Australia/Darwin', label: 'Darwin, Australia' },
  { value: 'Australia/Brisbane', label: 'Brisbane, Australia (AEST)' },
  { value: 'Australia/Sydney', label: 'Sydney / Melbourne, Australia (AEST)' },
  { value: 'Pacific/Auckland', label: 'Auckland, New Zealand' },
  { value: 'Pacific/Fiji', label: 'Fiji' },
  // UTC
  { value: 'UTC', label: 'UTC — Coordinated Universal Time' },
];

/** Get the label for a timezone value, falling back to the value itself */
export function getTimezoneLabel(value: string): string {
  return TIMEZONES.find((tz) => tz.value === value)?.label ?? value;
}
