import { Router } from "express";
import { pool } from "../db/pool.js";

export const itemsRouter = Router();

itemsRouter.get("/", async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, name, description, created_at FROM items ORDER BY id DESC"
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

itemsRouter.get("/:id", async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, name, description, created_at FROM items WHERE id = $1",
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Item not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

itemsRouter.post("/", async (req, res, next) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }
    const result = await pool.query(
      "INSERT INTO items (name, description) VALUES ($1, $2) RETURNING id, name, description, created_at",
      [name, description ?? null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

itemsRouter.put("/:id", async (req, res, next) => {
  try {
    const { name, description } = req.body;
    const result = await pool.query(
      "UPDATE items SET name = COALESCE($1, name), description = COALESCE($2, description) WHERE id = $3 RETURNING id, name, description, created_at",
      [name ?? null, description ?? null, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Item not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

itemsRouter.delete("/:id", async (req, res, next) => {
  try {
    const result = await pool.query("DELETE FROM items WHERE id = $1 RETURNING id", [
      req.params.id,
    ]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Item not found" });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
