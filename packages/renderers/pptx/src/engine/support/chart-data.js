/** OOXML chart caches and literals share the same indexed c:pt representation. */
const asArray = value => value == null ? [] : Array.isArray(value) ? value : [value];

const indexedPoints = cache => {
  const points = new Map();
  for (const point of asArray(cache?.['c:pt'])) {
    const rawIndex = point?.attrs?.idx;
    const index = typeof rawIndex === 'number' || /^\d+$/.test(String(rawIndex))
      ? Number(rawIndex) : NaN;
    if (Number.isSafeInteger(index) && index >= 0) {
      // Empty XML elements are represented as objects by the XML reader.
      // They denote an empty label/value, never the string '[object Object]'.
      const value = point['c:v'];
      points.set(index, value != null && typeof value === 'object' ? '' : value);
    }
  }
  return points;
};

const categoryLevels = source => {
  const cache = source?.['c:multiLvlStrRef']?.['c:multiLvlStrCache'];
  return cache ? asArray(cache['c:lvl']).map(indexedPoints) : undefined;
};
const levelLabel = (levels, index) => [...levels].reverse().map((points, reversedIndex) => {
  if (points.has(index)) return points.get(index);
  // Outer levels contain the first index of a spanning category; leaf gaps
  // remain empty instead of repeating the previous leaf label.
  if (reversedIndex === levels.length - 1) return '';
  const preceding = [...points.keys()].filter(key => key <= index).sort((a, b) => b - a)[0];
  return preceding === undefined ? '' : points.get(preceding);
}).filter(value => value != null && value !== '').join(' / ');

const readPoints = source => {
  const levels = categoryLevels(source);
  if (levels) {
    const indices = new Set(levels.flatMap(level => [...level.keys()]));
    return new Map([...indices].map(index => [index, levelLabel(levels, index)]));
  }
  const cache = source?.['c:strRef']?.['c:strCache'] ?? source?.['c:strLit'] ??
    source?.['c:numRef']?.['c:numCache'] ?? source?.['c:numLit'];
  return indexedPoints(cache);
};

const seriesKey = (item, index) => {
  const tx = item?.['c:tx'];
  const key = tx?.['c:v'] ?? readPoints(tx).get(0) ?? index;
  return typeof key === 'string' || typeof key === 'number' ? key : '';
};

const asNumber = value => {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function extractChartData(seriesNode) {
  const series = asArray(seriesNode);
  if (!series.length) return [];

  // Preserve the existing scatter message contract, while accepting numLit too.
  if (series.length === 1 && series[0]?.['c:xVal']) {
    const xs = readPoints(series[0]['c:xVal']);
    const ys = readPoints(series[0]['c:yVal']);
    const indices = [...new Set([...xs.keys(), ...ys.keys()])].sort((a, b) => a - b);
    return [indices.map(index => asNumber(xs.get(index))), indices.map(index => asNumber(ys.get(index)))];
  }

  const rows = series.map((item, index) => {
    const levels = categoryLevels(item?.['c:cat']);
    const categories = readPoints(item?.['c:cat']);
    const numbers = readPoints(item?.['c:val']);
    if (levels) for (const index of numbers.keys()) {
      if (!categories.has(index)) categories.set(index, levelLabel(levels, index));
    }
    return {
      key: seriesKey(item, index), categories, numbers, levels,
    };
  });
  // Align every series on the same category slots. Never allocate from untrusted
  // ptCount or idx: a sparse index of 2^32 must not create a giant JS array.
  const labels = new Map();
  const indices = new Set();
  for (const row of rows) {
    for (const [index, label] of row.categories) {
      if (!labels.has(index)) labels.set(index, label);
      indices.add(index);
    }
    for (const index of row.numbers.keys()) indices.add(index);
  }
  const ordered = [...indices].sort((a, b) => a - b);
  const xlabels = Object.fromEntries(ordered.map((index, position) => [position, labels.get(index) ?? String(index)]));
  return rows.map(row => ({
    key: row.key,
    values: ordered.map(index => ({ x: String(index), y: asNumber(row.numbers.get(index)) })),
    xlabels,
    ...(row.levels ? { categoryLevels: row.levels.map(level => Object.fromEntries(level)) } : {}),
  }));
}

/** A normalized model can represent every scatter series, unlike the legacy tuple. */
export function extractScatterSeries(seriesNode) {
  return asArray(seriesNode).map((item, index) => {
    const xs = readPoints(item?.['c:xVal']);
    const ys = readPoints(item?.['c:yVal']);
    const indices = [...new Set([...xs.keys(), ...ys.keys()])].sort((a, b) => a - b);
    return {
      key: seriesKey(item, index),
      values: indices.map(index => ({ x: asNumber(xs.get(index)), y: asNumber(ys.get(index)) })),
      xlabels: {},
    };
  });
}
