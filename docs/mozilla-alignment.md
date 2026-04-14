# Carbon Visualiser: Alignment with Mozilla Sustainability Goals

## Context

Mozilla's Sustainability Program explores how to reduce emissions and advance a more sustainable internet. The [Projects/Sustainability/Ideas](https://wiki.mozilla.org/Projects/Sustainability/Ideas) wiki captures brainstormed concepts for browser-level environmental tools. Carbon Visualiser implements several of these ideas as a working Firefox extension.

## Alignment

|Mozilla brainstorm idea|Carbon Visualiser implementation|
|---|---|
|"Compare power consumption and carbon footprint from browsing with peers"|Per-tab CPU and network metrics converted to CO₂ estimates, broken down by device vs. network contribution|
|"Show site meter over time"|Real-time tracking session with per-tab resource aggregation (mean, median, std of CPU time; total transfer size; request timing breakdown)|
|"Trustmark icon with info about resources being used"|Sidebar panel showing live resource consumption and carbon source distribution chart|
|"Freeze-mode for website developers"|DevTools-free per-process CPU monitoring via `ChromeUtils.requestProcInfo()`, enabling developers to see which tabs consume the most resources|

## Why Privileged APIs

Standard WebExtension APIs cannot access system-level CPU metrics. The Performance API captures JavaScript execution timing but not actual process-level CPU utilisation, which is required for energy consumption calculations.

Carbon Visualiser uses two privileged APIs, both read-only:

- `ChromeUtils.requestProcInfo()` for per-process CPU time
- `Services.wm` for tab-to-process mapping

No browser state is modified. No user data leaves the browser. The extension makes zero requests to any developer-controlled server.

## Technical Validation

The extension was evaluated across five website categories (e-commerce, video streaming, news, cloud document editing, static content) with automated test scenarios. Key findings:

- Active browsing sessions consume up to 12x more CPU than idle tabs
- Video streaming shows the highest sustained CPU and transfer rates
- Static sites show minimal resource usage after initial page load
- Resource profiles are consistent across 1 to 20 minute intervals

Full methodology and results are documented in the accompanying dissertation (University of Glasgow, March 2025).

## Current Status

- Working prototype with local-only architecture (no external server)
- Firefox Developer Edition / Nightly compatible
- MPL-2.0 licensed
- Unit tested (network transform, aggregation service)

## What We Are Looking For

Guidance on whether this project aligns with Mozilla's product sustainability goals, and if so, whether there is a path to privileged signing through the `xpi-manifest` pipeline.
