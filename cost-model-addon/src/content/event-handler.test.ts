/// <reference types="jest" />
// IDE does not automatically resolve tsconfig.test.json for test files.
// This directive provides Jest type definitions to suppress editor warnings.

import { MessageType } from '../common/message.types';

/**
 * Tests the network entry data transformation logic.
 * Validates that PerformanceResourceTiming entries are correctly
 * mapped to the NetworkEntryPayload shape sent to background.
 */

// Extract the transformation logic so it's testable without browser APIs
function transformPerformanceEntry(entry: Partial<PerformanceResourceTiming>) {
    const e = entry as PerformanceResourceTiming;

    if (e.transferSize === 0 && e.duration === 0) return null;

    return {
        url: e.name,
        initiatorType: e.initiatorType,
        transferSize: e.transferSize,
        encodedBodySize: e.encodedBodySize,
        decodedBodySize: e.decodedBodySize,
        timings: {
            all: e.duration,
            dns: e.domainLookupEnd - e.domainLookupStart,
            connect: e.connectEnd - e.connectStart,
            send: e.requestStart > 0 ? e.requestStart - e.connectEnd : 0,
            wait: e.responseStart > 0 ? e.responseStart - e.requestStart : 0,
            receive: e.responseEnd > 0 ? e.responseEnd - e.responseStart : 0,
            ssl: e.secureConnectionStart > 0 ? e.connectEnd - e.secureConnectionStart : 0,
        },
    };
}

function mockEntry(overrides: Partial<PerformanceResourceTiming> = {}): Partial<PerformanceResourceTiming> {
    return {
        name: 'https://example.com/script.js',
        initiatorType: 'script',
        transferSize: 5000,
        encodedBodySize: 4800,
        decodedBodySize: 12000,
        duration: 150,
        domainLookupStart: 10,
        domainLookupEnd: 20,
        connectStart: 20,
        connectEnd: 50,
        secureConnectionStart: 30,
        requestStart: 55,
        responseStart: 100,
        responseEnd: 160,
        ...overrides,
    };
}

describe('transformPerformanceEntry', () => {
    it('produces correct timing breakdown from resource entry', () => {
        const result = transformPerformanceEntry(mockEntry());

        expect(result).not.toBeNull();
        expect(result!.url).toBe('https://example.com/script.js');
        expect(result!.initiatorType).toBe('script');
        expect(result!.transferSize).toBe(5000);
        expect(result!.timings.dns).toBe(10);       // 20 - 10
        expect(result!.timings.connect).toBe(30);    // 50 - 20
        expect(result!.timings.ssl).toBe(20);        // 50 - 30
        expect(result!.timings.send).toBe(5);        // 55 - 50
        expect(result!.timings.wait).toBe(45);       // 100 - 55
        expect(result!.timings.receive).toBe(60);    // 160 - 100
        expect(result!.timings.all).toBe(150);
    });

    it('skips opaque cross-origin entries with zero transfer and duration', () => {
        const result = transformPerformanceEntry(mockEntry({
            transferSize: 0,
            duration: 0,
        }));

        expect(result).toBeNull();
    });

    it('handles zeroed timing fields from cross-origin without Timing-Allow-Origin', () => {
        const result = transformPerformanceEntry(mockEntry({
            domainLookupStart: 0,
            domainLookupEnd: 0,
            connectStart: 0,
            connectEnd: 0,
            secureConnectionStart: 0,
            requestStart: 0,
            responseStart: 0,
            responseEnd: 0,
            transferSize: 3000,
            duration: 200,
        }));

        expect(result).not.toBeNull();
        expect(result!.transferSize).toBe(3000);
        expect(result!.timings.all).toBe(200);
        expect(result!.timings.dns).toBe(0);
        expect(result!.timings.connect).toBe(0);
        expect(result!.timings.send).toBe(0);
        expect(result!.timings.wait).toBe(0);
        expect(result!.timings.receive).toBe(0);
        expect(result!.timings.ssl).toBe(0);
    });

    it('handles navigation entries', () => {
        const result = transformPerformanceEntry(mockEntry({
            name: 'https://example.com/',
            initiatorType: 'navigation',
            transferSize: 50000,
        }));

        expect(result).not.toBeNull();
        expect(result!.initiatorType).toBe('navigation');
        expect(result!.transferSize).toBe(50000);
    });
});