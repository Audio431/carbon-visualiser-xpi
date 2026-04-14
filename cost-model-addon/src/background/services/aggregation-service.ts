// src/background/services/aggregation-service.ts

import type { NetworkEntryPayload } from '../../common/network.types';

// ============================================
// Carbon Intensity API (to be swapped to Electricity Maps)
// ============================================

interface CarbonIntensityData {
    from: string;
    to: string;
    intensity: {
        forecast: number;
        actual?: number;
        index: string;
    };
}

interface RegionData extends CarbonIntensityData {
    dnoregion: string;
    shortname: string;
}

interface ImpactDetails {
    unit: string;
    description: string;
    embedded: { value: number; min: number; max: number; warnings: string[] };
    use: { value: number; min: number; max: number };
}

interface ImpactResponse {
    impacts: { gwp: ImpactDetails; adp: ImpactDetails; pe: ImpactDetails };
}

// ============================================
// External API calls
// ============================================

async function fetchCarbonIntensityData(): Promise<CarbonIntensityData[]> {
    try {
        const response = await fetch('https://api.carbonintensity.org.uk/intensity');
        const data = await response.json();
        return data.data;
    } catch (error) {
        console.error('Error fetching carbon intensity data:', error);
        return [];
    }
}

async function fetchCarbonIntensityDataForRegion(): Promise<RegionData[]> {
    try {
        const response = await fetch('https://api.carbonintensity.org.uk/regional');
        const data = await response.json();
        return data.data[0].regions.map((region: any) => ({
            from: data.data[0].from,
            to: data.data[0].to,
            intensity: region.intensity,
            dnoregion: region.dnoregion,
            shortname: region.shortname,
        }));
    } catch (error) {
        console.error('Error fetching carbon intensity data for region:', error);
        return [];
    }
}

async function fetchCloudInstanceImpacts(cloudInstance: string, timeWorkload: number): Promise<ImpactResponse> {
    const response = await fetch('https://api.boavizta.org/v1/cloud/instance?verbose=true&duration=1', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
            provider: 'aws',
            instance_type: cloudInstance,
            usage: { usage_location: 'GBR', time_workload: timeWorkload },
        }),
    });
    return response.json();
}

async function fetchCPUImpacts(cpuName: string, timeWorkload: number): Promise<any> {
    const response = await fetch('https://api.boavizta.org/v1/component/cpu?verbose=true&duration=1', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: cpuName,
            usage: { usage_location: 'GBR', time_workload: timeWorkload },
        }),
    });
    return response.json();
}

// ============================================
// Aggregation Service
// ============================================

export interface CpuEntry {
    title: string;
    pid: number;
    outerWindowID: number;
    cpuUsage: number;
    isBackground: boolean;
}


export interface CpuMessage {
    tabInfo: { pid: number; title: string; outerWindowID: number; tabId: string };
    cpuUsage: number;
    isBackground: boolean;
}

export class AggregationService {
    private static instance: AggregationService;

    public static getInstance(): AggregationService {
        if (!AggregationService.instance) {
            AggregationService.instance = new AggregationService();
        }
        return AggregationService.instance;
    }

    private cpuUsageMap = new Map<string, CpuEntry[]>();
    private networkDataMap = new Map<string, NetworkEntryPayload[]>();

    // Simple in-memory cache (background script lifetime = one tracking session)
    private carbonDataCache: { actualData: CarbonIntensityData[]; regionalData: RegionData[] } | null = null;
    private cpuPowerCache: number | null = null;
    private cloudPowerCache = new Map<string, ImpactDetails>();

    // TODO: make configurable via settings UI
    private cpuModel = '13-inch MacBook Air (M1 CPU) 256GB - 2020';
    private cpuWorkload = 10;
    private cloudInstance = 't2.medium';
    private cloudWorkload = 10;
    
