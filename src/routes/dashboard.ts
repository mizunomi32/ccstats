import { Hono } from "hono";
import type { Env } from "../index";
import { renderDashboard } from "../templates/dashboard";

const dashboard = new Hono<{ Bindings: Env }>();

dashboard.get("/", (c) => {
  return c.html(renderDashboard());
});

export default dashboard;
