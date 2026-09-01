export interface MetaGeographyTarget {
  city: string;
  radius: number;
}

export function parseMetaGeography(
  geography: string,
  defaultRadius: number,
): MetaGeographyTarget[] {
  if (!Number.isInteger(defaultRadius) || defaultRadius < 1 || defaultRadius > 80) {
    throw new Error('GEOGRAPHY_RADIUS_INVALID');
  }
  const segments = geography
    .split(/\s*;\s*|\s+e\s+/i)
    .map((item) => item.trim())
    .filter(Boolean);
  if (segments.length < 1 || segments.length > 20) throw new Error('GEOGRAPHY_INVALID');

  const targets: MetaGeographyTarget[] = [];
  const seen = new Set<string>();
  for (const segment of segments) {
    const radiusMatch = segment.match(/\(\s*(\d{1,2})\s*km\s*\)\s*$/i);
    const radius = radiusMatch ? Number(radiusMatch[1]) : defaultRadius;
    if (!Number.isInteger(radius) || radius < 1 || radius > 80) {
      throw new Error('GEOGRAPHY_RADIUS_INVALID');
    }
    const city = segment
      .replace(/\(\s*\d{1,2}\s*km\s*\)\s*$/i, '')
      .replace(/,\s*(?:BR|Brasil|Brazil)\s*$/i, '')
      .replace(/(?:,|[-/])\s*[A-Z]{2}\s*$/i, '')
      .trim();
    if (!city || city.length > 120) throw new Error('GEOGRAPHY_INVALID');
    const dedupeKey = city.toLocaleLowerCase('pt-BR');
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    targets.push({ city, radius });
  }
  if (targets.length < 1 || targets.length > 20) throw new Error('GEOGRAPHY_INVALID');
  return targets;
}
