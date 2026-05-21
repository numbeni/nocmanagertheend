/**
 * In-memory monitoring engine state.
 *  - Pause / resume flag
 *  - Sweep cancel signal
 *  - Live server-based sweep state (server, phase, site)
 *  - Confirmed-down site tracking across 3-phase sweep
 *  - SSL batch scan state
 * No DB required — resets on server restart (intentional).
 */

let _paused = false;
let _pausedAt: Date | null = null;
let _resumedAt: Date | null = null;

let _sweepCancelRequested = false;

// ── Per-site current target (within a server check) ──────────────────────────
let _currentSiteId: number | null = null;
let _currentSiteName: string | null = null;
let _currentStep: string | null = null;
let _currentStartedAt: Date | null = null;

// ── Server-based sweep live state ─────────────────────────────────────────────
let _currentServerId: number | null = null;
let _currentServerName: string | null = null;
type SweepPhase = "idle" | "blocked" | "first_pass" | "second_pass" | "final_recheck" | "cooldown";
let _currentPhase: SweepPhase = "idle";
let _confirmedDownSiteIds: number[] = [];
let _cooldownEndsAt: Date | null = null;

// ── Phase progress counters ───────────────────────────────────────────────────
let _currentPhaseTotal = 0;
let _currentPhaseDone = 0;

// ── Sweep metrics ─────────────────────────────────────────────────────────────
let _lastSweepStartedAt: Date | null = null;
let _lastSweepCompletedAt: Date | null = null;
let _lastSweepDurationMs: number | null = null;
let _lastSweepCheckedCount = 0;

// ── Monitor interval (ms) — kept in sync with the scheduler ──────────────────
let _monitorIntervalMs = 120_000;

export function setMonitorIntervalMs(ms: number): void {
  _monitorIntervalMs = ms;
}

// ── SSL batch scan state ──────────────────────────────────────────────────────
let _sslScanInFlight = false;
let _sslScanStatus: "idle" | "running" | "waiting" = "idle";
let _sslScanLastStartedAt: Date | null = null;
let _sslScanLastCompletedAt: Date | null = null;
let _sslScanDone = 0;
let _sslScanTotal = 0;
let _sslScanNextAt: Date | null = null;

/** True when the monitoring sweep is actively running. */
let _monitoringSweepInFlight = false;

// ── Pause / resume ────────────────────────────────────────────────────────────

export function isMonitoringPaused(): boolean {
  return _paused;
}

export function pauseMonitoring(): void {
  _paused = true;
  _pausedAt = new Date();
  _sweepCancelRequested = true;
}

export function resumeMonitoring(): void {
  _paused = false;
  _resumedAt = new Date();
  _sweepCancelRequested = false;
}

export function requestSweepCancel(): void {
  _sweepCancelRequested = true;
}

export function clearSweepCancel(): void {
  _sweepCancelRequested = false;
}

export function isSweepCancelRequested(): boolean {
  return _sweepCancelRequested;
}

// ── Sweep lifecycle ───────────────────────────────────────────────────────────

export function markSweepStarted(): void {
  _lastSweepStartedAt = new Date();
  _lastSweepCompletedAt = null;
  _lastSweepDurationMs = null;
  _lastSweepCheckedCount = 0;
}

export function markSweepCompleted(checkedCount: number): void {
  _lastSweepCompletedAt = new Date();
  _lastSweepCheckedCount = checkedCount;
  _lastSweepDurationMs = _lastSweepStartedAt
    ? _lastSweepCompletedAt.getTime() - _lastSweepStartedAt.getTime()
    : null;
  _currentSiteId = null;
  _currentSiteName = null;
  _currentStep = null;
  _currentStartedAt = null;
}

// ── Per-site current target ───────────────────────────────────────────────────

export function setCurrentTarget(siteId: number, siteName: string, step: string): void {
  _currentSiteId = siteId;
  _currentSiteName = siteName;
  _currentStep = step;
  _currentStartedAt = new Date();
}

export function clearCurrentTarget(): void {
  _currentSiteId = null;
  _currentSiteName = null;
  _currentStep = null;
  _currentStartedAt = null;
}

// ── Server sweep state ────────────────────────────────────────────────────────

export function setCurrentServer(id: number, name: string): void {
  _currentServerId = id;
  _currentServerName = name;
}

export function clearCurrentServer(): void {
  _currentServerId = null;
  _currentServerName = null;
}

