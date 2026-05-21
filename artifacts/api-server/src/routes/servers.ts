import { Router, type IRouter } from "express";
import { db, serversTable, sitesTable } from "@workspace/db";
import { eq, sql, asc, inArray } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

// GET /api/servers — list all servers with site counts
router.get("/servers", requireAuth, async (_req, res) => {
  try {
    const servers = await db
      .select()
      .from(serversTable)
      .orderBy(asc(serversTable.displayOrder), asc(serversTable.id));

    const siteCountRows = await db
      .select({
        serverId: sitesTable.serverId,
        count: sql<number>`count(*)::int`,
      })
      .from(sitesTable)
      .where(eq(sitesTable.enabled, true))
      .groupBy(sitesTable.serverId);

    const countMap = new Map<number, number>();
    for (const row of siteCountRows) {
      if (row.serverId !== null) countMap.set(row.serverId, row.count);
    }

    const result = servers.map((s) => ({
      ...s,
      siteCount: countMap.get(s.id) ?? 0,
    }));

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch servers" });
  }
});

// POST /api/servers — create a new server
router.post("/servers", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { code, name, description, color, displayOrder, notes } = req.body as {
      code?: string;
      name?: string;
      description?: string;
      color?: string;
      displayOrder?: number;
      notes?: string;
    };

    if (!code || typeof code !== "string" || !code.trim()) {
      return res.status(400).json({ error: "code_required", message: "Server code is required" });
    }
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name_required", message: "Server name is required" });
    }

    const [existing] = await db
      .select({ id: serversTable.id })
      .from(serversTable)
      .where(eq(serversTable.code, code.trim()))
      .limit(1);

    if (existing) {
      return res.status(409).json({ error: "code_taken", message: `Server code "${code.trim()}" is already in use` });
    }

    const [created] = await db
      .insert(serversTable)
      .values({
        code: code.trim(),
        name: name.trim(),
        description: description?.trim() || null,
        color: color?.trim() || "#3b82f6",
        displayOrder: typeof displayOrder === "number" ? displayOrder : 0,
        notes: notes?.trim() || null,
      })
      .returning();

    return res.status(201).json(created);
  } catch (err) {
    return res.status(500).json({ error: "Failed to create server" });
  }
});

// PUT /api/servers/:id — update a server
router.put("/servers/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = parseInt(req.params.id ?? "", 10);
    if (isNaN(id)) return res.status(400).json({ error: "invalid_id" });

    const { code, name, description, color, displayOrder, notes } = req.body as {
      code?: string;
      name?: string;
      description?: string;
      color?: string;
      displayOrder?: number;
      notes?: string;
    };

    const [existing] = await db.select().from(serversTable).where(eq(serversTable.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: "not_found" });

    if (code && code.trim() !== existing.code) {
      const [codeConflict] = await db
        .select({ id: serversTable.id })
        .from(serversTable)
        .where(eq(serversTable.code, code.trim()))
        .limit(1);
      if (codeConflict) {
        return res.status(409).json({ error: "code_taken", message: `Server code "${code.trim()}" is already in use` });
      }
    }

    const updateData: Partial<typeof serversTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (code !== undefined) updateData.code = code.trim();
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description?.trim() || null;
    if (color !== undefined) updateData.color = color?.trim() || "#3b82f6";
    if (displayOrder !== undefined) updateData.displayOrder = displayOrder;
    if (notes !== undefined) updateData.notes = notes?.trim() || null;

    const [updated] = await db
      .update(serversTable)
      .set(updateData)
      .where(eq(serversTable.id, id))
      .returning();

    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ error: "Failed to update server" });
  }
});

// DELETE /api/servers/:id — delete a server (unassigns all its sites)
router.delete("/servers/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const id = parseInt(req.params.id ?? "", 10);
    if (isNaN(id)) return res.status(400).json({ error: "invalid_id" });

    const [existing] = await db.select().from(serversTable).where(eq(serversTable.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: "not_found" });

    // Unassign all sites from this server before deleting
    await db
      .update(sitesTable)
      .set({ serverId: null })
      .where(eq(sitesTable.serverId, id));

    await db.delete(serversTable).where(eq(serversTable.id, id));

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to delete server" });
  }
});

// PATCH /api/sites/:id/server — assign a site to a server
router.patch("/sites/:id/server", requireAuth, requireRole("operator"), async (req, res) => {
  try {
    const siteId = parseInt(req.params.id ?? "", 10);
    if (isNaN(siteId)) return res.status(400).json({ error: "invalid_id" });

    const { serverId } = req.body as { serverId?: number | null };

    const [site] = await db.select().from(sitesTable).where(eq(sitesTable.id, siteId)).limit(1);
    if (!site) return res.status(404).json({ error: "site_not_found" });

    if (serverId !== null && serverId !== undefined) {
      const [server] = await db.select().from(serversTable).where(eq(serversTable.id, serverId)).limit(1);
      if (!server) return res.status(404).json({ error: "server_not_found" });
    }

    const [updated] = await db
      .update(sitesTable)
      .set({ serverId: serverId ?? null })
      .where(eq(sitesTable.id, siteId))
      .returning();

    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ error: "Failed to update site server" });
  }
});

// PATCH /api/sites/bulk-assign-server — bulk assign sites to a server
router.patch("/sites/bulk-assign-server", requireAuth, requireRole("operator"), async (req, res) => {
  try {
    const { siteIds, serverId } = req.body as { siteIds?: number[]; serverId?: number | null };

    if (!Array.isArray(siteIds) || siteIds.length === 0) {
      return res.status(400).json({ error: "siteIds required" });
    }

    if (serverId !== null && serverId !== undefined) {
      const [server] = await db.select().from(serversTable).where(eq(serversTable.id, serverId)).limit(1);
      if (!server) return res.status(404).json({ error: "server_not_found" });
    }

    await db
      .update(sitesTable)
      .set({ serverId: serverId ?? null })
      .where(inArray(sitesTable.id, siteIds));

    return res.json({ ok: true, updated: siteIds.length });
  } catch (err) {
    return res.status(500).json({ error: "Failed to bulk assign server" });
  }
});

export default router;
