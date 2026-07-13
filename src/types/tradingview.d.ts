/**
 * Minimal typings for the subset of the TradingView Charting Library widget
 * that Coinalyze exposes as `window.chartWidget`. Only the methods this
 * project actually calls are declared; all were verified against the live
 * site. See https://www.tradingview.com/charting-library-docs/ for the full
 * surface.
 */

export interface StudyInfo {
  id: string;
  name: string;
}

export interface TvChart {
  symbol(): string;
  setSymbol(symbol: string, callback?: () => void): void;
  resolution(): string;
  setResolution(resolution: string, callback?: () => void): void;
  getAllStudies(): StudyInfo[];
  removeAllStudies(): void;
  removeEntity(entityId: string): void;
  createStudy(
    name: string,
    forceOverlay?: boolean,
    lock?: boolean,
    inputs?: unknown[],
  ): Promise<string | null>;
}

export interface TvWidget {
  onChartReady(callback: () => void): void;
  activeChart(): TvChart;
  getIntervals(): string[];
  getStudiesList(): Promise<string[]>;
  takeClientScreenshot(): Promise<HTMLCanvasElement>;
}

declare global {
  interface Window {
    chartWidget?: TvWidget;
  }
}

export {};
