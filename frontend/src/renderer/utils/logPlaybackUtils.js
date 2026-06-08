export function normalizeSampleTimestamps(samples) {
  const rawTimestamps = samples.map((sample) => (
    typeof sample?.ts === 'number' && Number.isFinite(sample.ts) ? sample.ts :
    (sample?.ts && !Number.isNaN(parseFloat(sample.ts)) ? parseFloat(sample.ts) : null)
  ));
  const positiveTimestamps = rawTimestamps.filter((value) => value != null && value > 0);

  if (positiveTimestamps.length === 0) {
    return samples.map((_, index) => index * 100);
  }

  const epochLike = positiveTimestamps[0] > 1e8;
  const fallbackMs = positiveTimestamps[0] * 1000;
  let previousMs = fallbackMs;

  return rawTimestamps.map((value, index) => {
    let timestampMs;

    if (value == null) {
      timestampMs = index === 0 ? fallbackMs : previousMs;
    } else if (epochLike) {
      timestampMs = value > 0 ? value * 1000 : previousMs;
    } else {
      timestampMs = value * 1000;
    }

    if (!Number.isFinite(timestampMs)) {
      timestampMs = previousMs;
    }

    if (index > 0 && timestampMs < previousMs) {
      timestampMs = previousMs;
    }

    previousMs = timestampMs;
    return timestampMs;
  });
}

export function formatPlaybackTimestamp(timestampMs) {
  if (!timestampMs) return '--';
  return new Date(timestampMs).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatPlaybackSeconds(ms) {
  return `${(ms / 1000).toFixed(2)} s`;
}

export function clampPlayback(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function findClosestIndexByTimestamp(timestamps, target) {
  if (!timestamps.length) return 0;
  let bestIndex = 0;
  let bestDelta = Math.abs(timestamps[0] - target);
  for (let i = 1; i < timestamps.length; i += 1) {
    const delta = Math.abs(timestamps[i] - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = i;
    }
  }
  return bestIndex;
}

export function gMagnitude(sample, axKey, ayKey) {
  const ax = typeof sample?.[axKey] === 'number' ? sample[axKey] : 
             (sample?.[axKey] && !Number.isNaN(parseFloat(sample[axKey])) ? parseFloat(sample[axKey]) : null);
  const ay = typeof sample?.[ayKey] === 'number' ? sample[ayKey] : 
             (sample?.[ayKey] && !Number.isNaN(parseFloat(sample[ayKey])) ? parseFloat(sample[ayKey]) : null);
  if (ax == null || ay == null) return null;
  return Math.sqrt((ax * ax) + (ay * ay));
}

export function gToColor(magnitude) {
  if (magnitude == null || Number.isNaN(magnitude)) return '#6b7280';
  if (magnitude < 0.4) return '#7dd3fc';
  if (magnitude < 0.8) return '#34d399';
  if (magnitude < 1.2) return '#fbbf24';
  if (magnitude < 1.6) return '#fb7185';
  return '#f43f5e';
}
