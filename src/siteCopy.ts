const sentenceStops = /(?<![\p{L}\p{N}])\.|(?<=[\p{L}\p{N}])\.(?![\p{L}\p{N}])/gu;

export function removeSentenceFullStops<T>(value: T): T {
  if (typeof value === 'string') return value.replace(sentenceStops, '') as T;
  if (Array.isArray(value)) return value.map(removeSentenceFullStops) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, removeSentenceFullStops(entry)])) as T;
  }
  return value;
}
