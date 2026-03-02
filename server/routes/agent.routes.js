import express from "express";
import * as agentController from "../controllers/agent.controller.js";

const router = express.Router();

// Agent dashboard for a user
router.get("/dashboard/:user_id", agentController.getAgentDashboard);

export default router;