    processCpuData(message: CpuMessage): void {
        const { tabId } = message.tabInfo;
        const entry: CpuEntry = {
            title: message.tabInfo.title,
            pid: message.tabInfo.pid,
            outerWindowID: message.tabInfo.outerWindowID,
            cpuUsage: message.cpuUsage,
            isBackground: message.isBackground,
        };

        const existing = this.cpuUsageMap.get(tabId);
        if (existing) {
            existing.push(entry);
        } else {
            this.cpuUsageMap.set(tabId, [entry]);
        }
    }

    processNetworkEntry(tabId: string, entry: NetworkEntryPayload): void {
        const existing = this.networkDataMap.get(tabId);
        if (existing) {
            existing.push(entry);
        } else {
            this.networkDataMap.set(tabId, [entry]);
        }
    }

    // ============================================
    // Carbon data fetching with simple cache
    // ============================================

    private async getCarbonData(): Promise<{ actualData: CarbonIntensityData[]; regionalData: RegionData[] }> {
        if (!this.carbonDataCache) {
            const [actualData, regionalData] = await Promise.all([
                fetchCarbonIntensityData(),
                fetchCarbonIntensityDataForRegion(),
            ]);
            this.carbonDataCache = { actualData, regionalData };
        }
        return this.carbonDataCache;
    }

    private async getCpuPowerConsumption(): Promise<number> {
        if (this.cpuPowerCache === null) {
            const result = await fetchCPUImpacts(this.cpuModel, this.cpuWorkload);
            this.cpuPowerCache = result.verbose.avg_power.value;
        }
        return this.cpuPowerCache!;
    }

    private async getCloudPowerConsumption(): Promise<ImpactDetails> {
        const cacheKey = `${this.cloudInstance}_${this.cloudWorkload}`;
        let cached = this.cloudPowerCache.get(cacheKey);
        if (!cached) {
            const result = await fetchCloudInstanceImpacts(this.cloudInstance, this.cloudWorkload);
            cached = result.impacts.pe;
            this.cloudPowerCache.set(cacheKey, cached);
        }
        return cached;
    }

    // ============================================
    // CO2 Emissions Calculations
    // Equations reference: dissertation section 5.3.2
    // ============================================

    /**
     * E_CPU = T_CPU × P_device × 10^-3 (equation 5.1)
     * CO2e = E_CPU × CI_actual (equation 5.3)
     */
    async convertCpuTimeToCO2Emissions(): Promise<Map<string, number>> {
        const result = new Map<string, number>();
        const devicePowerW = await this.getCpuPowerConsumption();
        const { actualData } = await this.getCarbonData();

        const totalCpuTimeNs = [...this.cpuUsageMap.values()]
            .flat()
            .reduce((total, entry) => total + entry.cpuUsage, 0);

        const totalCpuTimeHours = totalCpuTimeNs / 1e9 / 3600;
        const powerConsumptionKWh = (totalCpuTimeHours * devicePowerW) / 1000;

        if (actualData.length > 0 && actualData[0].intensity.actual !== undefined) {
            result.set('actual', powerConsumptionKWh * actualData[0].intensity.actual);
        }

        return result;
    }

