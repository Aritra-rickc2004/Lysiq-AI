import argon2 from "argon2";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { supabase } from "../utils/supabase.js";
import { inngest } from "../Inngest/client.js";

export const signup = async (req, res) => {
  const { email, password, skills = [], role = "user" } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  // 1. Strict Security Rule: Never allow creating an admin via signup
  if (role === "admin") {
    return res.status(403).json({
      error:
        "Forbidden: The admin role cannot be created through public registration. Only the authorized system owner can provision the single super admin.",
    });
  }

  // Only 'moderator' or 'user' roles are permitted for public registration
  const validRole = role === "moderator" ? "moderator" : "user";

  try {
    // Check if user already exists
    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existingUser) {
      return res
        .status(400)
        .json({ error: "A user with this email already exists" });
    }

    // Hash password using modern memory-hard Argon2id
    const hashedPassword = await argon2.hash(password, {
      type: argon2.argon2id,
    });

    const { data: user, error } = await supabase
      .from("users")
      .insert({
        email,
        password: hashedPassword,
        skills: Array.isArray(skills) ? skills : [],
        role: validRole,
      })
      .select("id, email, role, skills, created_at")
      .single();

    if (error) {
      return res.status(500).json({
        error: "Failed to create user in database",
        details: error.message,
      });
    }

    // Fire inngest onboarding event
    try {
      await inngest.send({
        name: "user/signup",
        data: { email },
      });
    } catch (inngestErr) {
      console.warn("Inngest send event warning:", inngestErr.message);
    }

    const token = jwt.sign(
      { id: user.id, _id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.status(201).json({ user, token });
  } catch (error) {
    return res
      .status(500)
      .json({ error: "Signup failed", details: error.message });
  }
};

export const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .maybeSingle();

    if (error || !user) {
      return res.status(401).json({ error: "Invalid email or credentials" });
    }

    let isMatch = false;

    // Dual-Verification Architecture:
    // 1. If hash is Argon2id (starts with $argon2), verify with argon2.verify
    // 2. If legacy Bcrypt hash (starts with $2), verify with bcrypt.compare
    if (user.password && user.password.startsWith("$argon2")) {
      isMatch = await argon2.verify(user.password, password);
    } else if (user.password && user.password.startsWith("$2")) {
      isMatch = await bcrypt.compare(password, user.password);
      // Seamlessly upgrade legacy Bcrypt hash to Argon2id upon successful verification
      if (isMatch) {
        try {
          const upgradedHash = await argon2.hash(password, {
            type: argon2.argon2id,
          });
          await supabase
            .from("users")
            .update({ password: upgradedHash })
            .eq("id", user.id);
        } catch (upgradeErr) {
          console.warn("Argon2id auto-upgrade notice:", upgradeErr.message);
        }
      }
    } else {
      try {
        isMatch = await argon2.verify(user.password, password);
      } catch {
        isMatch = await bcrypt.compare(password, user.password).catch(() => false);
      }
    }

    if (!isMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user.id, _id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const { password: _, ...userSafe } = user;
    return res.json({ user: userSafe, token });
  } catch (error) {
    return res
      .status(500)
      .json({ error: "Login failed", details: error.message });
  }
};

export const logout = async (req, res) => {
  return res.json({ message: "Logout successful" });
};

export const updateUser = async (req, res) => {
  const { skills, role, email } = req.body;

  if (!email) {
    return res
      .status(400)
      .json({ error: "Email is required to update a user" });
  }

  // 1. Enforce super admin caller
  if (req.user?.role !== "admin") {
    return res.status(403).json({
      error: "Forbidden: Only the super admin can modify team member settings",
    });
  }

  // 2. Strict Security Rule: Never allow promoting any user to admin via API
  if (role === "admin") {
    return res.status(403).json({
      error:
        "Forbidden: Promoting accounts to admin via the API is strictly prohibited. Exactly one super admin is permitted.",
    });
  }

  try {
    const { data: targetUser, error: findError } = await supabase
      .from("users")
      .select("id, email, skills, role")
      .eq("email", email)
      .maybeSingle();

    if (findError || !targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // 3. Prevent modifying or demoting the single super admin account
    if (targetUser.role === "admin" && role && role !== "admin") {
      return res.status(403).json({
        error:
          "Forbidden: The designated super admin account role cannot be modified or demoted.",
      });
    }

    const updates = {};
    if (skills !== undefined) {
      updates.skills = Array.isArray(skills) ? skills : [];
    }
    if (role !== undefined) {
      if (!["moderator", "user"].includes(role)) {
        return res
          .status(400)
          .json({ error: "Invalid role specified. Only 'moderator' or 'user' can be assigned." });
      }
      updates.role = role;
    }

    const { data: updatedUser, error: updateError } = await supabase
      .from("users")
      .update(updates)
      .eq("email", email)
      .select("id, email, role, skills, created_at")
      .single();

    if (updateError) {
      return res.status(500).json({
        error: "Update failed",
        details: updateError.message,
      });
    }

    return res.json({
      message: "User updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ error: "Update failed", details: error.message });
  }
};

export const getUsers = async (req, res) => {
  // Enforce super admin caller
  if (req.user?.role !== "admin") {
    return res.status(403).json({
      error: "Forbidden: Only the super admin can view the complete user roster",
    });
  }

  try {
    const { data: users, error } = await supabase
      .from("users")
      .select("id, email, role, skills, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      return res
        .status(500)
        .json({ error: "Failed to fetch users", details: error.message });
    }

    return res.json(users);
  } catch (error) {
    return res
      .status(500)
      .json({ error: "Fetching users failed", details: error.message });
  }
};
