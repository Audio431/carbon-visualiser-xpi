import type { NetworkEntryPayload } from '../common/network.types';

/**
 * Transforms a PerformanceResourceTiming entry into a NetworkEntryPayload.
 * Extracts transfer sizes and granular timing breakdowns (DNS, connect,
 * TTFB, receive) from each request.
 *
 * Returns null for opaque cross-origin entries with zero transfer and duration.
 */
export function transformPerformanceEntry(entry: PerformanceResourceTiming): NetworkEntryPayload | null {
    if (entry.transferSize === 0 && entry.duration === 0) return null;

    return {
        url: entry.name,
        initiatorType: entry.initiatorType,
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
        decodedBodySize: entry.decodedBodySize,
        timings: {
            all: entry.duration,
            dns: entry.domainLookupEnd - entry.domainLookupStart,
            connect: entry.connectEnd - entry.connectStart,
            send: entry.requestStart > 0 ? entry.requestStart - entry.connectEnd : 0,
            wait: entry.responseStart > 0 ? entry.responseStart - entry.requestStart : 0,
            receive: entry.responseEnd > 0 ? entry.responseEnd - entry.responseStart : 0,
            ssl: entry.secureConnectionStart > 0 ? entry.connectEnd - entry.secureConnectionStart : 0,
        },
    };
}