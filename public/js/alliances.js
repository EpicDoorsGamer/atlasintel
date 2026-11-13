// Alliances, blocs and groupings (ISO 3166-1 alpha-3 member codes).
// Membership as of late 2025. Update this list when a bloc gains or loses members.
// Only UN member/observer states are listed; blocs like the EU and African Union that are
// themselves members of the G20 are not countries, so they are noted instead.
window.ALLIANCES = [
  {
    id: 'nato', name: 'NATO', full: 'North Atlantic Treaty Organization', kind: 'Military alliance', since: 1949,
    members: ['ALB', 'BEL', 'BGR', 'CAN', 'HRV', 'CZE', 'DNK', 'EST', 'FIN', 'FRA', 'DEU', 'GRC', 'HUN', 'ISL', 'ITA', 'LVA',
      'LTU', 'LUX', 'MNE', 'NLD', 'MKD', 'NOR', 'POL', 'PRT', 'ROU', 'SVK', 'SVN', 'ESP', 'SWE', 'TUR', 'GBR', 'USA'],
  },
  {
    id: 'eu', name: 'EU', full: 'European Union', kind: 'Political & economic union', since: 1993,
    members: ['AUT', 'BEL', 'BGR', 'HRV', 'CYP', 'CZE', 'DNK', 'EST', 'FIN', 'FRA', 'DEU', 'GRC', 'HUN', 'IRL', 'ITA', 'LVA',
      'LTU', 'LUX', 'MLT', 'NLD', 'POL', 'PRT', 'ROU', 'SVK', 'SVN', 'ESP', 'SWE'],
  },
  {
    id: 'brics', name: 'BRICS', full: 'BRICS', kind: 'Emerging-economy forum', since: 2009,
    members: ['BRA', 'RUS', 'IND', 'CHN', 'ZAF', 'EGY', 'ETH', 'IRN', 'ARE', 'IDN'],
  },
  {
    id: 'g20', name: 'G20', full: 'Group of Twenty', kind: 'Major economies forum', since: 1999,
    members: ['ARG', 'AUS', 'BRA', 'CAN', 'CHN', 'FRA', 'DEU', 'IND', 'IDN', 'ITA', 'JPN', 'KOR', 'MEX', 'RUS', 'SAU', 'ZAF',
      'TUR', 'GBR', 'USA'],
    note: 'The EU and the African Union are also members.',
  },
  {
    id: 'g7', name: 'G7', full: 'Group of Seven', kind: 'Advanced economies forum', since: 1975,
    members: ['CAN', 'FRA', 'DEU', 'ITA', 'JPN', 'GBR', 'USA'],
    note: 'The EU also takes part.',
  },
  {
    id: 'opec', name: 'OPEC', full: 'Organization of the Petroleum Exporting Countries', kind: 'Oil cartel', since: 1960,
    members: ['DZA', 'COG', 'GNQ', 'GAB', 'IRN', 'IRQ', 'KWT', 'LBY', 'NGA', 'SAU', 'ARE', 'VEN'],
  },
  {
    id: 'asean', name: 'ASEAN', full: 'Association of Southeast Asian Nations', kind: 'Regional organization', since: 1967,
    members: ['BRN', 'KHM', 'IDN', 'LAO', 'MYS', 'MMR', 'PHL', 'SGP', 'THA', 'VNM', 'TLS'],
  },
  {
    id: 'au', name: 'AU', full: 'African Union', kind: 'Continental union', since: 2002,
    members: ['DZA', 'AGO', 'BEN', 'BWA', 'BFA', 'BDI', 'CPV', 'CMR', 'CAF', 'TCD', 'COM', 'COG', 'COD', 'CIV', 'DJI', 'EGY',
      'GNQ', 'ERI', 'SWZ', 'ETH', 'GAB', 'GMB', 'GHA', 'GIN', 'GNB', 'KEN', 'LSO', 'LBR', 'LBY', 'MDG', 'MWI', 'MLI', 'MRT',
      'MUS', 'MAR', 'MOZ', 'NAM', 'NER', 'NGA', 'RWA', 'STP', 'SEN', 'SYC', 'SLE', 'SOM', 'ZAF', 'SSD', 'SDN', 'TZA', 'TGO',
      'TUN', 'UGA', 'ZMB', 'ZWE'],
    note: 'The Sahrawi Arab Democratic Republic (not a UN member) is also a member. Some members are currently suspended.',
  },
  {
    id: 'gcc', name: 'GCC', full: 'Gulf Cooperation Council', kind: 'Regional union', since: 1981,
    members: ['BHR', 'KWT', 'OMN', 'QAT', 'SAU', 'ARE'],
  },
  {
    id: 'sco', name: 'SCO', full: 'Shanghai Cooperation Organisation', kind: 'Security & economic organization', since: 2001,
    members: ['CHN', 'IND', 'RUS', 'PAK', 'KAZ', 'KGZ', 'TJK', 'UZB', 'IRN', 'BLR'],
  },
  {
    id: 'fiveeyes', name: 'FIVE EYES', full: 'Five Eyes intelligence alliance', kind: 'Intelligence alliance', since: 1946,
    members: ['AUS', 'CAN', 'NZL', 'GBR', 'USA'],
  },
  {
    id: 'quad', name: 'QUAD', full: 'Quadrilateral Security Dialogue', kind: 'Strategic dialogue', since: 2007,
    members: ['AUS', 'IND', 'JPN', 'USA'],
  },
  {
    id: 'usmca', name: 'USMCA', full: 'United States–Mexico–Canada Agreement', kind: 'Trade agreement', since: 2020,
    members: ['USA', 'MEX', 'CAN'],
  },
];
