import express from "express";
import {
  signup,
  login,
  logout,
  updateUser,
  getUsers,
} from "../controllers/user.js";
import { authenticateToken, requireSuperAdmin } from "../middleware/auth.js";

const router = express.Router();

router.post("/signup", signup);
router.post("/login", login);
router.post("/logout", authenticateToken, logout);
router.put("/update", authenticateToken, requireSuperAdmin, updateUser);
router.get("/", authenticateToken, requireSuperAdmin, getUsers);

export default router;