    /**
     * E_network = [T_wait × P_datacenter + D_size × E_transmission] (equation 5.2)
     * CO2e = E_network × CI_region (equation 5.3)
     */
    async convertNetworkToCO2Emissions(): Promise<Map<string, number>> {
        const result = new Map<string, number>();
        const cloudPowerMJ = await this.getCloudPowerConsumption();
        const { actualData, regionalData } = await this.getCarbonData();

        const allEntries = [...this.networkDataMap.values()].flat();

        const totalWaitTimeMs = allEntries.reduce(
            (total, entry) => total + entry.timings.wait, 0
        );

        const totalTransferSize = allEntries.reduce(
            (total, entry) => total + entry.transferSize, 0
        );

        const totalTransferSizeGB = totalTransferSize / (1024 * 1024 * 1024);
        // Fixed-line broadband: 0.0065 kWh/GB (Aslan et al. 2018)
        const networkTransmissionKWh = totalTransferSizeGB * 0.065;

        const totalWaitTimeHours = totalWaitTimeMs / 1000 / 3600;
        const cloudPowerKW = cloudPowerMJ.use.value / 3.6;
        const cloudPowerKWh = cloudPowerKW * totalWaitTimeHours;

        const totalNetworkKWh = networkTransmissionKWh + cloudPowerKWh;

        if (actualData.length > 0 && actualData[0].intensity.actual !== undefined) {
            result.set('actual', totalNetworkKWh * actualData[0].intensity.actual);
        }

        regionalData.forEach(region => {
            result.set(region.shortname, totalNetworkKWh * region.intensity.forecast);
        });

        return result;
    }

    // ============================================
    // Per-tab aggregation
    // ============================================

    getAggregatedDataPerTab(): Map<string, Map<string, number | string>> {
        const aggregatedData = new Map<string, Map<string, number | string>>();

        // CPU data per tab
        this.cpuUsageMap.forEach((entries, tabId) => {
            const cpuValues = entries.map(e => e.cpuUsage);
            const sorted = [...cpuValues].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            const median = sorted.length % 2 !== 0
                ? sorted[mid]
                : (sorted[mid - 1] + sorted[mid]) / 2;
            const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
            const std = Math.sqrt(sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / sorted.length);

            const latest = entries[entries.length - 1];
            const tabMap = new Map<string, number | string>();
            tabMap.set('title', latest.title);
            tabMap.set('pid', latest.pid);
            tabMap.set('outerWindowID', latest.outerWindowID);
            tabMap.set('cpu_median', median);
            tabMap.set('cpu_mean', mean);
            tabMap.set('cpu_std', std);
            aggregatedData.set(tabId, tabMap);
        });

        // Network data per tab
        this.networkDataMap.forEach((entries, tabId) => {
            let tabMap = aggregatedData.get(tabId);
            if (!tabMap) {
                tabMap = new Map<string, number | string>();
                tabMap.set('title', new URL(entries[0].url).hostname);
                tabMap.set('pid', 0);
                tabMap.set('outerWindowID', 0);
                aggregatedData.set(tabId, tabMap);
            }

            let totalTransferSize = 0;
            let totalNetworkTime = 0;
            let totalSend = 0;
            let totalWait = 0;
            let totalReceive = 0;

            entries.forEach(entry => {
                totalTransferSize += entry.transferSize;
                totalNetworkTime += entry.timings.all;
                totalSend += entry.timings.send;
                totalWait += entry.timings.wait;
                totalReceive += entry.timings.receive;
            });

            const requestCount = entries.length;

            tabMap.set('network_request_count', requestCount);
            tabMap.set('network_total_transfer_size', totalTransferSize);
            tabMap.set('network_total_time', totalNetworkTime);
            tabMap.set('network_time_send', totalSend);
            tabMap.set('network_time_wait', totalWait);
            tabMap.set('network_time_receive', totalReceive);

            if (requestCount > 0) {
                tabMap.set('network_avg_time', totalNetworkTime / requestCount);
                tabMap.set('network_avg_time_send', totalSend / requestCount);
                tabMap.set('network_avg_time_wait', totalWait / requestCount);
                tabMap.set('network_avg_time_receive', totalReceive / requestCount);
            }

            if (totalNetworkTime > 0) {
                tabMap.set('network_transfer_rate', totalTransferSize / totalNetworkTime);
            }

            tabMap.set('timestamp', Date.now());
        });

        return aggregatedData;
    }

    clearData(): void {
        this.cpuUsageMap.clear();
        this.networkDataMap.clear();
        this.carbonDataCache = null;
        this.cpuPowerCache = null;
        this.cloudPowerCache.clear();
    }
}