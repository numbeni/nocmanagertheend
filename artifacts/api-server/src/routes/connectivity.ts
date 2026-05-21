import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import {
  getConnectivityState,
  getHardcodedTargets,
  runConnectivityCheck,
} from "../services/connectivity";

const router = Router();

function serializeState() {
  const state = getConnectivityState();
  return {
    status: state.status,
    isChecking: state.isChecking,
    currentlyCheckingTarget: state.currentlyCheckingTarget,
    results: state.results.map((r) => ({
      id: r.id,
      name: r.name,
      host: r.host,
      lastStatus: r.lastStatus,
      lastResponseTimeMs: r.lastResponseTimeMs,
      lastError: r.lastError,
      lastCheckedAt: r.lastCheckedAt?.toISOString() ?? null,
      lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null,
      lastFailedAt: r.lastFailedAt?.toISOString() ?? null,
    })),
    lastOnlineAt: state.lastOnlineAt?.toISOString() ?? null,
    lastOfflineAt: state.lastOfflineAt?.toISOString() ?? null,
    lastCheckedAt: state.lastCheckedAt?.toISOString() ?? null,
    nextRetryAt: state.nextRetryAt?.toISOString() ?? null,
  };
}

// ── Status ─────────────────────────────────────────────────────────────────────
router.get("/connectivity/status", requireAuth, (_req, res) => {
  res.json(serializeState());
});

// ── Hardcoded targets list (read-only) ────────────────────────────────────────
router.get("/connectivity/targets", requireAuth, (_req, res) => {
  res.json(getHardcodedTargets());
});

// ── Manual full check ─────────────────────────────────────────────────────────
router.post("/connectivity/check", requireAuth, async (_req, res) => {
  await runConnectivityCheck();
  res.json(serializeState());
});

// ── Manual single-target ping ─────────────────────────────────────────────────
router.post("/connectivity/check/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  await runConnectivityCheck(id);
  res.json(serializeState());
});

export default router;
