// src/reports/performance-routes.ts
//
//   GET /v1/staff/businesses/:businessId/performance?month=YYYY-MM
//       the Business Performance Report for a month (this month so far by
//       default), and the months there are to choose from      manager

import type { Express, NextFunction, Request, Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { requireBusinessRole, requireStaff, staffOf } from "../staff/auth.ts";
import { monthOf, performanceReport, previousMonth, validMonth } from "./performance.ts";

export function registerPerformanceRoutes(app: Express, config: PlatformConfig): void {
  app.get("/v1/staff/businesses/:businessId/performance", requireStaff(config.sessionTokenSecret), requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const business = staffOf(req).business!;
      const now = new Date();
      const current = monthOf(now, business.timeZone);
      const first = monthOf(business.createdAt, business.timeZone);
      const month = validMonth(req.query.month) && req.query.month <= current && req.query.month >= first ? req.query.month : current;
      // Every month since the business joined, newest first (at most two years).
      const months: string[] = [];
      for (let at = current; at >= first && months.length < 24; at = previousMonth(at)) months.push(at);
      res.json({ report: await performanceReport(business, month, now), months });
    } catch (error) {
      next(error);
    }
  });
}