export function setCurrentPhase(phase: SweepPhase): void {
  _currentPhase = phase;
  _currentPhaseTotal = 0;
  _currentPhaseDone = 0;
}

export function setCurrentPhaseProgress(done: number, total: number): void {
  _currentPhaseDone = done;
  _currentPhaseTotal = total;
}

export function updateConfirmedDownSiteIds(ids: number[]): void {
  _confirmedDownSiteIds = [...ids];
}

export function getConfirmedDownSiteIds(): number[] {
  return _confirmedDownSiteIds;
}

export function setCooldownEndsAt(date: Date | null): void {
  _cooldownEndsAt = date;
}

// ── Sweep in-flight flag ──────────────────────────────────────────────────────

export function setMonitoringSweepInFlight(v: boolean): void {
  _monitoringSweepInFlight = v;
}

export function isMonitoringSweepInFlight(): boolean {
  return _monitoringSweepInFlight;
}

// ── SSL scan state ────────────────────────────────────────────────────────────

export function isSslScanInFlight(): boolean {
  return _sslScanInFlight;
}

export function getSslScanStatus(): "idle" | "running" | "waiting" {
  return _sslScanStatus;
}

export function markSslScanStarted(total: number): void {
  _sslScanInFlight = true;
  _sslScanStatus = "running";
  _sslScanLastStartedAt = new Date();
  _sslScanLastCompletedAt = null;
  _sslScanDone = 0;
  _sslScanTotal = total;
}

export function markSslScanWaiting(): void {
  _sslScanStatus = "waiting";
}

export function markSslScanProgress(done: number): void {
  _sslScanDone = done;
}

export function markSslScanCompleted(): void {
  _sslScanInFlight = false;
  _sslScanStatus = "idle";
  _sslScanLastCompletedAt = new Date();
}

export function setSslScanNextAt(date: Date): void {
  _sslScanNextAt = date;
}

export interface SslScanState {
  status: "idle" | "running" | "waiting";
  inFlight: boolean;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  done: number;
  total: number;
  nextAt: string | null;
}

export function getSslScanState(): SslScanState {
  return {
    status: _sslScanStatus,
    inFlight: _sslScanInFlight,
    lastStartedAt: _sslScanLastStartedAt?.toISOString() ?? null,
    lastCompletedAt: _sslScanLastCompletedAt?.toISOString() ?? null,
    done: _sslScanDone,
    total: _sslScanTotal,
    nextAt: _sslScanNextAt?.toISOString() ?? null,
  };
}

// ── Shared state interface ────────────────────────────────────────────────────

export interface LiveMonitorState {
  paused: boolean;
  running: boolean;
  pausedAt: string | null;
  resumedAt: string | null;
  currentSiteId: number | null;
  currentSiteName: string | null;
  currentStep: string | null;
  currentStartedAt: string | null;
  currentServerId: number | null;
  currentServerName: string | null;
  currentPhase: SweepPhase;
  currentPhaseTotal: number;
  currentPhaseDone: number;
  confirmedDownSiteIds: number[];
  cooldownEndsAt: string | null;
  lastSweepStartedAt: string | null;
  lastSweepCompletedAt: string | null;
  lastSweepDurationMs: number | null;
  lastSweepCheckedCount: number;
  monitorIntervalMs: number;
  sslScan: SslScanState;
}

export function getMonitoringState(): LiveMonitorState {
  return {
    paused: _paused,
    running: !_paused,
    pausedAt: _pausedAt?.toISOString() ?? null,
    resumedAt: _resumedAt?.toISOString() ?? null,
    currentSiteId: _currentSiteId,
    currentSiteName: _currentSiteName,
    currentStep: _currentStep,
    currentStartedAt: _currentStartedAt?.toISOString() ?? null,
    currentServerId: _currentServerId,
    currentServerName: _currentServerName,
    currentPhase: _currentPhase,
    currentPhaseTotal: _currentPhaseTotal,
    currentPhaseDone: _currentPhaseDone,
    confirmedDownSiteIds: _confirmedDownSiteIds,
    cooldownEndsAt: _cooldownEndsAt?.toISOString() ?? null,
    lastSweepStartedAt: _lastSweepStartedAt?.toISOString() ?? null,
    lastSweepCompletedAt: _lastSweepCompletedAt?.toISOString() ?? null,
    lastSweepDurationMs: _lastSweepDurationMs,
    lastSweepCheckedCount: _lastSweepCheckedCount,
    monitorIntervalMs: _monitorIntervalMs,
    sslScan: getSslScanState(),
  };
}
