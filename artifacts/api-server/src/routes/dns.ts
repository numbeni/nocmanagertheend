import { Router, type IRouter } from "express";
import { RunDnsCheckBody } from "@workspace/api-zod";
import { checkDnsHealth } from "../monitoring/dns";

const router: IRouter = Router();

router.post("/dns/check", async (req, res) => {
  const parsed = RunDnsCheckBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  // Strip protocol if user pasted a URL
  let host = parsed.data.host.trim();
  try {
    if (/^https?:\/\//i.test(host)) host = new URL(host).hostname;
  } catch {
    /* ignore */
  }
  const report = await checkDnsHealth(host);
  res.json(report);
});

export default router;
