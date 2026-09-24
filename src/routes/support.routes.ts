import { Router } from "express";
import { postSupportTicket } from "../controllers/support.controller";

const router = Router();

// Deliberately no `authenticate` and no Redis-backed rate limiter here:
// this is the escape hatch for when the system — Redis included — is
// unavailable, so it must not itself depend on a fully healthy stack.
router.post("/tickets", postSupportTicket);

export default router;
