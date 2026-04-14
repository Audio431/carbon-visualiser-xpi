/// <reference types="jest" />
// IDE does not automatically resolve tsconfig.test.json for test files.
// This directive provides Jest type definitions to suppress editor warnings.

import { AggregationService } from './aggregation-service';
import type { NetworkEntryPayload } from '../../common/network.types';

function mockNetworkEntry(overrides: Partial<NetworkEntryPayload> = {}): NetworkEntryPayload {
    return {
        url: 'https://example.com/script.js',
        initiatorType: 'script',
        transferSize: 5000,
        encodedBodySize: 4800,
        decodedBodySize: 12000,
        timings: {
            all: 150,
            dns: 10,
            connect: 30,
            send: 5,
            wait: 45,
            receive: 60,
            ssl: 20,
        },
        ...overrides,
    };
}

function mockCpuMessage(overrides: Partial<{ tabId: string; title: string; pid: number; outerWindowID: number; cpuUsage: number; isBackground: boolean }> = {}) {
    return {
        tabInfo: {
            pid: overrides.pid ?? 1234,
            title: overrides.title ?? 'Example Page',
            outerWindowID: overrides.outerWindowID ?? 1,
            tabId: overrides.tabId ?? 'tab-1',
        },
        cpuUsage: overrides.cpuUsage ?? 1_000_000,
        isBackground: overrides.isBackground ?? false,
    };
}

describe('AggregationService', () => {
    let service: AggregationService;

    beforeEach(() => {
        service = new AggregationService();
    });

    describe('processCpuData', () => {
        it('stores cpu data grouped by tab id', () => {
            service.processCpuData(mockCpuMessage({ tabId: 'tab-1', cpuUsage: 100 }));
            service.processCpuData(mockCpuMessage({ tabId: 'tab-1', cpuUsage: 200 }));
            service.processCpuData(mockCpuMessage({ tabId: 'tab-2', cpuUsage: 300 }));

            const result = service.getAggregatedDataPerTab();

            expect(result.has('tab-1')).toBe(true);
            expect(result.has('tab-2')).toBe(true);
            expect(result.get('tab-1')!.get('cpu_mean')).toBe(150); // (100+200)/2
            expect(result.get('tab-2')!.get('cpu_mean')).toBe(300);
        });
    });

    describe('processNetworkEntry', () => {
        it('stores network entries grouped by tab id', () => {
            service.processNetworkEntry('tab-1', mockNetworkEntry({ transferSize: 1000 }));
            service.processNetworkEntry('tab-1', mockNetworkEntry({ transferSize: 2000 }));
            service.processNetworkEntry('tab-2', mockNetworkEntry({ transferSize: 500 }));

            const result = service.getAggregatedDataPerTab();

            expect(result.get('tab-1')!.get('network_total_transfer_size')).toBe(3000);
            expect(result.get('tab-1')!.get('network_request_count')).toBe(2);
            expect(result.get('tab-2')!.get('network_total_transfer_size')).toBe(500);
            expect(result.get('tab-2')!.get('network_request_count')).toBe(1);
        });
    });

    describe('getAggregatedDataPerTab', () => {
        it('calculates correct cpu statistics', () => {
            service.processCpuData(mockCpuMessage({ tabId: 'tab-1', cpuUsage: 10 }));
            service.processCpuData(mockCpuMessage({ tabId: 'tab-1', cpuUsage: 20 }));
            service.processCpuData(mockCpuMessage({ tabId: 'tab-1', cpuUsage: 30 }));

            const result = service.getAggregatedDataPerTab();
            const tab = result.get('tab-1')!;

            expect(tab.get('cpu_mean')).toBe(20);
            expect(tab.get('cpu_median')).toBe(20);
            expect(tab.get('title')).toBe('Example Page');
            expect(tab.get('pid')).toBe(1234);
        });

        it('calculates correct network timing aggregations', () => {
            service.processNetworkEntry('tab-1', mockNetworkEntry({
                transferSize: 1000,
                timings: { all: 100, dns: 5, connect: 10, send: 5, wait: 50, receive: 30, ssl: 0 },
            }));
            service.processNetworkEntry('tab-1', mockNetworkEntry({
                transferSize: 2000,
                timings: { all: 200, dns: 10, connect: 20, send: 10, wait: 100, receive: 60, ssl: 0 },
            }));

            const result = service.getAggregatedDataPerTab();
            const tab = result.get('tab-1')!;

            expect(tab.get('network_total_time')).toBe(300);
            expect(tab.get('network_time_wait')).toBe(150);
            expect(tab.get('network_time_receive')).toBe(90);
            expect(tab.get('network_avg_time')).toBe(150);
            expect(tab.get('network_transfer_rate')).toBe(3000 / 300);
        });

        it('returns empty map when no data', () => {
            const result = service.getAggregatedDataPerTab();
            expect(result.size).toBe(0);
        });

        it('handles median for even number of entries', () => {
            service.processCpuData(mockCpuMessage({ tabId: 'tab-1', cpuUsage: 10 }));
            service.processCpuData(mockCpuMessage({ tabId: 'tab-1', cpuUsage: 20 }));

            const result = service.getAggregatedDataPerTab();
            expect(result.get('tab-1')!.get('cpu_median')).toBe(15);
        });

        it('handles median for odd number of entries', () => {
            service.processCpuData(mockCpuMessage({ tabId: 'tab-1', cpuUsage: 10 }));
            service.processCpuData(mockCpuMessage({ tabId: 'tab-1', cpuUsage: 20 }));
            service.processCpuData(mockCpuMessage({ tabId: 'tab-1', cpuUsage: 30 }));

            const result = service.getAggregatedDataPerTab();
            expect(result.get('tab-1')!.get('cpu_median')).toBe(20);
        });
    });

    describe('clearData', () => {
        it('clears all stored data', () => {
            service.processCpuData(mockCpuMessage());
            service.processNetworkEntry('tab-1', mockNetworkEntry());

            service.clearData();

            const result = service.getAggregatedDataPerTab();
            expect(result.size).toBe(0);
        });
    });
});