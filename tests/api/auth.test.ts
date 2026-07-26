/**
 * Auth endpoint tests.
 * Tests: POST /auth/register, POST /auth/login
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { startServer, stopServer, getBaseUrl } from "../helpers/api-server";

let BASE_URL: string;
const TEST_EMAIL = `test-${Date.now()}@hsmc.network`;
const TEST_PASSWORD = "testPassword123!";

beforeAll(async () => {
  BASE_URL = await startServer();
}, 20000);

afterAll(async () => {
  await stopServer();
});

describe("Auth API", () => {
  let authToken: string;
  let userId: string;

  describe("POST /auth/register", () => {
    it("registers a new user successfully", async () => {
      const res = await fetch(`${BASE_URL}/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "hsmic-test/1.0",
        },
        body: JSON.stringify({
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
        }),
      });

      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.token).toBeTruthy();
      expect(body.user).toBeTruthy();
      expect(body.user.email).toBe(TEST_EMAIL);
      expect(body.user.id).toBeTruthy();

      authToken = body.token;
      userId = body.user.id;
    });

    it("rejects duplicate email registration", async () => {
      const res = await fetch(`${BASE_URL}/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "hsmic-test/1.0",
        },
        body: JSON.stringify({
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
        }),
      });

      expect(res.status).toBe(409);

      const body = await res.json();
      expect(body.error).toContain("already exists");
    });

    it("rejects registration with missing email", async () => {
      const res = await fetch(`${BASE_URL}/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "hsmic-test/1.0",
        },
        body: JSON.stringify({ password: TEST_PASSWORD }),
      });

      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toContain("email");
    });

    it("rejects registration with short password", async () => {
      const res = await fetch(`${BASE_URL}/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "hsmic-test/1.0",
        },
        body: JSON.stringify({
          email: "shortpw@hsmc.network",
          password: "123",
        }),
      });

      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toContain("8 characters");
    });

    it("rejects registration with invalid email format", async () => {
      const res = await fetch(`${BASE_URL}/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "hsmic-test/1.0",
        },
        body: JSON.stringify({
          email: "not-an-email",
          password: TEST_PASSWORD,
        }),
      });

      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toContain("email");
    });
  });

  describe("POST /auth/login", () => {
    it("logs in with correct credentials", async () => {
      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "hsmic-test/1.0",
        },
        body: JSON.stringify({
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
        }),
      });

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.token).toBeTruthy();
      expect(body.user.email).toBe(TEST_EMAIL);
      expect(body.user.id).toBe(userId);
    });

    it("rejects login with wrong password", async () => {
      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "hsmic-test/1.0",
        },
        body: JSON.stringify({
          email: TEST_EMAIL,
          password: "wrongPassword",
        }),
      });

      expect(res.status).toBe(401);

      const body = await res.json();
      expect(body.error).toContain("Invalid");
    });

    it("rejects login for non-existent user", async () => {
      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "hsmic-test/1.0",
        },
        body: JSON.stringify({
          email: "nonexistent@hsmc.network",
          password: TEST_PASSWORD,
        }),
      });

      expect(res.status).toBe(401);

      const body = await res.json();
      expect(body.error).toContain("Invalid");
    });

    it("rejects login with missing credentials", async () => {
      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "hsmic-test/1.0",
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toContain("required");
    });
  });
});
